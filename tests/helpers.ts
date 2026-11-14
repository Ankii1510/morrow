import fs from "node:fs";
import path from "node:path";

export const BASE = "http://localhost:3000";
type Handler = (req: Request, ctx: never) => Promise<Response> | Response;

export function sample(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(process.cwd(), "samples", name)));
}

/** A tiny cookie-jar client that calls route handlers directly, exactly as Next.js would. */
export class Client {
  cookie = "";
  async call(handler: Handler, method: string, url: string, opts: { json?: unknown; form?: FormData; params?: Record<string, string>; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { host: "localhost:3000", ...(opts.headers || {}) };
    if (this.cookie) headers.cookie = this.cookie;
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers["content-type"] = "application/json";
    } else if (opts.form) body = opts.form;
    const res = await handler(new Request(BASE + url, { method, headers, body }), { params: Promise.resolve(opts.params || {}) } as never);
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json") ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
}

export function upload(name: string, bytes: Uint8Array): FormData {
  const form = new FormData();
  form.set("file", new File([bytes as BlobPart], name));
  return form;
}

// ---------------------------------------------------------------------------------------------
// Phase 2 helpers
// ---------------------------------------------------------------------------------------------
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { receiptFiles } from "@/lib/storage";

export const PASSWORD = "correct horse battery";

export function userIdOf(email: string): string {
  return (db().prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;
}

/** Build a small valid PDF, one array of lines per page, for ingestion tests. */
export function makePdf(pages: string[][]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  add(""); // 1 catalog
  add(""); // 2 pages
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"); // 3
  const kids: number[] = [];
  for (const lines of pages) {
    let y = 740;
    let s = "";
    for (const line of lines) {
      s += `BT /F1 11 Tf 72 ${y} Td (${esc(line)}) Tj ET\n`;
      y -= 18;
    }
    const content = add(`<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}endstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/**
 * Store a saved answer and its receipt exactly as the Ask pipeline does (same tables, same storage
 * module), without calling a model. Lets ownership of answers and receipts be tested offline.
 */
export function seedAnswer(userId: string, documentId: string, question = "What is the rent?"): string {
  const id = crypto.randomUUID();
  const sources = [{ n: 1, chunkId: 1, documentId, title: "Seeded", kind: "markdown", page: 1, heading: null, text: `private passage of ${userId}`, cited: true }];
  db()
    .prepare("INSERT INTO answers (id, user_id, question, answer, grounded, sources_json, verification_json, scope_json, model, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, userId, question, `private answer of ${userId} [1]`, 1, JSON.stringify(sources), JSON.stringify({ verification: null, retrieval: { mode: "keyword", reranked: false, notes: [], invalidCitations: [] }, outcome: "grounded" }), "{}", "test-model", Date.now());
  receiptFiles.write(userId, id, JSON.stringify({ morrowReceipt: 1, answerId: id, owner: userId }));
  return id;
}
