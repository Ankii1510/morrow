import crypto from "node:crypto";
import { config, nearConfigured } from "./config";
import { db, tx, logActivity, vecToBlob, blobToVec } from "./db";
import { AppError } from "./http";
import { extract, safeFilename, sniffKind } from "./ingest/extract";
import { chunkPages, countWords, embeddingInput } from "./ingest/chunk";
import { embed, normalizeVec } from "./near/client";
import { deleteReceipt } from "./near/receipt";
import { assertId, documentFiles, removeUserStorage } from "./storage";
import { anonymiseUsage, assertQuota } from "./usage";

/** semantic: 0 = waiting for embeddings, 1 = embedded, 2 = embedding failed, 3 = no NEAR AI key configured */
export type DocumentRow = {
  id: string;
  title: string;
  filename: string;
  kind: string;
  mime: string;
  size_bytes: number;
  status: string;
  semantic: number;
  error: string | null;
  page_count: number;
  chunk_count: number;
  word_count: number;
  meta_json: string;
  created_at: number;
  processed_at: number | null;
};

const DOC_COLS =
  "id, title, filename, kind, mime, size_bytes, status, semantic, error, page_count, chunk_count, word_count, meta_json, created_at, processed_at";

const MIME: Record<string, string> = { pdf: "application/pdf", text: "text/plain; charset=utf-8", markdown: "text/markdown; charset=utf-8" };


export function presentDocument(row: DocumentRow, extra?: { tags?: string[]; collections?: string[] }) {
  return {
    id: row.id,
    title: row.title,
    filename: row.filename,
    kind: row.kind,
    sizeBytes: row.size_bytes,
    status: row.status,
    semantic: (["pending", "ready", "failed", "unavailable"] as const)[row.semantic] ?? "pending",
    error: row.error,
    pageCount: row.page_count,
    chunkCount: row.chunk_count,
    wordCount: row.word_count,
    meta: JSON.parse(row.meta_json || "{}") as Record<string, string>,
    createdAt: row.created_at,
    processedAt: row.processed_at,
    tags: extra?.tags ?? [],
    collections: extra?.collections ?? [],
  };
}

/** The single ownership check used by every document route: wrong owner looks identical to "does not exist". */
export function getOwnedDocument(userId: string, docId: string): DocumentRow {
  assertId(docId, "document id");
  const row = db().prepare(`SELECT ${DOC_COLS} FROM documents WHERE id = ? AND user_id = ?`).get(docId, userId) as DocumentRow | undefined;
  if (!row) throw new AppError(404, "not_found", "Document not found.");
  return row;
}

export function listDocuments(userId: string) {
  const rows = db().prepare(`SELECT ${DOC_COLS} FROM documents WHERE user_id = ? ORDER BY created_at DESC`).all(userId) as unknown as DocumentRow[];
  const tags = new Map<string, string[]>();
  for (const t of db().prepare("SELECT document_id, tag FROM document_tags WHERE user_id = ? ORDER BY tag").all(userId) as { document_id: string; tag: string }[]) {
    (tags.get(t.document_id) ?? tags.set(t.document_id, []).get(t.document_id)!).push(t.tag);
  }
  const cols = new Map<string, string[]>();
  for (const c of db()
    .prepare("SELECT dc.document_id, dc.collection_id FROM document_collections dc JOIN collections c ON c.id = dc.collection_id WHERE c.user_id = ?")
    .all(userId) as { document_id: string; collection_id: string }[]) {
    (cols.get(c.document_id) ?? cols.set(c.document_id, []).get(c.document_id)!).push(c.collection_id);
  }
  return rows.map((r) => presentDocument(r, { tags: tags.get(r.id), collections: cols.get(r.id) }));
}

