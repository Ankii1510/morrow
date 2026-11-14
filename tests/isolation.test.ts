import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { Client, PASSWORD, sample, seedAnswer, upload, userIdOf } from "./helpers";
import * as signup from "@/app/api/auth/signup/route";
import * as documents from "@/app/api/documents/route";
import * as documentById from "@/app/api/documents/[id]/route";
import * as documentPages from "@/app/api/documents/[id]/pages/route";
import * as documentFile from "@/app/api/documents/[id]/file/route";
import * as documentRelated from "@/app/api/documents/[id]/related/route";
import * as documentRetry from "@/app/api/documents/[id]/retry/route";
import * as answers from "@/app/api/answers/route";
import * as answerById from "@/app/api/answers/[id]/route";
import * as answerReceipt from "@/app/api/answers/[id]/receipt/route";
import * as collections from "@/app/api/collections/route";
import * as collectionById from "@/app/api/collections/[id]/route";
import * as searchRoute from "@/app/api/search/route";
import * as askRoute from "@/app/api/ask/route";
import * as exportRoute from "@/app/api/export/route";
import * as privacy from "@/app/api/privacy/route";
import * as usageRoute from "@/app/api/usage/route";
import * as sessionsRoute from "@/app/api/sessions/route";
import * as account from "@/app/api/account/route";
import { db } from "@/lib/db";
import { documentFiles, receiptFiles } from "@/lib/storage";
import { recordUsage } from "@/lib/usage";
import { search } from "@/lib/retrieval/search";
import { relatedDocuments } from "@/lib/connections";

/**
 * Two independent accounts. Alice owns one of everything; every route is then called as Bob
 * (and as nobody) with Alice's identifiers, and as Alice to prove the positive case still works.
 */
const alice = new Client();
const bob = new Client();
let aliceId = "";
let bobId = "";
let aDoc = "";
let aAnswer = "";
let aCollection = "";
let bDoc = "";
let bAnswer = "";
let bCollection = "";
const P = (id: string) => ({ params: { id } });

beforeAll(async () => {
  await alice.call(signup.POST, "POST", "/api/auth/signup", { json: { email: "alice@example.test", password: PASSWORD } });
  await bob.call(signup.POST, "POST", "/api/auth/signup", { json: { email: "bob@example.test", password: PASSWORD } });
  aliceId = userIdOf("alice@example.test");
  bobId = userIdOf("bob@example.test");
  aDoc = (await alice.call(documents.POST, "POST", "/api/documents", { form: upload("lease-agreement-2025.md", sample("lease-agreement-2025.md")) })).data.document.id;
  bDoc = (await bob.call(documents.POST, "POST", "/api/documents", { form: upload("health-summary-2025.txt", sample("health-summary-2025.txt")) })).data.document.id;
  aCollection = (await alice.call(collections.POST, "POST", "/api/collections", { json: { name: "Alice private" } })).data.collection.id;
  bCollection = (await bob.call(collections.POST, "POST", "/api/collections", { json: { name: "Bob private" } })).data.collection.id;
  await alice.call(documentById.PATCH, "PATCH", `/api/documents/${aDoc}`, { ...P(aDoc), json: { collections: [aCollection], tags: ["alice-tag"] } });
  aAnswer = seedAnswer(aliceId, aDoc, "Alice's private question");
  bAnswer = seedAnswer(bobId, bDoc, "Bob's private question");
  recordUsage({ userId: aliceId, kind: "chat", purpose: "ask", model: "m", units: 1, usage: { prompt_tokens: 111, completion_tokens: 22, total_tokens: 133 }, ok: true });
});

