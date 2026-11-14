import { config } from "./config";
import { db } from "./db";
import { AppError } from "./http";

/**
 * Accounting for calls to NEAR AI Cloud, and the budgets that protect the shared API key.
 *
 * What is exact and what is not:
 *  - `units` (questions asked, passages embedded, passages reranked) is counted by Morrow and is exact.
 *  - Token counts are stored only when the provider's response includes a `usage` object. When it
 *    does not, the columns are NULL and the totals shown to users say how many calls were unreported.
 *    Morrow never estimates tokens and never converts tokens to money: prices change and are not
 *    returned with responses.
 */
export type UsageKind = "chat" | "embedding" | "rerank";
export type UsagePurpose = "ask" | "search" | "index";
export type ProviderUsage = { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } | null | undefined;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

export function recordUsage(e: { userId: string; kind: UsageKind; purpose: UsagePurpose; model: string; units: number; usage?: ProviderUsage; ok: boolean }): void {
  const prompt = num(e.usage?.prompt_tokens);
  const completion = num(e.usage?.completion_tokens);
  const total = num(e.usage?.total_tokens) ?? (prompt !== null ? prompt + (completion ?? 0) : null);
  db()
    .prepare("INSERT INTO usage_events (user_id, kind, purpose, model, units, prompt_tokens, completion_tokens, total_tokens, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(e.userId, e.kind, e.purpose, e.model, e.units, prompt, completion, total, e.ok ? "ok" : "error", Date.now());
}

/** Budgets reset at midnight UTC. */
export function dayStart(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export type UsageTotals = { questions: number; tokens: number; callsWithoutTokenCount: number; passagesEmbedded: number; calls: number };

function totals(where: string, ...args: (string | number)[]): UsageTotals {
  const r = db()
    .prepare(
      `SELECT
         coalesce(sum(CASE WHEN kind = 'chat' THEN units ELSE 0 END), 0) AS questions,
         coalesce(sum(total_tokens), 0) AS tokens,
         coalesce(sum(CASE WHEN total_tokens IS NULL AND status = 'ok' THEN 1 ELSE 0 END), 0) AS unreported,
         coalesce(sum(CASE WHEN kind = 'embedding' AND purpose = 'index' AND status = 'ok' THEN units ELSE 0 END), 0) AS embedded,
         count(*) AS calls
       FROM usage_events WHERE ${where}`,
    )
    .get(...args) as { questions: number; tokens: number; unreported: number; embedded: number; calls: number };
  return { questions: r.questions, tokens: r.tokens, callsWithoutTokenCount: r.unreported, passagesEmbedded: r.embedded, calls: r.calls };
}

export function userUsageToday(userId: string): UsageTotals {
  return totals("user_id = ? AND created_at >= ?", userId, dayStart());
}

/** Everyone's usage today, including accounts since deleted. Only aggregate numbers ever leave this function. */
export function appUsageToday(): UsageTotals {
  return totals("created_at >= ?", dayStart());
}

export function quotaLimits() {
  const q = config.quotas;
  return { userDailyQuestions: q.userDailyQuestions, userDailyTokens: q.userDailyTokens, userDailyEmbedPassages: q.userDailyEmbedPassages };
}

function resetsIn(): string {
  const mins = Math.ceil((dayStart() + 24 * 3600_000 - Date.now()) / 60_000);
  return mins >= 90 ? `${Math.round(mins / 60)} hours` : `${mins} minutes`;
}

function over(code: "quota_exceeded" | "app_quota_exceeded", message: string): AppError {
  return new AppError(code === "quota_exceeded" ? 429 : 503, code, `${message} It resets in ${resetsIn()} (midnight UTC).`, { retryAfter: Math.ceil((dayStart() + 24 * 3600_000 - Date.now()) / 1000) });
}

/**
 * Check budgets before spending. `ask` reserves one question; `index` reserves `passages` embeddings;
 * `search` only needs token budget. A limit of 0 switches that feature off.
 */
export function assertQuota(userId: string, what: "ask" | "search" | "index", passages = 0): void {
  const q = config.quotas;
  const mine = userUsageToday(userId);
  const all = appUsageToday();
  if (all.tokens >= q.appDailyTokens) throw over("app_quota_exceeded", "This Morrow server has used its AI budget for today.");
  if (mine.tokens >= q.userDailyTokens) throw over("quota_exceeded", "You have used your AI budget for today.");
  if (what === "ask") {
    if (all.questions >= q.appDailyQuestions) throw over("app_quota_exceeded", "This Morrow server has answered its limit of questions for today.");
    if (mine.questions >= q.userDailyQuestions) throw over("quota_exceeded", `You have asked ${mine.questions} questions today, which is the daily limit.`);
  }
  if (what === "index" && mine.passagesEmbedded + passages > q.userDailyEmbedPassages) {
    throw over("quota_exceeded", `Indexing this document for meaning would exceed today's limit of ${q.userDailyEmbedPassages} passages (${mine.passagesEmbedded} used). Keyword search still works.`);
  }
}

export function usageHistory(userId: string, limit = 50) {
  return db()
    .prepare("SELECT kind, purpose, model, units, prompt_tokens AS promptTokens, completion_tokens AS completionTokens, total_tokens AS totalTokens, status, created_at AS createdAt FROM usage_events WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, Math.min(limit, 200));
}

/** Called when an account is deleted: keep the counts for app-wide budgets, drop the link to the person. */
export function anonymiseUsage(userId: string): void {
  db().prepare("UPDATE usage_events SET user_id = NULL WHERE user_id = ?").run(userId);
}

// One question at a time per user: stops a client from racing past its budget with parallel requests.
type G = typeof globalThis & { __morrowAsking?: Set<string> };
const asking = ((globalThis as G).__morrowAsking ??= new Set<string>());

export async function exclusiveAsk<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  if (asking.has(userId)) throw new AppError(429, "busy", "Morrow is still answering your previous question. Wait for it to finish.", { retryAfter: 5 });
  asking.add(userId);
  try {
    return await fn();
  } finally {
    asking.delete(userId);
  }
}
