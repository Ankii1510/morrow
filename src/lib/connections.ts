import { db, blobToVec } from "./db";
import { dot, getOwnedDocument } from "./documents";
import { ftsQuery } from "./retrieval/search";

export type Connection = {
  documentId: string;
  title: string;
  kind: string;
  /** How the link was found. "meaning" uses embeddings computed in a TEE; "terms" is local keyword overlap. */
  basis: "meaning" | "terms";
  strength: number;
  sharedTags: string[];
  /** The pair of passages that best explains the connection. */
  here: { chunkId: number; page: number; text: string } | null;
  there: { chunkId: number; page: number; text: string } | null;
};

const MIN_DOC_SIMILARITY = 0.45;
const MAX_CONNECTIONS = 5;

type ChunkVec = { id: number; page: number; text: string; v: Float32Array };

function chunkVectors(userId: string, docId: string): ChunkVec[] {
  const rows = db().prepare("SELECT id, page, text, embedding FROM chunks WHERE user_id = ? AND document_id = ? AND embedding IS NOT NULL ORDER BY ordinal LIMIT 400").all(userId, docId) as { id: number; page: number; text: string; embedding: Uint8Array }[];
  return rows.map((r) => ({ id: r.id, page: r.page, text: r.text, v: blobToVec(r.embedding) }));
}

function tagsOf(userId: string, docId: string): string[] {
  return (db().prepare("SELECT tag FROM document_tags WHERE user_id = ? AND document_id = ?").all(userId, docId) as { tag: string }[]).map((t) => t.tag);
}

export function relatedDocuments(userId: string, docId: string): Connection[] {
  getOwnedDocument(userId, docId);
  const myTags = new Set(tagsOf(userId, docId));
  const self = db().prepare("SELECT centroid FROM documents WHERE id = ? AND user_id = ?").get(docId, userId) as { centroid: Uint8Array | null };

  if (self.centroid) {
    const mine = blobToVec(self.centroid);
    const others = db().prepare("SELECT id, title, kind, centroid FROM documents WHERE user_id = ? AND id != ? AND centroid IS NOT NULL").all(userId, docId) as { id: string; title: string; kind: string; centroid: Uint8Array }[];
    const ranked = others
      .map((o) => ({ ...o, sim: dot(mine, blobToVec(o.centroid)) }))
      .filter((o) => o.sim >= MIN_DOC_SIMILARITY)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, MAX_CONNECTIONS);
    if (ranked.length > 0) {
      const a = chunkVectors(userId, docId);
      return ranked.map((o) => {
        const b = chunkVectors(userId, o.id);
        let best = { s: -1, i: -1, j: -1 };
        for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
          const s = dot(a[i].v, b[j].v);
          if (s > best.s) best = { s, i, j };
        }
        return {
          documentId: o.id,
          title: o.title,
          kind: o.kind,
          basis: "meaning" as const,
          strength: o.sim,
          sharedTags: tagsOf(userId, o.id).filter((t) => myTags.has(t)),
          here: best.i >= 0 ? { chunkId: a[best.i].id, page: a[best.i].page, text: a[best.i].text } : null,
          there: best.j >= 0 ? { chunkId: b[best.j].id, page: b[best.j].page, text: b[best.j].text } : null,
        };
      });
    }
  }
  return keywordConnections(userId, docId, myTags);
}

/** Fallback when no embeddings exist: documents that share this document's most distinctive terms. Fully local. */
function keywordConnections(userId: string, docId: string, myTags: Set<string>): Connection[] {
  const text = (db().prepare("SELECT group_concat(text, ' ') AS t FROM (SELECT text FROM chunks WHERE user_id = ? AND document_id = ? ORDER BY ordinal LIMIT 60)").get(userId, docId) as { t: string | null }).t || "";
  const freq = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[\p{L}]{5,}/gu) || []) freq.set(w, (freq.get(w) || 0) + 1);
  const top = [...freq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
  const match = ftsQuery(top.join(" "));
  if (!match) return [];
  const rows = db()
    .prepare(
      `SELECT c.id, c.document_id, c.page, c.text, d.title, d.kind, bm25(chunks_fts) AS rank
       FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN documents d ON d.id = c.document_id
       WHERE chunks_fts MATCH ? AND c.user_id = ? AND d.user_id = ? AND c.document_id != ?
       ORDER BY rank LIMIT 60`,
    )
    .all(match, userId, userId, docId) as { id: number; document_id: string; page: number; text: string; title: string; kind: string; rank: number }[];
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!best.has(r.document_id)) best.set(r.document_id, r);
  const worst = Math.min(...rows.map((r) => r.rank), -1e-9);
  return [...best.values()].slice(0, MAX_CONNECTIONS).map((r) => ({
    documentId: r.document_id,
    title: r.title,
    kind: r.kind,
    basis: "terms" as const,
    strength: Math.min(1, r.rank / worst),
    sharedTags: tagsOf(userId, r.document_id).filter((t) => myTags.has(t)),
    here: null,
    there: { chunkId: r.id, page: r.page, text: r.text },
  }));
}