describe("documents", () => {
  it("owner can read, another user and an anonymous caller cannot", async () => {
    const anon = new Client();
    const routes: [typeof documentById.GET, string][] = [
      [documentById.GET, ""],
      [documentPages.GET, "/pages"],
      [documentFile.GET, "/file"],
      [documentRelated.GET, "/related"],
    ];
    for (const [handler, suffix] of routes) {
      expect((await alice.call(handler, "GET", `/api/documents/${aDoc}${suffix}`, P(aDoc))).status).toBe(200);
      expect((await bob.call(handler, "GET", `/api/documents/${aDoc}${suffix}`, P(aDoc))).status).toBe(404);
      expect((await anon.call(handler, "GET", `/api/documents/${aDoc}${suffix}`, P(aDoc))).status).toBe(401);
    }
  });

  it("another user cannot rename, tag, re-index or delete it", async () => {
    expect((await bob.call(documentById.PATCH, "PATCH", `/api/documents/${aDoc}`, { ...P(aDoc), json: { title: "taken over" } })).status).toBe(404);
    expect((await bob.call(documentById.PATCH, "PATCH", `/api/documents/${aDoc}`, { ...P(aDoc), json: { tags: ["bob-was-here"] } })).status).toBe(404);
    expect((await bob.call(documentRetry.POST, "POST", `/api/documents/${aDoc}/retry`, P(aDoc))).status).toBe(404);
    expect((await bob.call(documentById.DELETE, "DELETE", `/api/documents/${aDoc}`, P(aDoc))).status).toBe(404);
    const still = await alice.call(documentById.GET, "GET", `/api/documents/${aDoc}`, P(aDoc));
    expect(still.data.document.title).toContain("Residential Lease");
    expect(still.data.document.tags).toEqual(["alice-tag"]);
    expect(fs.existsSync(documentFiles.path(aliceId, aDoc))).toBe(true);
  });

  it("the document list and the related-documents lookup contain only the caller's documents", async () => {
    const list = (await bob.call(documents.GET, "GET", "/api/documents")).data.documents as { id: string }[];
    expect(list.map((d) => d.id)).toEqual([bDoc]);
    expect(() => relatedDocuments(bobId, aDoc)).toThrow();
    expect(relatedDocuments(bobId, bDoc).every((c) => c.documentId !== aDoc)).toBe(true);
  });

  it("a browser-supplied id is never proof of ownership, and malformed ids never reach the filesystem", async () => {
    for (const bad of ["../../etc/passwd", "..%2F..%2Fetc%2Fpasswd", "%2e%2e", aDoc + "/../" + aDoc, aDoc.toUpperCase(), "", "x".repeat(500), `${aliceId}/${aDoc}`]) {
      for (const [handler, suffix] of [[documentFile.GET, "/file"], [documentPages.GET, "/pages"], [documentById.GET, ""]] as const) {
        const r = await bob.call(handler, "GET", `/api/documents/x${suffix}`, P(bad));
        expect([400, 404]).toContain(r.status);
      }
    }
  });
});

describe("saved answers and receipts", () => {
  it("owner can read the answer and download the receipt", async () => {
    const a = await alice.call(answerById.GET, "GET", `/api/answers/${aAnswer}`, P(aAnswer));
    expect(a.status).toBe(200);
    expect(a.data.answer.question).toBe("Alice's private question");
    const r = await alice.call(answerReceipt.GET, "GET", `/api/answers/${aAnswer}/receipt`, P(aAnswer));
    expect(r.status).toBe(200);
    expect(r.data.owner).toBe(aliceId);
  });

  it("another user cannot read, list, download or delete them", async () => {
    expect((await bob.call(answerById.GET, "GET", `/api/answers/${aAnswer}`, P(aAnswer))).status).toBe(404);
    expect((await bob.call(answerReceipt.GET, "GET", `/api/answers/${aAnswer}/receipt`, P(aAnswer))).status).toBe(404);
    expect((await bob.call(answerById.DELETE, "DELETE", `/api/answers/${aAnswer}`, P(aAnswer))).status).toBe(404);
    const list = (await bob.call(answers.GET, "GET", "/api/answers")).data.answers as { id: string; question: string }[];
    expect(list.map((x) => x.id)).toEqual([bAnswer]);
    expect(JSON.stringify(list)).not.toContain("Alice");
    // Still there for the owner, with its receipt file.
    expect((await alice.call(answerById.GET, "GET", `/api/answers/${aAnswer}`, P(aAnswer))).status).toBe(200);
    expect(fs.existsSync(receiptFiles.path(aliceId, aAnswer))).toBe(true);
  });

  it("an anonymous caller gets nothing", async () => {
    const anon = new Client();
    expect((await anon.call(answers.GET, "GET", "/api/answers")).status).toBe(401);
    expect((await anon.call(answerById.GET, "GET", `/api/answers/${aAnswer}`, P(aAnswer))).status).toBe(401);
    expect((await anon.call(answerReceipt.GET, "GET", `/api/answers/${aAnswer}/receipt`, P(aAnswer))).status).toBe(401);
  });

  it("the storage layer itself refuses a receipt or file under the wrong owner", () => {
    expect(receiptFiles.read(bobId, aAnswer)).toBeNull();
    expect(documentFiles.read(bobId, aDoc)).toBeNull();
    expect(receiptFiles.read(aliceId, aAnswer)).toContain(aliceId);
  });

  it("an answer that quotes an owned document does not make another user's receipt reachable", async () => {
    // Bob's own answer id with Alice's receipt path: the route resolves storage from the session user only.
    const r = await bob.call(answerReceipt.GET, "GET", `/api/answers/${bAnswer}/receipt`, P(bAnswer));
    expect(r.status).toBe(200);
    expect(r.data.owner).toBe(bobId);
  });
});

