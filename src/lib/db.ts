import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

/**
 * Storage: one SQLite file (Node's built-in driver, no native add-on) under MORROW_DATA_DIR.
 * Every user-owned table carries user_id and every query in the app filters on it.
 */
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA secure_delete = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  kind TEXT NOT NULL,              -- pdf | text | markdown
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL,            -- processing | ready | failed
  semantic INTEGER NOT NULL DEFAULT 0, -- 1 when every chunk has an embedding
  error TEXT,
  page_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT NOT NULL DEFAULT '{}',
  centroid BLOB,
  created_at INTEGER NOT NULL,
  processed_at INTEGER
);
CREATE INDEX IF NOT EXISTS documents_user ON documents(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS documents_user_sha ON documents(user_id, sha256);

CREATE TABLE IF NOT EXISTS pages (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (document_id, page)
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  page INTEGER NOT NULL,
  heading TEXT,
  char_start INTEGER NOT NULL,     -- offset within the page text
  char_end INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB
);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(document_id, ordinal);
CREATE INDEX IF NOT EXISTS chunks_user ON chunks(user_id);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, heading, content='chunks', content_rowid='id', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text, heading) VALUES (new.id, new.text, coalesce(new.heading, ''));
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, heading) VALUES ('delete', old.id, old.text, coalesce(old.heading, ''));
END;

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, name)
);
CREATE TABLE IF NOT EXISTS document_collections (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, collection_id)
);
CREATE TABLE IF NOT EXISTS document_tags (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (document_id, tag)
);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  grounded INTEGER NOT NULL,
  sources_json TEXT NOT NULL,
  verification_json TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '{}',
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS answers_user ON answers(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_user ON activity(user_id, created_at DESC);
`;

/**
 * Additive migrations, applied once each and tracked in PRAGMA user_version.
 * They only add tables and nullable columns: no existing data is rewritten or dropped.
 */
const MIGRATIONS: string[] = [
  // v1 -> v2 (Phase 2 hardening)
  `
  ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
  ALTER TABLE users ADD COLUMN password_changed_at INTEGER;
  -- Accounts that existed before verification was introduced are treated as verified.
  UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

  ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;
  ALTER TABLE sessions ADD COLUMN user_agent TEXT;

  CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,           -- reset | verify
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id, purpose);

  -- Fixed-window counters. key_hash is SHA-256 of the logical key, so no email or IP is stored here.
  CREATE TABLE IF NOT EXISTS rate_limits (
    key_hash TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    reset_at INTEGER NOT NULL
  );

  -- One row per call to NEAR AI Cloud. Counts only: never prompts, passages or answers.
  -- user_id is deliberately not a cascading foreign key: when an account is deleted its rows are
  -- anonymised (user_id = NULL) so app-wide spending totals cannot be reset by deleting accounts.
  CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    kind TEXT NOT NULL,              -- chat | embedding | rerank
    purpose TEXT NOT NULL,           -- ask | search | index
    model TEXT NOT NULL,
    units INTEGER NOT NULL,          -- questions, passages embedded or passages reranked
    prompt_tokens INTEGER,           -- NULL when the provider did not report usage
    completion_tokens INTEGER,
    total_tokens INTEGER,
    status TEXT NOT NULL,            -- ok | error
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS usage_user_time ON usage_events(user_id, created_at);
  CREATE INDEX IF NOT EXISTS usage_time ON usage_events(created_at);
  `,
];

type G = typeof globalThis & { __morrowDb?: DatabaseSync; __morrowDbPath?: string };

export function dataPath(...parts: string[]): string {
  return path.join(config.dataDir, ...parts);
}

/** The database, its write-ahead log and shared-memory file are readable by the server's user only. */
export function lockDownDatabaseFiles(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.chmodSync(dataPath("morrow.sqlite" + suffix), 0o600);
    } catch {
      /* the file does not exist yet */
    }
  }
}

export function db(): DatabaseSync {
  const g = globalThis as G;
  const file = dataPath("morrow.sqlite");
  if (g.__morrowDb && g.__morrowDbPath === file) return g.__morrowDb;
  for (const dir of [config.dataDir, dataPath("files"), dataPath("receipts")]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
  }
  // Create the file with owner-only permissions before SQLite opens it; SQLite gives the
  // -wal and -shm files the same mode as the main database file.
  if (!fs.existsSync(file)) fs.closeSync(fs.openSync(file, "a", 0o600));
  fs.chmodSync(file, 0o600);
  const d = new DatabaseSync(file);
  d.exec("PRAGMA busy_timeout = 5000");
  d.exec(SCHEMA);
  const current = (d.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  const start = Math.max(current, 1) - 1;
  for (let i = start; i < MIGRATIONS.length; i++) {
    d.exec("BEGIN IMMEDIATE");
    try {
      d.exec(MIGRATIONS[i]);
      d.exec(`PRAGMA user_version = ${i + 2}`);
      d.exec("COMMIT");
    } catch (e) {
      d.exec("ROLLBACK");
      throw e;
    }
  }
  g.__morrowDb = d;
  g.__morrowDbPath = file;
  lockDownDatabaseFiles();
  return d;
}

export const SCHEMA_VERSION = MIGRATIONS.length + 1;

/** Run fn inside a transaction; rolls back on throw. */
let txDepth = 0;
export function tx<T>(fn: () => T): T {
  const d = db();
  // Nested calls join the outer transaction instead of failing on a second BEGIN.
  if (txDepth > 0) return fn();
  d.exec("BEGIN IMMEDIATE");
  txDepth++;
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  } finally {
    txDepth--;
  }
}

export function logActivity(userId: string, kind: string, detail: string): void {
  db().prepare("INSERT INTO activity (user_id, kind, detail, created_at) VALUES (?,?,?,?)").run(userId, kind, detail.slice(0, 300), Date.now());
}

export function vecToBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}
export function blobToVec(b: Uint8Array): Float32Array {
  // Copy: SQLite buffers are not guaranteed to be 4-byte aligned.
  const copy = new Uint8Array(b.byteLength);
  copy.set(b);
  return new Float32Array(copy.buffer);
}
