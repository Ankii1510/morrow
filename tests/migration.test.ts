import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client, PASSWORD, sample, seedAnswer, upload, userIdOf } from "./helpers";
import * as signup from "@/app/api/auth/signup/route";
import * as documents from "@/app/api/documents/route";
import * as documentFile from "@/app/api/documents/[id]/file/route";
import * as answerReceipt from "@/app/api/answers/[id]/receipt/route";
import { config } from "@/lib/config";
import { db, SCHEMA_VERSION } from "@/lib/db";
import { documentFiles, receiptFiles } from "@/lib/storage";

afterEach(() => {
  delete process.env.MORROW_ENCRYPTION_KEY;
});

function migrate(args: string[], key?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, MORROW_DATA_DIR: config.dataDir };
  delete env.MORROW_ENCRYPTION_KEY;
  if (key) env.MORROW_ENCRYPTION_KEY = key;
  // Run from the data directory so the script cannot pick up the developer's .env.local.
  return execFileSync("node", [path.resolve("scripts/migrate-storage.mjs"), ...args], { encoding: "utf8", env, cwd: config.dataDir });
}

describe("storage migration script", () => {
  it("moves pre-Phase-2 files into per-user directories and encrypts them, without changing their content", async () => {
    const c = new Client();
    await c.call(signup.POST, "POST", "/api/auth/signup", { json: { email: "legacy@example.test", password: PASSWORD } });
    const uid = userIdOf("legacy@example.test");
    const original = sample("home-maintenance-log.pdf");
    const id = (await c.call(documents.POST, "POST", "/api/documents", { form: upload("home-maintenance-log.pdf", original) })).data.document.id;
    const answerId = seedAnswer(uid, id);

    // Recreate the layout the app used before Phase 2: flat files, hash-prefixed receipts.
    const legacyFile = path.join(config.dataDir, "files", id);
    const legacyReceipt = path.join(config.dataDir, "receipts", `${crypto.createHash("sha256").update(uid).digest("hex").slice(0, 24)}-${answerId}.json`);
    fs.renameSync(documentFiles.path(uid, id), legacyFile);
    fs.renameSync(receiptFiles.path(uid, answerId), legacyReceipt);
    const receiptBefore = fs.readFileSync(legacyReceipt, "utf8");

    // The app still serves the legacy layout before any migration.
    expect((await c.call(documentFile.GET, "GET", `/api/documents/${id}/file`, { params: { id } })).status).toBe(200);

    // Dry run changes nothing.
    const key = crypto.randomBytes(32).toString("base64");
    expect(migrate([], key)).toContain("Nothing was changed");
    expect(fs.existsSync(legacyFile) && fs.existsSync(legacyReceipt)).toBe(true);

    const out = migrate(["--apply"], key);
    expect(out).toContain('"moved":2,"encrypted":2');
    expect(out).toContain('"failed":0');
    expect(fs.existsSync(legacyFile) || fs.existsSync(legacyReceipt)).toBe(false);
    const sealed = fs.readFileSync(documentFiles.path(uid, id));
    expect(sealed.subarray(0, 6).toString("latin1")).toBe("MORROW");
    expect(sealed.includes(Buffer.from("%PDF-"))).toBe(false);
    expect((fs.statSync(documentFiles.path(uid, id)).mode & 0o777).toString(8)).toBe("600");

    // The app reads the migrated, encrypted files with the key, byte for byte.
    process.env.MORROW_ENCRYPTION_KEY = key;
    const res = await documentFile.GET(new Request(`http://localhost:3000/api/documents/${id}/file`, { headers: { cookie: c.cookie, host: "localhost:3000" } }), { params: Promise.resolve({ id }) });
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(original))).toBe(true);
    const receipt = await c.call(answerReceipt.GET, "GET", `/api/answers/${answerId}/receipt`, { params: { id: answerId } });
    expect(JSON.stringify(receipt.data)).toBe(JSON.stringify(JSON.parse(receiptBefore)));

    // Running it again is a no-op.
    expect(migrate(["--apply"], key)).toContain('"moved":0,"encrypted":0,"alreadyDone":2');
  });

  it("refuses to touch a file whose content no longer matches its upload checksum", async () => {
    const c = new Client();
    await c.call(signup.POST, "POST", "/api/auth/signup", { json: { email: "corrupt@example.test", password: PASSWORD } });
    const uid = userIdOf("corrupt@example.test");
    const id = (await c.call(documents.POST, "POST", "/api/documents", { form: upload("lease-agreement-2025.md", sample("lease-agreement-2025.md")) })).data.document.id;
    const legacy = path.join(config.dataDir, "files", id);
    fs.renameSync(documentFiles.path(uid, id), legacy);
    fs.appendFileSync(legacy, "tampered");
    let failed = "";
    try {
      migrate(["--apply"], crypto.randomBytes(32).toString("base64"));
    } catch (e) {
      failed = (e as { stdout: string }).stdout;
    }
    expect(failed).toContain("FAILED");
    expect(fs.existsSync(legacy)).toBe(true); // left exactly where it was
  });
});

describe("database migration", () => {
  it("upgrades a Phase 1 database in place without losing rows", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const dir = fs.mkdtempSync(path.join(config.dataDir, "v1-"));
    const file = path.join(dir, "morrow.sqlite");
    const old = new DatabaseSync(file);
    // The Phase 1 shape of the two tables that Phase 2 alters.
    old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
              CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
              INSERT INTO users VALUES ('u1', 'old@example.test', 'scrypt$x', 1700000000000);
              INSERT INTO sessions VALUES ('h1', 'u1', 1700000000000, 9999999999999);`);
    old.close();
    const previous = process.env.MORROW_DATA_DIR;
    process.env.MORROW_DATA_DIR = dir;
    try {
      const d = db();
      expect((d.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
      const u = d.prepare("SELECT email, email_verified_at, created_at FROM users WHERE id = 'u1'").get() as { email: string; email_verified_at: number; created_at: number };
      expect(u.email).toBe("old@example.test");
      expect(u.email_verified_at).toBe(u.created_at); // existing accounts are not locked out by verification
      expect((d.prepare("SELECT count(*) AS n FROM sessions").get() as { n: number }).n).toBe(1);
      for (const t of ["auth_tokens", "rate_limits", "usage_events"]) expect(d.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(t)).toBeTruthy();
      expect((fs.statSync(file).mode & 0o777).toString(8)).toBe("600");
    } finally {
      process.env.MORROW_DATA_DIR = previous;
      db(); // reopen the test database
    }
  });
});