describe("collections and tags", () => {
  it("lists only the caller's collections and tags", async () => {
    const b = (await bob.call(collections.GET, "GET", "/api/collections")).data;
    expect(b.collections.map((c: { id: string }) => c.id)).toEqual([bCollection]);
    expect(b.tags).toEqual([]);
    const a = (await alice.call(collections.GET, "GET", "/api/collections")).data;
    expect(a.collections.map((c: { id: string }) => c.id)).toEqual([aCollection]);
    expect(a.tags.map((t: { tag: string }) => t.tag)).toEqual(["alice-tag"]);
    expect(a.collections[0].documentCount).toBe(1);
  });

  it("another user cannot rename, delete, or file documents into them", async () => {
    expect((await bob.call(collectionById.PATCH, "PATCH", `/api/collections/${aCollection}`, { ...P(aCollection), json: { name: "x" } })).status).toBe(404);
    expect((await bob.call(collectionById.DELETE, "DELETE", `/api/collections/${aCollection}`, P(aCollection))).status).toBe(404);
    // Bob's own document into Alice's collection:
    expect((await bob.call(documentById.PATCH, "PATCH", `/api/documents/${bDoc}`, { ...P(bDoc), json: { collections: [aCollection] } })).status).toBe(404);
    const links = db().prepare("SELECT count(*) AS n FROM document_collections WHERE collection_id = ? AND document_id = ?").get(aCollection, bDoc) as { n: number };
    expect(links.n).toBe(0);
  });

  it("two users can use the same collection name independently", async () => {
    expect((await bob.call(collections.POST, "POST", "/api/collections", { json: { name: "Alice private" } })).status).toBe(201);
  });
});

describe("search and retrieval", () => {
  it("returns only the caller's passages", async () => {
    const a = (await alice.call(searchRoute.GET, "GET", "/api/search?q=security+deposit+rent+cholesterol")).data.hits as { documentId: string }[];
    const b = (await bob.call(searchRoute.GET, "GET", "/api/search?q=security+deposit+rent+cholesterol")).data.hits as { documentId: string }[];
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a.every((h) => h.documentId === aDoc)).toBe(true);
    expect(b.every((h) => h.documentId === bDoc)).toBe(true);
  });

  it("the body-based search the interface uses is isolated the same way, and keeps the query out of the URL", async () => {
    const b = await bob.call(searchRoute.POST, "POST", "/api/search", { json: { q: "security deposit rent cholesterol" } });
    expect(b.status).toBe(200);
    expect((b.data.hits as { documentId: string }[]).every((h) => h.documentId === bDoc)).toBe(true);
    expect((await bob.call(searchRoute.POST, "POST", "/api/search", { json: { q: "deposit", collection: aCollection } })).data.hits).toHaveLength(0);
    expect((await bob.call(searchRoute.POST, "POST", "/api/search", { json: { q: "deposit", tag: "alice-tag" } })).data.hits).toHaveLength(0);
    expect((await new Client().call(searchRoute.POST, "POST", "/api/search", { json: { q: "deposit" } })).status).toBe(401);
    expect((await bob.call(searchRoute.POST, "POST", "/api/search", { json: { q: "deposit" }, headers: { origin: "https://evil.example" } })).status).toBe(403);
  });

  it("a scope naming another user's document, collection or tag matches nothing", async () => {
    expect((await search(bobId, "security deposit rent", { scope: { documentIds: [aDoc] } })).hits).toHaveLength(0);
    expect((await search(bobId, "security deposit rent", { scope: { collectionId: aCollection } })).hits).toHaveLength(0);
    expect((await search(bobId, "security deposit rent", { scope: { tag: "alice-tag" } })).hits).toHaveLength(0);
    expect((await bob.call(searchRoute.GET, "GET", `/api/search?q=deposit&collection=${aCollection}`)).data.hits).toHaveLength(0);
    // A mixed scope keeps only what the caller owns.
    const mixed = await search(bobId, "cholesterol deposit", { scope: { documentIds: [aDoc, bDoc] } });
    expect(mixed.hits.length).toBeGreaterThan(0);
    expect(mixed.hits.every((h) => h.documentId === bDoc)).toBe(true);
  });

  it("asking with another user's document as scope cannot reach it", async () => {
    // Without a provider key the pipeline stops before any model call; the point is that the scope
    // is resolved against the session user, so no error mentions or depends on Alice's document.
    const r = await bob.call(askRoute.POST, "POST", "/api/ask", { json: { question: "What is the security deposit?", scope: { documentIds: [aDoc] } } });
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.data)).not.toContain("Lease");
  });
});