export async function ingestDocument(userId: string, rawName: string, bytes: Uint8Array) {
  if (bytes.byteLength === 0) throw new AppError(422, "empty_document", "This file is empty.");
  if (bytes.byteLength > config.limits.maxUploadBytes) {
    throw new AppError(413, "too_large", `File is larger than the ${Math.round(config.limits.maxUploadBytes / 1048576)} MB limit.`);
  }
  const filename = safeFilename(rawName);
  const kind = sniffKind(filename, bytes);
  const count = (db().prepare("SELECT count(*) AS n FROM documents WHERE user_id = ?").get(userId) as { n: number }).n;
  if (count >= config.limits.maxDocumentsPerUser) throw new AppError(409, "library_full", "Your library has reached its document limit.");

  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const dup = db().prepare("SELECT id, title FROM documents WHERE user_id = ? AND sha256 = ?").get(userId, sha256) as { id: string; title: string } | undefined;
  if (dup) throw new AppError(409, "duplicate", `This file is already in your library as "${dup.title}".`, { documentId: dup.id });

  // Parse before storing anything: a file that cannot be read never reaches the library.
  const ex = await extract(filename, bytes);
  const chunks = chunkPages(ex.pages, ex.headings);
  if (chunks.length === 0) throw new AppError(422, "empty_document", "No readable text was found in this file.");

  const id = crypto.randomUUID();
  const now = Date.now();
  documentFiles.write(userId, id, bytes);
  try {
    tx(() => {
      db()
        .prepare(
          `INSERT INTO documents (id, user_id, title, filename, mime, kind, size_bytes, sha256, status, semantic, page_count, chunk_count, word_count, meta_json, created_at, processed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(id, userId, ex.title, filename, MIME[kind], kind, bytes.byteLength, sha256, "ready", nearConfigured() ? 0 : 3, ex.pages.length, chunks.length, ex.pages.reduce((n, p) => n + countWords(p.text), 0), JSON.stringify(ex.meta), now, now);
      const insPage = db().prepare("INSERT INTO pages (document_id, user_id, page, text) VALUES (?,?,?,?)");
      for (const p of ex.pages) insPage.run(id, userId, p.page, p.text);
      const insChunk = db().prepare("INSERT INTO chunks (user_id, document_id, ordinal, page, heading, char_start, char_end, text) VALUES (?,?,?,?,?,?,?,?)");
      for (const c of chunks) insChunk.run(userId, id, c.ordinal, c.page, c.heading, c.charStart, c.charEnd, c.text);
    });
  } catch (e) {
    documentFiles.remove(userId, id);
    throw e;
  }
  logActivity(userId, "upload", `Added "${ex.title}" (${ex.pages.length} page${ex.pages.length === 1 ? "" : "s"}, ${chunks.length} passages)`);
  if (nearConfigured()) enqueueEmbedding(userId, id);
  return presentDocument(getOwnedDocument(userId, id));
}

// ---- Embedding queue: one document at a time, in this process ----
type Q = typeof globalThis & { __morrowQueue?: { chain: Promise<void>; inflight: Set<string> } };
const queue = ((globalThis as Q).__morrowQueue ??= { chain: Promise.resolve(), inflight: new Set<string>() });

export function enqueueEmbedding(userId: string, docId: string): void {
  if (queue.inflight.has(docId)) return;
  queue.inflight.add(docId);
  queue.chain = queue.chain
    .then(() => embedDocument(userId, docId))
    .catch(() => {})
    .finally(() => {
      queue.inflight.delete(docId);
    });
}

/** Re-queue documents that are waiting for embeddings (e.g. the key was added after upload, or the server restarted). */
export function resumePendingEmbeddings(userId: string): void {
  if (!nearConfigured()) return;
  const rows = db().prepare("SELECT id FROM documents WHERE user_id = ? AND semantic IN (0, 3)").all(userId) as { id: string }[];
  for (const r of rows) {
    db().prepare("UPDATE documents SET semantic = 0, error = NULL WHERE id = ? AND user_id = ?").run(r.id, userId);
    enqueueEmbedding(userId, r.id);
  }
}

export async function embedDocument(userId: string, docId: string): Promise<void> {
  const doc = db().prepare("SELECT title FROM documents WHERE id = ? AND user_id = ?").get(docId, userId) as { title: string } | undefined;
  if (!doc) return; // deleted while queued
  try {
    const chunks = db().prepare("SELECT id, heading, text FROM chunks WHERE document_id = ? AND user_id = ? ORDER BY ordinal").all(docId, userId) as { id: number; heading: string | null; text: string }[];
    assertQuota(userId, "index", chunks.length);
    const { vectors } = await embed(chunks.map((c) => embeddingInput(doc.title, c)), { userId, purpose: "index" });
    const dim = vectors[0]?.length || 0;
    const centroid = new Float32Array(dim);
    for (const v of vectors) for (let i = 0; i < dim; i++) centroid[i] += v[i];
    normalizeVec(centroid);
    tx(() => {
      const up = db().prepare("UPDATE chunks SET embedding = ? WHERE id = ? AND user_id = ?");
      chunks.forEach((c, i) => up.run(vecToBlob(vectors[i]), c.id, userId));
      db().prepare("UPDATE documents SET semantic = 1, error = NULL, centroid = ? WHERE id = ? AND user_id = ?").run(vecToBlob(centroid), docId, userId);
    });
    bumpVectorVersion(userId);
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "Embedding failed.";
    db().prepare("UPDATE documents SET semantic = 2, error = ? WHERE id = ? AND user_id = ?").run(msg.slice(0, 300), docId, userId);
    throw e;
  }
}

export function retryEmbedding(userId: string, docId: string): void {
  getOwnedDocument(userId, docId);
  if (!nearConfigured()) throw new AppError(503, "near_not_configured", "NEAR AI Cloud is not configured, so semantic indexing is unavailable.");
  db().prepare("UPDATE documents SET semantic = 0, error = NULL WHERE id = ? AND user_id = ?").run(docId, userId);
  enqueueEmbedding(userId, docId);
}

/** Saved answers that quote a document are deleted with it, so no excerpt outlives its source. */
function answersCiting(userId: string, docId: string): string[] {
  const rows = db().prepare("SELECT id, sources_json FROM answers WHERE user_id = ?").all(userId) as { id: string; sources_json: string }[];
  return rows.filter((r) => (JSON.parse(r.sources_json) as { documentId: string }[]).some((s) => s.documentId === docId)).map((r) => r.id);
}

export function deletionImpact(userId: string, docId: string): { answers: number } {
  getOwnedDocument(userId, docId);
  return { answers: answersCiting(userId, docId).length };
}

export function deleteDocument(userId: string, docId: string): { deletedAnswers: number } {
  const doc = getOwnedDocument(userId, docId);
  const answerIds = answersCiting(userId, docId);
  tx(() => {
    for (const a of answerIds) db().prepare("DELETE FROM answers WHERE id = ? AND user_id = ?").run(a, userId);
    db().prepare("DELETE FROM chunks WHERE document_id = ? AND user_id = ?").run(docId, userId); // fires FTS delete triggers
    db().prepare("DELETE FROM documents WHERE id = ? AND user_id = ?").run(docId, userId);
  });
  for (const a of answerIds) deleteReceipt(userId, a);
  documentFiles.remove(userId, docId);
  bumpVectorVersion(userId);
  compact();
  logActivity(userId, "delete", `Deleted "${doc.title}"${answerIds.length ? ` and ${answerIds.length} saved answer(s) that quoted it` : ""}`);
  return { deletedAnswers: answerIds.length };
}

/** secure_delete zeroes freed pages; truncating the WAL removes the last on-disk copy of deleted rows. */
export function compact(): void {
  try {
    db().exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    /* another connection holds the WAL; it is truncated on the next checkpoint */
  }
}

export function deleteAllUserData(userId: string): void {
  const docs = db().prepare("SELECT id FROM documents WHERE user_id = ?").all(userId) as { id: string }[];
  const answers = db().prepare("SELECT id FROM answers WHERE user_id = ?").all(userId) as { id: string }[];
  tx(() => {
    anonymiseUsage(userId); // keep counts for app-wide budgets, without the link to this person
    db().prepare("DELETE FROM chunks WHERE user_id = ?").run(userId);
    db().prepare("DELETE FROM users WHERE id = ?").run(userId); // cascades to everything else
  });
  for (const d of docs) documentFiles.remove(userId, d.id);
  for (const a of answers) deleteReceipt(userId, a.id);
  removeUserStorage(userId);
  bumpVectorVersion(userId);
  compact();
}

// ---- In-memory vector index, rebuilt per user when their embeddings change ----
export type VectorIndex = { ids: number[]; docIds: string[]; vectors: Float32Array[] };
type V = typeof globalThis & { __morrowVec?: Map<string, { version: number; index: VectorIndex }>; __morrowVecVer?: Map<string, number> };
const vecCache = ((globalThis as V).__morrowVec ??= new Map());
const vecVersion = ((globalThis as V).__morrowVecVer ??= new Map<string, number>());

export function bumpVectorVersion(userId: string): void {
  vecVersion.set(userId, (vecVersion.get(userId) || 0) + 1);
}

export function vectorIndex(userId: string): VectorIndex {
  const version = vecVersion.get(userId) || 0;
  const cached = vecCache.get(userId);
  if (cached && cached.version === version) return cached.index;
  const rows = db().prepare("SELECT id, document_id, embedding FROM chunks WHERE user_id = ? AND embedding IS NOT NULL").all(userId) as { id: number; document_id: string; embedding: Uint8Array }[];
  const index: VectorIndex = { ids: [], docIds: [], vectors: [] };
  for (const r of rows) {
    index.ids.push(r.id);
    index.docIds.push(r.document_id);
    index.vectors.push(blobToVec(r.embedding));
  }
  vecCache.set(userId, { version, index });
  return index;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
