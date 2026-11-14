import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client, PASSWORD, sample, upload, userIdOf } from "./helpers";
import * as signup from "@/app/api/auth/signup/route";
import * as documents from "@/app/api/documents/route";
import * as documentFile from "@/app/api/documents/[id]/file/route";
import * as privacy from "@/app/api/privacy/route";
import { config } from "@/lib/config";
import { dataPath, db } from "@/lib/db";
import { assertId, documentFiles, encryptionEnabled, receiptFiles } from "@/lib/storage";

const mode = (p: string) => (fs.statSync(p).mode & 0o777).toString(8);
const code = (fn: () => unknown) => {
  try {
    fn();
    return "no error";
  } catch (e) {
    return (e as { code?: string }).code;
  }
};
const A = crypto.randomUUID();
const B = crypto.randomUUID();

afterEach(() => {
  delete process.env.MORROW_ENCRYPTION_KEY;
});

describe("path safety", () => {
  it("accepts only server-style UUIDs as identifiers", () => {
    for (const bad of ["..", "../x", "a/b", "..%2f", "C:\\x", "", " ", A + "/..", A + "\0", A.toUpperCase(), "x".repeat(36), 42, null, undefined, { toString: () => A }]) {
      expect(code(() => assertId(bad))).toBe("invalid");
    }
    expect(assertId(A)).toBe(A);
  });

  it("refuses traversal through either the user or the document identifier", () => {
    for (const bad of ["../" + A, "..", "../../etc/passwd", "."]) {
      expect(code(() => documentFiles.read(bad, A))).toBe("invalid");
      expect(code(() => documentFiles.read(A, bad))).toBe("invalid");
      expect(code(() => documentFiles.write(A, bad, new Uint8Array([1])))).toBe("invalid");
      expect(code(() => receiptFiles.read(A, bad))).toBe("invalid");
      expect(code(() => receiptFiles.write(bad, A, "{}"))).toBe("invalid");
      expect(code(() => documentFiles.remove(A, bad))).toBe("invalid");
    }
  });

  it("stores each user's files in their own directory with owner-only permissions", () => {
    db();
    const doc = crypto.randomUUID();
    documentFiles.write(A, doc, Buffer.from("alpha"));
    const p = documentFiles.path(A, doc);
    expect(p).toBe(path.join(config.dataDir, "files", A, doc));
    expect(mode(p)).toBe("600");
    expect(mode(path.dirname(p))).toBe("700");
    expect(mode(dataPath("files"))).toBe("700");
    expect(documentFiles.read(A, doc)?.toString()).toBe("alpha");
    expect(documentFiles.read(B, doc)).toBeNull(); // same id, different owner: nothing
    receiptFiles.write(A, doc, '{"r":1}');
    expect(mode(receiptFiles.path(A, doc))).toBe("600");
    expect(receiptFiles.read(B, doc)).toBeNull();
    expect(fs.readdirSync(path.dirname(p)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("does not follow a symlink planted in the data directory", () => {
    const doc = crypto.randomUUID();
    const secret = path.join(config.dataDir, "outside-secret.txt");
    fs.writeFileSync(secret, "TOP SECRET");
    fs.mkdirSync(path.join(config.dataDir, "files", A), { recursive: true });
    fs.symlinkSync(secret, path.join(config.dataDir, "files", A, doc));
    expect(documentFiles.read(A, doc)).toBeNull();
  });

  it("still reads files stored before per-user directories existed, for their owner only", () => {
    const doc = crypto.randomUUID();
    fs.writeFileSync(path.join(config.dataDir, "files", doc), "legacy bytes");
    expect(documentFiles.read(A, doc)?.toString()).toBe("legacy bytes");
    documentFiles.remove(A, doc);
    expect(fs.existsSync(path.join(config.dataDir, "files", doc))).toBe(false);
  });
});

describe("database files", () => {
  it("are readable by the server's user only", () => {
    db().prepare("SELECT 1").get();
    expect(mode(config.dataDir)).toBe("700");
    for (const f of ["morrow.sqlite", "morrow.sqlite-wal", "morrow.sqlite-shm"]) {
      if (fs.existsSync(dataPath(f))) expect(mode(dataPath(f))).toBe("600");
    }
    expect(fs.existsSync(dataPath("morrow.sqlite"))).toBe(true);
  });
});

describe("encryption at rest (opt-in)", () => {
  const key = () => crypto.randomBytes(32).toString("base64");

  it("is off without a key and says so", async () => {
    expect(encryptionEnabled()).toBe(false);
    const c = new Client();
    await c.call(signup.POST, "POST", "/api/auth/signup", { json: { email: "plain@example.test", password: PASSWORD } });
    expect((await c.call(privacy.GET, "GET", "/api/privacy")).data.storage.encryptedAtRest).toBe(false);
  });

  it("seals files so the plaintext is not on disk, and opens them for the owner", () => {
    process.env.MORROW_ENCRYPTION_KEY = key();
    const doc = crypto.randomUUID();
    const plain = Buffer.from("The security deposit is 2,200 dollars. ".repeat(20));
    documentFiles.write(A, doc, plain);
    const raw = fs.readFileSync(documentFiles.path(A, doc));
    expect(raw.subarray(0, 6).toString("latin1")).toBe("MORROW");
    expect(raw.includes(Buffer.from("security deposit"))).toBe(false);
    expect(raw.length).toBe(plain.length + 8 + 12 + 16);
    expect(documentFiles.read(A, doc)?.equals(plain)).toBe(true);
    // Two writes of the same content differ (fresh nonce each time).
    const doc2 = crypto.randomUUID();
    documentFiles.write(A, doc2, plain);
    expect(fs.readFileSync(documentFiles.path(A, doc2)).subarray(8).equals(raw.subarray(8))).toBe(false);
  });

  it("fails closed when a sealed file is moved to another user, renamed, altered, or the key is wrong or missing", () => {
    process.env.MORROW_ENCRYPTION_KEY = key();
    const doc = crypto.randomUUID();
    documentFiles.write(A, doc, Buffer.from("alice only"));
    const sealed = fs.readFileSync(documentFiles.path(A, doc));

    fs.mkdirSync(path.join(config.dataDir, "files", B), { recursive: true });
    fs.writeFileSync(path.join(config.dataDir, "files", B, doc), sealed); // copied into Bob's directory
    expect(code(() => documentFiles.read(B, doc))).toBe("decrypt_failed");

    const other = crypto.randomUUID();
    fs.writeFileSync(path.join(config.dataDir, "files", A, other), sealed); // renamed to another id
    expect(code(() => documentFiles.read(A, other))).toBe("decrypt_failed");

    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 20] ^= 1;
    fs.writeFileSync(documentFiles.path(A, doc), flipped);
    expect(code(() => documentFiles.read(A, doc))).toBe("decrypt_failed");
    fs.writeFileSync(documentFiles.path(A, doc), sealed);

    process.env.MORROW_ENCRYPTION_KEY = key(); // a different key
    expect(code(() => documentFiles.read(A, doc))).toBe("decrypt_failed");
    delete process.env.MORROW_ENCRYPTION_KEY; // no key at all: never returns ciphertext as if it were the file
    expect(code(() => documentFiles.read(A, doc))).toBe("encryption_key_missing");
  });

  it("keeps reading files written before encryption was switched on", () => {
    const doc = crypto.randomUUID();
    documentFiles.write(A, doc, Buffer.from("written in the clear"));
    process.env.MORROW_ENCRYPTION_KEY = key();
    expect(documentFiles.read(A, doc)?.toString()).toBe("written in the clear");
  });

  it("rejects a malformed key instead of silently storing plaintext", () => {
    process.env.MORROW_ENCRYPTION_KEY = "too-short";
    expect(() => documentFiles.write(A, crypto.randomUUID(), Buffer.from("x"))).toThrow(/32 bytes/);
  });

  it("works end to end: an uploaded document is sealed on disk and downloads intact", async () => {
    process.env.MORROW_ENCRYPTION_KEY = key();
    const c = new Client();
    await c.call(signup.POST, "POST", "/api/auth/signup", { json: { email: "sealed@example.test", password: PASSWORD } });
    const original = sample("home-maintenance-log.pdf");
    const up = await c.call(documents.POST, "POST", "/api/documents", { form: upload("home-maintenance-log.pdf", original) });
    expect(up.status).toBe(201);
    const id = up.data.document.id;
    const onDisk = fs.readFileSync(documentFiles.path(userIdOf("sealed@example.test"), id));
    expect(onDisk.subarray(0, 5).toString("latin1")).not.toBe("%PDF-");
    const { GET } = documentFile;
    const res = await GET(new Request(`http://localhost:3000/api/documents/${id}/file`, { headers: { cookie: c.cookie, host: "localhost:3000" } }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(original))).toBe(true);
    expect((await c.call(privacy.GET, "GET", "/api/privacy")).data.storage.encryptedAtRest).toBe(true);
  });
});