describe("export, inventory, usage and sessions", () => {
  it("export contains only the caller's data", async () => {
    const b = JSON.stringify((await bob.call(exportRoute.GET, "GET", "/api/export")).data);
    expect(b).toContain("Westmere Family Practice");
    expect(b).toContain("Bob's private question");
    // (Bob owns a collection he named "Alice private" himself, so the bare word is not a leak signal.)
    for (const leak of ["Halden Property Partners", "Alice's private question", "private answer of " + aliceId, "alice-tag", "alice@example.test", aliceId, aDoc, aAnswer, aCollection]) expect(b).not.toContain(leak);
  });

  it("the privacy inventory counts only the caller's rows", async () => {
    const b = (await bob.call(privacy.GET, "GET", "/api/privacy")).data;
    expect(b.inventory.documents).toBe(1);
    expect(b.inventory.savedAnswers).toBe(1);
    expect(JSON.stringify(b.activity)).not.toContain("Lease");
  });

  it("usage history is per user", async () => {
    const a = (await alice.call(usageRoute.GET, "GET", "/api/usage")).data;
    const b = (await bob.call(usageRoute.GET, "GET", "/api/usage")).data;
    expect(a.today.tokens).toBe(133);
    expect(a.history).toHaveLength(1);
    expect(b.today.tokens).toBe(0);
    expect(b.history).toHaveLength(0);
  });

  it("a user sees and can revoke only their own sessions", async () => {
    const a = (await alice.call(sessionsRoute.GET, "GET", "/api/sessions")).data.sessions as { id: number; current: boolean }[];
    const b = (await bob.call(sessionsRoute.GET, "GET", "/api/sessions")).data.sessions as { id: number }[];
    expect(a).toHaveLength(1);
    expect(a[0].current).toBe(true);
    expect(b.map((s) => s.id)).not.toContain(a[0].id);
    expect((await bob.call(sessionsRoute.DELETE, "DELETE", "/api/sessions", { json: { id: a[0].id } })).status).toBe(404);
    expect((await bob.call(sessionsRoute.DELETE, "DELETE", "/api/sessions", { json: { scope: "others" } })).data.revoked).toBe(0);
    expect((await alice.call(documents.GET, "GET", "/api/documents")).status).toBe(200);
    expect(JSON.stringify(a)).not.toMatch(/token/i);
  });
});

describe("deleting one account leaves the other untouched", () => {
  it("removes Bob completely and none of Alice's data", async () => {
    const bobFile = documentFiles.path(bobId, bDoc);
    const bobReceipt = receiptFiles.path(bobId, bAnswer);
    expect(fs.existsSync(bobFile) && fs.existsSync(bobReceipt)).toBe(true);
    expect((await bob.call(account.DELETE, "DELETE", "/api/account", { json: { password: PASSWORD } })).status).toBe(200);
    expect(fs.existsSync(bobFile) || fs.existsSync(bobReceipt)).toBe(false);
    for (const t of ["documents", "pages", "chunks", "collections", "answers", "sessions", "activity"]) {
      expect((db().prepare(`SELECT count(*) AS n FROM ${t} WHERE user_id = ?`).get(bobId) as { n: number }).n).toBe(0);
    }
    expect((await alice.call(documentById.GET, "GET", `/api/documents/${aDoc}`, P(aDoc))).status).toBe(200);
    expect((await alice.call(answerReceipt.GET, "GET", `/api/answers/${aAnswer}/receipt`, P(aAnswer))).status).toBe(200);
    expect((await alice.call(documentFile.GET, "GET", `/api/documents/${aDoc}/file`, P(aDoc))).status).toBe(200);
    expect((await alice.call(collections.GET, "GET", "/api/collections")).data.collections).toHaveLength(1);
    expect((await alice.call(searchRoute.GET, "GET", "/api/search?q=security+deposit")).data.hits.length).toBeGreaterThan(0);
  });
});
