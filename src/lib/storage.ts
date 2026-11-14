import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { dataPath } from "./db";
import { AppError } from "./http";

/**
 * All file access for user content goes through this module.
 *
 * - Paths are built only from server-generated UUIDs that are validated here; nothing supplied
 *   by a browser is ever used as a path segment without passing `assertId`.
 * - Each user has their own directory: files/<userId>/<documentId>, receipts/<userId>/<answerId>.json.
 *   The caller passes the authenticated user's id, so a document id belonging to someone else
 *   resolves to a path that does not exist.
 * - Directories are 0700 and files 0600.
 * - When MORROW_ENCRYPTION_KEY is set, content is sealed with AES-256-GCM under a per-user key
 *   derived from the master key. The owner, kind and id are bound in as associated data, so a
 *   sealed file copied to another user's directory, or renamed, fails to open.
 *
 * Files written before per-user directories existed (flat files/<documentId>) are still readable
 * through a legacy fallback, and are only ever reached after the database ownership check.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAGIC = Buffer.from("MORROW\x01\x00", "latin1");
type Kind = "file" | "receipt";

export function assertId(id: unknown, what = "id"): string {
  if (typeof id !== "string" || !UUID.test(id)) throw new AppError(400, "invalid", `Invalid ${what}.`);
  return id;
}

/** Join validated ids under a base directory and prove the result is still inside it. */
function inside(base: string, ...segments: string[]): string {
  const root = path.resolve(base);
  const full = path.resolve(root, ...segments);
  if (full !== root && !full.startsWith(root + path.sep)) throw new AppError(400, "invalid", "Invalid path.");
  return full;
}

function userDir(kind: Kind, userId: string): string {
  return inside(dataPath(kind === "file" ? "files" : "receipts"), assertId(userId, "user id"));
}

function target(kind: Kind, userId: string, id: string): string {
  return inside(userDir(kind, userId), assertId(id) + (kind === "receipt" ? ".json" : ""));
}

function legacyTarget(kind: Kind, userId: string, id: string): string {
  assertId(userId, "user id");
  assertId(id);
  if (kind === "file") return inside(dataPath("files"), id);
  const ns = crypto.createHash("sha256").update(userId).digest("hex").slice(0, 24);
  return inside(dataPath("receipts"), `${ns}-${id}.json`);
}

export function encryptionEnabled(): boolean {
  return config.security.encryptionKey !== undefined;
}

function userKey(userId: string): Buffer {
  const master = config.security.encryptionKey;
  if (!master) throw new AppError(500, "encryption_key_missing", "This content is encrypted, but the server has no encryption key configured.");
  return Buffer.from(crypto.hkdfSync("sha256", master, Buffer.from("morrow-storage-v1"), Buffer.from(`user:${userId}`), 32));
}

function aad(kind: Kind, userId: string, id: string): Buffer {
  return Buffer.from(`${kind}:${userId}:${id}`);
}

function seal(kind: Kind, userId: string, id: string, plain: Uint8Array): Buffer {
  if (!encryptionEnabled()) return Buffer.from(plain);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", userKey(userId), nonce);
  cipher.setAAD(aad(kind, userId, id));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, body, cipher.getAuthTag()]);
}

function open(kind: Kind, userId: string, id: string, stored: Buffer): Buffer {
  if (stored.length < MAGIC.length || !stored.subarray(0, MAGIC.length).equals(MAGIC)) return stored; // written before encryption was enabled
  try {
    const nonce = stored.subarray(MAGIC.length, MAGIC.length + 12);
    const tag = stored.subarray(stored.length - 16);
    const body = stored.subarray(MAGIC.length + 12, stored.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", userKey(userId), nonce);
    decipher.setAAD(aad(kind, userId, id));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch (e) {
    if (e instanceof AppError) throw e;
    // Wrong key, wrong owner, or the file was altered on disk.
    throw new AppError(500, "decrypt_failed", "A stored file could not be decrypted. It may have been altered, or the encryption key has changed.");
  }
}

function write(kind: Kind, userId: string, id: string, data: Uint8Array): void {
  const dir = userDir(kind, userId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const file = target(kind, userId, id);
  // Write to a temporary name and rename, so a crash never leaves a half-written file under the real name.
  const tmp = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, seal(kind, userId, id, data), { mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, file);
}

function read(kind: Kind, userId: string, id: string): Buffer | null {
  for (const p of [target(kind, userId, id), legacyTarget(kind, userId, id)]) {
    let stored: Buffer;
    try {
      // lstat + regular-file check: a symlink planted in the data directory is never followed.
      if (!fs.lstatSync(p).isFile()) continue;
      stored = fs.readFileSync(p);
    } catch {
      continue;
    }
    return open(kind, userId, id, stored);
  }
  return null;
}

function remove(kind: Kind, userId: string, id: string): void {
  fs.rmSync(target(kind, userId, id), { force: true });
  fs.rmSync(legacyTarget(kind, userId, id), { force: true });
}

export const documentFiles = {
  write: (userId: string, docId: string, bytes: Uint8Array) => write("file", userId, docId, bytes),
  read: (userId: string, docId: string) => read("file", userId, docId),
  remove: (userId: string, docId: string) => remove("file", userId, docId),
  /** Where a new file for this user and document is stored. For tests and diagnostics only. */
  path: (userId: string, docId: string) => target("file", userId, docId),
};

export const receiptFiles = {
  write: (userId: string, answerId: string, json: string) => write("receipt", userId, answerId, Buffer.from(json, "utf8")),
  read: (userId: string, answerId: string) => read("receipt", userId, answerId)?.toString("utf8") ?? null,
  remove: (userId: string, answerId: string) => remove("receipt", userId, answerId),
  path: (userId: string, answerId: string) => target("receipt", userId, answerId),
};

/** Remove a user's whole storage directories (after their individual files have been removed). */
export function removeUserStorage(userId: string): void {
  for (const kind of ["file", "receipt"] as const) fs.rmSync(userDir(kind, userId), { recursive: true, force: true });
}

/** Facts for the Privacy Center. Nothing here is asserted without checking the filesystem. */
export function storageStatus(): { encryptedAtRest: boolean; databaseEncrypted: false; dataDirMode: string; databaseMode: string } {
  const mode = (p: string) => {
    try {
      return (fs.statSync(p).mode & 0o777).toString(8).padStart(3, "0");
    } catch {
      return "unknown";
    }
  };
  return { encryptedAtRest: encryptionEnabled(), databaseEncrypted: false, dataDirMode: mode(config.dataDir), databaseMode: mode(dataPath("morrow.sqlite")) };
}
