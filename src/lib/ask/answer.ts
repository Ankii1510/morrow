import crypto from "node:crypto";
import { config } from "../config";
import { db, logActivity } from "../db";
import { AppError } from "../http";
import { chat, requireKey } from "../near/client";
import { buildVerification, writeReceipt, deleteReceipt, type AnswerVerification } from "../near/receipt";
import { search, type Scope } from "../retrieval/search";
import { assertQuota, exclusiveAsk } from "../usage";
import { buildMessages, leaksSystemPrompt, looksLikeInjection, parseAnswer } from "./prompt";

export type AnswerSource = {
  n: number;
  chunkId: number;
  documentId: string;
  title: string;
  kind: string;
  page: number;
  heading: string | null;
  text: string;
  cited: boolean;
  /** The passage contains text that reads like instructions to an AI. The model was told to ignore it. */
  flagged?: boolean;
};

export type AnswerRecord = {
  id: string;
  question: string;
  answer: string;
  /** grounded: cited answer · insufficient: the sources did not contain the answer · uncited: model answered without valid citations */
  outcome: "grounded" | "insufficient" | "uncited" | "no_sources" | "withheld";
  sources: AnswerSource[];
  verification: AnswerVerification | null;
  retrieval: { mode: string; reranked: boolean; notes: string[]; invalidCitations: number[] };
  model: string;
  createdAt: number;
};

const MAX_SOURCES = 8;

export function ask(userId: string, question: string, scope?: Scope): Promise<AnswerRecord> {
  const q = question.trim();
  if (q.length < 3) throw new AppError(400, "invalid", "Ask a full question.");
  if (q.length > config.limits.maxQuestionChars) throw new AppError(400, "invalid", "That question is too long.");
  // Budgets are checked before anything is sent anywhere, and before the provider key is even looked at.
  assertQuota(userId, "ask");
  requireKey();
  return exclusiveAsk(userId, () => answerQuestion(userId, q, scope));
}

async function answerQuestion(userId: string, q: string, scope?: Scope): Promise<AnswerRecord> {
  const found = await search(userId, q, { scope, limit: MAX_SOURCES, rerank: true, purpose: "ask" });
  const id = crypto.randomUUID();
  const createdAt = Date.now();

  // No evidence at all: say so without calling a model. Nothing is invented and nothing is sent.
  if (found.hits.length === 0) {
    const rec: AnswerRecord = {
      id,
      question: q,
      answer: "",
      outcome: "no_sources",
      sources: [],
      verification: null,
      retrieval: { mode: found.mode, reranked: false, notes: found.notes, invalidCitations: [] },
      model: config.near.chatModel,
      createdAt,
    };
    return rec; // not saved: there is nothing to keep
  }

  const completion = await chat(buildMessages(q, found.hits), { userId, purpose: "ask" });
  const leaked = leaksSystemPrompt(completion.content);
  const parsed = leaked ? { text: "", insufficient: false, cited: [] as number[], invalid: [] as number[] } : parseAnswer(completion.content, found.hits.length);
  const sources: AnswerSource[] = found.hits.map((h, i) => ({
    n: i + 1,
    chunkId: h.chunkId,
    documentId: h.documentId,
    title: h.title,
    kind: h.kind,
    page: h.page,
    heading: h.heading,
    text: h.text,
    cited: parsed.cited.includes(i + 1),
    flagged: looksLikeInjection(h.text) || looksLikeInjection(h.title) || undefined,
  }));
  const outcome: AnswerRecord["outcome"] = leaked ? "withheld" : parsed.insufficient ? "insufficient" : parsed.cited.length > 0 ? "grounded" : "uncited";
  const verification = buildVerification(completion, found.attestations.embedding, found.attestations.rerank);
  const rec: AnswerRecord = {
    id,
    question: q,
    answer: parsed.text,
    outcome,
    sources,
    verification,
    retrieval: { mode: found.mode, reranked: found.reranked, notes: found.notes, invalidCitations: parsed.invalid },
    model: completion.model,
    createdAt,
  };
  writeReceipt(userId, id, completion);
  db()
    .prepare("INSERT INTO answers (id, user_id, question, answer, grounded, sources_json, verification_json, scope_json, model, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, userId, q, rec.answer, outcome === "grounded" ? 1 : 0, JSON.stringify(sources), JSON.stringify({ verification, retrieval: rec.retrieval, outcome }), JSON.stringify(scope || {}), rec.model, createdAt);
  logActivity(userId, "ask", `Asked a question (${sources.filter((s) => s.cited).length} sources cited, verified ${verification.signatureKind} signature)`);
  return rec;
}

type AnswerRow = { id: string; question: string; answer: string; sources_json: string; verification_json: string; model: string; created_at: number };

function present(row: AnswerRow): AnswerRecord {
  const v = JSON.parse(row.verification_json) as { verification: AnswerVerification; retrieval: AnswerRecord["retrieval"]; outcome: AnswerRecord["outcome"] };
  return { id: row.id, question: row.question, answer: row.answer, outcome: v.outcome, sources: JSON.parse(row.sources_json), verification: v.verification, retrieval: v.retrieval, model: row.model, createdAt: row.created_at };
}

export function listAnswers(userId: string) {
  const rows = db().prepare("SELECT id, question, grounded, created_at FROM answers WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(userId) as { id: string; question: string; grounded: number; created_at: number }[];
  return rows.map((r) => ({ id: r.id, question: r.question, grounded: r.grounded === 1, createdAt: r.created_at }));
}

export function getAnswer(userId: string, id: string): AnswerRecord {
  const row = db().prepare("SELECT id, question, answer, sources_json, verification_json, model, created_at FROM answers WHERE id = ? AND user_id = ?").get(id, userId) as AnswerRow | undefined;
  if (!row) throw new AppError(404, "not_found", "Answer not found.");
  return present(row);
}

export function deleteAnswer(userId: string, id: string): void {
  const r = db().prepare("DELETE FROM answers WHERE id = ? AND user_id = ?").run(id, userId);
  if (r.changes === 0) throw new AppError(404, "not_found", "Answer not found.");
  deleteReceipt(userId, id);
}
