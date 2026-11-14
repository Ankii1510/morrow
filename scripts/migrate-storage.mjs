#!/usr/bin/env node
// Move stored files into per-user directories and, if MORROW_ENCRYPTION_KEY is set, encrypt them.
//
//   node scripts/migrate-storage.mjs            dry run: prints what would change, changes nothing
//   node scripts/migrate-storage.mjs --apply    performs the migration
//
// Reads MORROW_DATA_DIR and MORROW_ENCRYPTION_KEY from the environment or .env.local.
// Safe to re-run. Stop Morrow and take a backup (npm run backup) first.
//
// KEY MANAGEMENT: once files are encrypted, the key is the only way to read them. If it is lost,
// the original files and receipts are unrecoverable (extracted text in the database is not affected).
// Keep a copy of the key somewhere other than the server and its backups.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const apply = process.argv.includes("--apply");
const dataDir = path.resolve(process.env.MORROW_DATA_DIR || "./data");
const MAGIC = Buffer.from("MORROW\x01\x00", "latin1");
const rawKey = process.env.MORROW_ENCRYPTION_KEY?.trim();
const master = rawKey ? (/^[0-9a-fA-F]{64}$/.test(rawKey) ? Buffer.from(rawKey, "hex") : Buffer.from(rawKey, "base64")) : null;
if (master && master.length !== 32) {
  console.error("MORROW_ENCRYPTION_KEY must be 32 bytes (base64, or 64 hex characters).");
  process.exit(2);
}
const userKey = (userId) => Buffer.from(crypto.hkdfSync("sha256", master, Buffer.from("morrow-storage-v1"), Buffer.from(`user:${userId}`), 32));
const isSealed = (b) => b.length >= MAGIC.length && b.subarray(0, MAGIC.length).equals(MAGIC);
function seal(kind, userId, id, plain) {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", userKey(userId), nonce);
  c.setAAD(Buffer.from(`${kind}:${userId}:${id}`));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, nonce, body, c.getAuthTag()]);
}
function open(kind, userId, id, stored) {
  const d = crypto.createDecipheriv("aes-256-gcm", userKey(userId), stored.subarray(8, 20));
  d.setAAD(Buffer.from(`${kind}:${userId}:${id}`));
  d.setAuthTag(stored.subarray(stored.length - 16));
  return Buffer.concat([d.update(stored.subarray(20, stored.length - 16)), d.final()]);
}

const dbFile = path.join(dataDir, "morrow.sqlite");
if (!fs.existsSync(dbFile)) {
  console.error(`No database at ${dbFile}`);
  process.exit(2);
}
const db = new DatabaseSync(dbFile, { readOnly: true });
const items = [
  ...db.prepare("SELECT id, user_id, sha256 FROM documents").all().map((r) => ({ kind: "file", id: r.id, userId: r.user_id, sha256: r.sha256 })),
  ...db.prepare("SELECT id, user_id FROM answers").all().map((r) => ({ kind: "receipt", id: r.id, userId: r.user_id })),
];
db.close();

console.log(`${apply ? "APPLYING" : "DRY RUN"} · data: ${dataDir} · encryption: ${master ? "on (key present)" : "off (no MORROW_ENCRYPTION_KEY)"}\n`);
const stats = { moved: 0, encrypted: 0, alreadyDone: 0, missing: 0, failed: 0 };
for (const it of items) {
  const base = path.join(dataDir, it.kind === "file" ? "files" : "receipts");
  const name = it.kind === "file" ? it.id : `${it.id}.json`;
  const target = path.join(base, it.userId, name);
  const legacy = it.kind === "file" ? path.join(base, it.id) : path.join(base, `${crypto.createHash("sha256").update(it.userId).digest("hex").slice(0, 24)}-${it.id}.json`);
  const source = fs.existsSync(target) ? target : fs.existsSync(legacy) ? legacy : null;
  if (!source) {
    stats.missing++;
    console.log(`  missing   ${it.kind} ${it.id}`);
    continue;
  }
  try {
    const stored = fs.readFileSync(source);
    const sealed = isSealed(stored);
    const willMove = source !== target;
    const willEncrypt = Boolean(master) && !sealed;
    if (!willMove && !willEncrypt) {
      stats.alreadyDone++;
      continue;
    }
    const plain = sealed ? (master ? open(it.kind, it.userId, it.id, stored) : null) : stored;
    // For documents, prove the bytes are the ones that were uploaded before touching anything.
    if (it.kind === "file" && plain && crypto.createHash("sha256").update(plain).digest("hex") !== it.sha256) throw new Error("content does not match the checksum recorded at upload");
    const out = willEncrypt ? seal(it.kind, it.userId, it.id, plain) : stored;
    console.log(`  ${willMove ? "move" : "    "} ${willEncrypt ? "+ encrypt" : "         "} ${it.kind} ${it.id}`);
    if (apply) {
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.chmodSync(path.dirname(target), 0o700);
      const tmp = `${target}.migrating`;
      fs.writeFileSync(tmp, out, { mode: 0o600 });
      // Read back and verify before the original is removed.
      const check = fs.readFileSync(tmp);
      const verify = isSealed(check) ? open(it.kind, it.userId, it.id, check) : check;
      if (plain && !verify.equals(plain)) throw new Error("verification after write failed; original left in place");
      fs.renameSync(tmp, target);
      if (willMove) fs.rmSync(source);
    }
    if (willMove) stats.moved++;
    if (willEncrypt) stats.encrypted++;
  } catch (e) {
    stats.failed++;
    console.log(`  FAILED    ${it.kind} ${it.id}: ${e.message}`);
  }
}
console.log(`\n${JSON.stringify(stats)}`);
if (!apply) console.log("Nothing was changed. Re-run with --apply to perform the migration.");
process.exit(stats.failed ? 1 : 0);
