import { nearConfigured } from "../config";
import { db } from "../db";
import { AppError } from "../http";
import { dot, vectorIndex } from "../documents";
import { embed, queryInstruction, rerank, type AttestationSummary } from "../near/client";
import { assertQuota } from "../usage";

export type Scope = { documentIds?: string[]; collectionId?: string; tag?: string };

export type Hit = {
  chunkId: number;
  documentId: string;
  title: string;
  kind: string;
  page: number;
  heading: string | null;
  text: string;
  score: number;
  via: ("keyword" | "semantic")[];
  rerankScore?: number;
};

export type SearchResult = {
  hits: Hit[];
  /** How the results were produced, reported honestly so the UI never implies more than happened. */
  mode: "hybrid" | "keyword";
  reranked: boolean;
  notes: string[];
  attestations: { embedding: AttestationSummary | null; rerank: AttestationSummary | null };
};

const STOP = new Set(
  "a an and are as at be but by for from has have how i if in into is it its me my of on or our so that the their them then there these they this to was we were what when where which who why will with you your do does did can could should would about".split(" "),
);

/** Turn free text into a safe FTS5 query: quoted terms only, so user input can never inject FTS syntax. */
export function ftsQuery(q: string): string | null {
  const terms = (q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter((t) => !STOP.has(t));
  const uniq = [...new Set(terms)].slice(0, 24);
  if (uniq.length === 0) return null;
  return uniq.map((t) => `"${t}"`).join(" OR ");
}

/** Resolve a scope to the set of the user's own document ids it covers (null = whole library). */
export function resolveScope(userId: string, scope: Scope | undefined): Set<string> | null {
  if (!scope || (!scope.documentIds?.length && !scope.collectionId && !scope.tag)) return null;
  let ids: Set<string> | null = null;
  const intersect = (rows: { id: string }[]) => {
    const s = new Set(rows.map((r) => r.id));
    ids = ids ? new Set([...ids].filter((x) => s.has(x))) : s;
  };
  if (scope.documentIds?.length) {
    const marks = scope.documentIds.map(() => "?").join(",");
    intersect(db().prepare(`SELECT id FROM documents WHERE user_id = ? AND id IN (${marks})`).all(userId, ...scope.documentIds.slice(0, 200)) as { id: string }[]);
  }
  if (scope.collectionId) {
    intersect(
      db()
        .prepare("SELECT d.id FROM documents d JOIN document_collections dc ON dc.document_id = d.id JOIN collections c ON c.id = dc.collection_id WHERE d.user_id = ? AND c.user_id = ? AND c.id = ?")
        .all(userId, userId, scope.collectionId) as { id: string }[],
    );
  }
  if (scope.tag) {
    intersect(db().prepare("SELECT d.id FROM documents d JOIN document_tags t ON t.document_id = d.id WHERE d.user_id = ? AND t.tag = ?").all(userId, scope.tag) as { id: string }[]);
  }
  return ids ?? new Set();
}

function keywordSearch(userId: string, q: string, allowed: Set<string> | null, limit: number): { id: number; rank: number }[] {
  const match = ftsQuery(q);
  if (!match) return [];
  // user_id is enforced on the base table, never trusted from the FTS index.
  const rows = db()
    .prepare(
      `SELECT c.id AS id, c.document_id AS document_id, bm25(chunks_fts, 1.0, 2.0) AS rank
       FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
       WHERE chunks_fts MATCH ? AND c.user_id = ?
       ORDER BY rank LIMIT ?`,
    )
    .all(match, userId, limit * 4) as { id: number; document_id: string; rank: number }[];
  return rows.filter((r) => !allowed || allowed.has(r.document_id)).slice(0, limit);
}

function semanticSearch(userId: string, queryVec: Float32Array, allowed: Set<string> | null, limit: number): { id: number; score: number }[] {
  const index = vectorIndex(userId);
  const scored: { id: number; score: number }[] = [];
  for (let i = 0; i < index.ids.length; i++) {
    if (allowed && !allowed.has(index.docIds[i])) continue;
    scored.push({ id: index.ids[i], score: dot(queryVec, index.vectors[i]) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Reciprocal rank fusion: robust to the two retrievers scoring on different scales. */
export function fuse(lists: { name: "keyword" | "semantic"; ids: number[] }[], k = 60): Map<number, { score: number; via: ("keyword" | "semantic")[] }> {
  const out = new Map<number, { score: number; via: ("keyword" | "semantic")[] }>();
  for (const list of lists) {
    list.ids.forEach((id, rank) => {
      const cur = out.get(id) ?? { score: 0, via: [] };
      cur.score += 1 / (k + rank + 1);
      cur.via.push(list.name);
      out.set(id, cur);
    });
  }
  return out;
}

export async function search(userId: string, query: string, opts: { scope?: Scope; limit?: number; rerank?: boolean; purpose?: "ask" | "search" } = {}): Promise<SearchResult> {
  const q = query.trim();
  if (!q) throw new AppError(400, "invalid", "Enter something to search for.");
  const limit = Math.min(opts.limit ?? 8, 30);
  const allowed = resolveScope(userId, opts.scope);
  const notes: string[] = [];
  const attestations: SearchResult["attestations"] = { embedding: null, rerank: null };

  const kw = keywordSearch(userId, q, allowed, 30);
  let sem: { id: number; score: number }[] = [];
  let mode: SearchResult["mode"] = "keyword";

  const hasVectors = vectorIndex(userId).ids.length > 0;
  if (!nearConfigured()) {
    notes.push("Keyword search only: NEAR AI Cloud is not configured, so nothing was sent off this machine.");
  } else if (!hasVectors) {
    notes.push("Keyword search only: no documents have a semantic index yet.");
  } else {
    try {
      assertQuota(userId, "search");
      const e = await embed([queryInstruction(q)], { userId, purpose: opts.purpose ?? "search" });
      attestations.embedding = e.attestation;
      sem = semanticSearch(userId, e.vectors[0], allowed, 30);
      mode = "hybrid";
    } catch (err) {
      // Verification failures are surfaced, never silently bypassed; keyword results are still local and safe.
      const msg = err instanceof AppError ? err.message : "semantic search failed";
      notes.push(`Semantic search was skipped: ${msg}`);
    }
  }

  const fused = fuse([
    { name: "keyword", ids: kw.map((r) => r.id) },
    { name: "semantic", ids: sem.map((r) => r.id) },
  ]);
  let ranked = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 24);
  if (ranked.length === 0) return { hits: [], mode, reranked: false, notes, attestations };

  const marks = ranked.map(() => "?").join(",");
  const rows = db()
    .prepare(
      `SELECT c.id, c.document_id, c.page, c.heading, c.text, d.title, d.kind
       FROM chunks c JOIN documents d ON d.id = c.document_id
       WHERE c.user_id = ? AND d.user_id = ? AND c.id IN (${marks})`,
    )
    .all(userId, userId, ...ranked.map(([id]) => id)) as { id: number; document_id: string; page: number; heading: string | null; text: string; title: string; kind: string }[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  ranked = ranked.filter(([id]) => byId.has(id));

  let hits: Hit[] = ranked.map(([id, f]) => {
    const r = byId.get(id)!;
    return { chunkId: id, documentId: r.document_id, title: r.title, kind: r.kind, page: r.page, heading: r.heading, text: r.text, score: f.score, via: f.via };
  });

  let reranked = false;
  if (opts.rerank && mode === "hybrid" && hits.length > 1) {
    try {
      const rr = await rerank(q, hits.map((h) => h.text), { userId, purpose: opts.purpose ?? "search" });
      attestations.rerank = rr.attestation;
      hits = hits.map((h, i) => ({ ...h, rerankScore: rr.scores[i] })).sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
      reranked = true;
    } catch (err) {
      const msg = err instanceof AppError ? err.message : "reranking failed";
      notes.push(`Reranking was skipped: ${msg}`);
    }
  }
  return { hits: hits.slice(0, limit), mode, reranked, notes, attestations };
}
