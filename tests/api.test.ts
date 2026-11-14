import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { Client, sample, upload } from "./helpers";
import * as signup from "@/app/api/auth/signup/route";
import * as login from "@/app/api/auth/login/route";
import * as logout from "@/app/api/auth/logout/route";
import * as me from "@/app/api/me/route";
import * as documents from "@/app/api/documents/route";
import * as documentById from "@/app/api/documents/[id]/route";
import * as documentPages from "@/app/api/documents/[id]/pages/route";
import * as documentFile from "@/app/api/documents/[id]/file/route";
import * as documentRelated from "@/app/api/documents/[id]/related/route";
import * as searchRoute from "@/app/api/search/route";
import * as askRoute from "@/app/api/ask/route";
import * as collections from "@/app/api/collections/route";
import * as collectionById from "@/app/api/collections/[id]/route";
import * as account from "@/app/api/account/route";
import * as exportRoute from "@/app/api/export/route";
import * as privacy from "@/app/api/privacy/route";
import { db } from "@/lib/db";
import { documentFiles } from "@/lib/storage";

const userId = (email: string) => (db().prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;

const alice = new Client();
const bob = new Client();
const PASSWORD = "correct horse battery";
let leaseId = "";
let pdfId = "";

beforeAll(async () => {
  expect((await alice.call(signup.POST, "POST", "/api/auth/signup", { json: { email: "alice@example.test", password: PASSWORD } })).status).toBe(201);
  expect((await bob.call(signup.POST, "POST", "/api/auth/signup", { json: { email: "bob@example.test", password: PASSWORD } })).status).toBe(201);
});

describe("authentication", () => {
  it("rejects unauthenticated access to every data route", async () => {
    const anon = new Client();
    expect((await anon.call(documents.GET, "GET", "/api/documents")).status).toBe(401);
    expect((await anon.call(searchRoute.GET, "GET", "/api/search?q=rent")).status).toBe(401);
    expect((await anon.call(askRoute.POST, "POST", "/api/ask", { json: { question: "What is the rent?" } })).status).toBe(401);
    expect((await anon.call(exportRoute.GET, "GET", "/api/export")).status).toBe(401);
    expect((await anon.call(me.GET, "GET", "/api/me")).data.user).toBeNull();
  });

  it("rejects weak passwords, duplicate emails and wrong credentials", async () => {
    const c = new Client();
    expect((await c.call(signup.POST, "POST", "/api/auth/signup", { json: { email: "c@example.test", password: "short" } })).status).toBe(400);
    expect((await c.call(signup.POST, "POST", "/api/auth/signup", { json: { email: "alice@example.test", password: PASSWORD } })).status).toBe(409);
    expect((await c.call(login.POST, "POST", "/api/auth/login", { json: { email: "alice@example.test", password: "wrong password!" } })).status).toBe(401);
  });

  it("stores only a hash of the password and of the session token", () => {
    const u = db().prepare("SELECT password_hash FROM users WHERE email = ?").get("alice@example.test") as { password_hash: string };
    expect(u.password_hash.startsWith("scrypt$")).toBe(true);
    expect(u.password_hash).not.toContain(PASSWORD);
    const token = alice.cookie.split("=")[1];
    const s = db().prepare("SELECT count(*) AS n FROM sessions WHERE token_hash = ?").get(token) as { n: number };
    expect(s.n).toBe(0);
  });

  it("rejects cross-site state-changing requests", async () => {
    const r = await alice.call(collections.POST, "POST", "/api/collections", { json: { name: "Evil" }, headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
  });
});

describe("documents", () => {
  it("uploads, extracts and indexes documents", async () => {
    const a = await alice.call(documents.POST, "POST", "/api/documents", { form: upload("lease-agreement-2025.md", sample("lease-agreement-2025.md")) });
    expect(a.status).toBe(201);
    leaseId = a.data.document.id;
    expect(a.data.document.status).toBe("ready");
    expect(a.data.document.chunkCount).toBeGreaterThan(2);
    // No NEAR AI key in this test run: Morrow must say so rather than pretend to have a semantic index.
    expect(a.data.document.semantic).toBe("unavailable");
    const p = await alice.call(documents.POST, "POST", "/api/documents", { form: upload("home-maintenance-log.pdf", sample("home-maintenance-log.pdf")) });
    expect(p.status).toBe(201);
    pdfId = p.data.document.id;
    expect(p.data.document.pageCount).toBe(3);
  });

  it("rejects duplicates, oversized, empty and malicious uploads without storing them", async () => {
    const before = (await alice.call(documents.GET, "GET", "/api/documents")).data.documents.length;
    const dup = await alice.call(documents.POST, "POST", "/api/documents", { form: upload("copy.md", sample("lease-agreement-2025.md")) });
    expect(dup.status).toBe(409);
    expect(dup.data.error.documentId).toBe(leaseId);
    expect((await alice.call(documents.POST, "POST", "/api/documents", { form: upload("x.exe", new Uint8Array([77, 90])) })).status).toBe(415);
    expect((await alice.call(documents.POST, "POST", "/api/documents", { form: upload("x.pdf", new TextEncoder().encode("%PDF-1.4 garbage")) })).status).toBe(422);
    expect((await alice.call(documents.POST, "POST", "/api/documents", { form: upload("empty.txt", new Uint8Array()) })).status).toBe(422);
    const big = await alice.call(documents.POST, "POST", "/api/documents", { form: upload("big.txt", new Uint8Array(21 * 1024 * 1024).fill(97)) });
    expect(big.status).toBe(413);
    expect((await alice.call(documents.GET, "GET", "/api/documents")).data.documents.length).toBe(before);
  });

  it("finds content by keyword with page numbers", async () => {
    const r = await alice.call(searchRoute.GET, "GET", "/api/search?q=washing+machine+warranty");
    expect(r.status).toBe(200);
    expect(r.data.mode).toBe("keyword");
    expect(r.data.hits[0].documentId).toBe(pdfId);
    expect(r.data.hits[0].page).toBe(2);
    expect(r.data.hits[0].text).toContain("BRV-88213");
  });

  it("serves the original file and page text to the owner", async () => {
    const f = await alice.call(documentFile.GET, "GET", `/api/documents/${pdfId}/file`, { params: { id: pdfId } });
    expect(f.status).toBe(200);
    expect(f.headers.get("content-type")).toBe("application/pdf");
    const pages = await alice.call(documentPages.GET, "GET", `/api/documents/${pdfId}/pages`, { params: { id: pdfId } });
    expect(pages.data.pages).toHaveLength(3);
    // Text files are never served as renderable HTML.
    const t = await alice.call(documentFile.GET, "GET", `/api/documents/${leaseId}/file`, { params: { id: leaseId } });
    expect(t.headers.get("content-type")).toContain("text/plain");
    expect(t.headers.get("content-disposition")).toContain("attachment");
  });

  it("links related documents", async () => {
    const r = await alice.call(documentRelated.GET, "GET", `/api/documents/${pdfId}/related`, { params: { id: pdfId } });
    expect(r.status).toBe(200);
    expect(r.data.connections.some((c: { documentId: string }) => c.documentId === leaseId)).toBe(true);
  });
});

describe("user isolation", () => {
  it("never exposes another user's documents", async () => {
    const p = { params: { id: leaseId } };
    expect((await bob.call(documents.GET, "GET", "/api/documents")).data.documents).toHaveLength(0);
    expect((await bob.call(documentById.GET, "GET", `/api/documents/${leaseId}`, p)).status).toBe(404);
    expect((await bob.call(documentPages.GET, "GET", `/api/documents/${leaseId}/pages`, p)).status).toBe(404);
    expect((await bob.call(documentFile.GET, "GET", `/api/documents/${leaseId}/file`, p)).status).toBe(404);
    expect((await bob.call(documentRelated.GET, "GET", `/api/documents/${leaseId}/related`, p)).status).toBe(404);
    expect((await bob.call(documentById.PATCH, "PATCH", `/api/documents/${leaseId}`, { ...p, json: { title: "pwned" } })).status).toBe(404);
    expect((await bob.call(documentById.DELETE, "DELETE", `/api/documents/${leaseId}`, p)).status).toBe(404);
    expect((await alice.call(documentById.GET, "GET", `/api/documents/${leaseId}`, p)).data.document.title).toContain("Lease");
  });

  it("never returns another user's passages from search, even when scoped to their document ids", async () => {
    expect((await bob.call(searchRoute.GET, "GET", "/api/search?q=security+deposit+rent")).data.hits).toHaveLength(0);
    const { search } = await import("@/lib/retrieval/search");
    const bobId = (db().prepare("SELECT id FROM users WHERE email = ?").get("bob@example.test") as { id: string }).id;
    const scoped = await search(bobId, "security deposit rent", { scope: { documentIds: [leaseId] } });
    expect(scoped.hits).toHaveLength(0);
  });

  it("does not let a user attach or modify another user's collection", async () => {
    const c = await alice.call(collections.POST, "POST", "/api/collections", { json: { name: "Home" } });
    expect(c.status).toBe(201);
    const cid = c.data.collection.id;
    const own = await bob.call(documents.POST, "POST", "/api/documents", { form: upload("health-summary-2025.txt", sample("health-summary-2025.txt")) });
    const bobDoc = own.data.document.id;
    expect((await bob.call(documentById.PATCH, "PATCH", `/api/documents/${bobDoc}`, { params: { id: bobDoc }, json: { collections: [cid] } })).status).toBe(404);
    expect((await bob.call(collectionById.DELETE, "DELETE", `/api/collections/${cid}`, { params: { id: cid } })).status).toBe(404);
    expect((await bob.call(collectionById.PATCH, "PATCH", `/api/collections/${cid}`, { params: { id: cid }, json: { name: "x" } })).status).toBe(404);
    const ok = await alice.call(documentById.PATCH, "PATCH", `/api/documents/${leaseId}`, { params: { id: leaseId }, json: { collections: [cid], tags: ["Housing", "2025"] } });
    expect(ok.data.document.collections).toEqual([cid]);
    expect(ok.data.document.tags).toEqual(["2025", "housing"]);
    const scoped = await alice.call(searchRoute.GET, "GET", `/api/search?q=boiler&collection=${cid}`);
    expect(scoped.data.hits.every((h: { documentId: string }) => h.documentId === leaseId)).toBe(true);
  });

  it("exports only the caller's data", async () => {
    const e = await bob.call(exportRoute.GET, "GET", "/api/export");
    const dump = JSON.stringify(e.data);
    expect(dump).toContain("Westmere Family Practice");
    expect(dump).not.toContain("Halden Property Partners");
  });
});

describe("honesty without credentials", () => {
  it("refuses to answer rather than fabricate when NEAR AI is not configured", async () => {
    const r = await alice.call(askRoute.POST, "POST", "/api/ask", { json: { question: "What is the monthly rent?" } });
    expect(r.status).toBe(503);
    expect(r.data.error.code).toBe("near_not_configured");
    expect((db().prepare("SELECT count(*) AS n FROM answers").get() as { n: number }).n).toBe(0);
  });

  it("reports a truthful storage inventory", async () => {
    const r = await alice.call(privacy.GET, "GET", "/api/privacy");
    expect(r.data.inventory.documents).toBe(2);
    expect(r.data.inventory.embeddedPassages).toBe(0);
    expect(r.data.near.configured).toBe(false);
    expect(r.data.storage.encryptedAtRest).toBe(false);
  });
});

describe("deletion", () => {
  it("removes the file, pages, passages and search index entries", async () => {
    const stored = documentFiles.path(userId("alice@example.test"), pdfId);
    expect(fs.existsSync(stored)).toBe(true);
    const d = await alice.call(documentById.DELETE, "DELETE", `/api/documents/${pdfId}`, { params: { id: pdfId } });
    expect(d.status).toBe(200);
    expect(fs.existsSync(stored)).toBe(false);
    const n = (sql: string) => (db().prepare(sql).get(pdfId) as { n: number }).n;
    expect(n("SELECT count(*) AS n FROM chunks WHERE document_id = ?")).toBe(0);
    expect(n("SELECT count(*) AS n FROM pages WHERE document_id = ?")).toBe(0);
    expect((await alice.call(searchRoute.GET, "GET", "/api/search?q=BRV-88213")).data.hits).toHaveLength(0);
    expect((db().prepare("SELECT count(*) AS n FROM chunks_fts WHERE chunks_fts MATCH '\"brevik\"'").get() as { n: number }).n).toBe(0);
  });

  it("requires the password to delete an account, then removes everything", async () => {
    expect((await bob.call(account.DELETE, "DELETE", "/api/account", { json: { password: "not the password" } })).status).toBe(401);
    expect((await bob.call(account.DELETE, "DELETE", "/api/account", { json: { password: PASSWORD } })).status).toBe(200);
    expect((await bob.call(documents.GET, "GET", "/api/documents")).status).toBe(401);
    const left = db().prepare("SELECT count(*) AS n FROM chunks c JOIN users u ON u.id = c.user_id WHERE u.email = ?").get("bob@example.test") as { n: number };
    expect(left.n).toBe(0);
    expect((db().prepare("SELECT count(*) AS n FROM chunks_fts WHERE chunks_fts MATCH '\"cetirizine\"'").get() as { n: number }).n).toBe(0);
  });

  it("ends the session on logout", async () => {
    expect((await alice.call(logout.POST, "POST", "/api/auth/logout")).status).toBe(200);
    expect((await alice.call(documents.GET, "GET", "/api/documents")).status).toBe(401);
  });
});
