import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SQLite has no row-level security, so isolation depends on every statement naming the owner.
 * This test reads every SQL statement in the server code and fails if one touches a user-owned
 * table without a user_id condition, unless it is listed below with the reason it is safe.
 * A new query that forgets the filter therefore fails the build instead of leaking data.
 */
const OWNED = ["documents", "pages", "chunks", "collections", "document_tags", "answers", "activity", "sessions", "auth_tokens", "usage_events", "document_collections"];

const EXEMPT: { match: RegExp; why: string }[] = [
  { match: /FROM sessions s JOIN users u ON u\.id = s\.user_id\s+WHERE s\.token_hash = \?/, why: "resolves the session from the secret cookie token; this is how the user is identified" },
  { match: /DELETE FROM sessions WHERE token_hash = \?/, why: "ends the session named by the caller's own cookie token" },
  { match: /UPDATE sessions SET last_seen_at = \? WHERE token_hash = \?/, why: "touches the session named by the caller's own cookie token" },
  { match: /DELETE FROM sessions WHERE expires_at < \?/, why: "housekeeping: removes expired sessions for everyone" },
  { match: /UPDATE auth_tokens SET used_at = \? WHERE token_hash = \?/, why: "spends a one-time token identified by its secret value" },
  { match: /FROM usage_events WHERE \$\{where\}/, why: "aggregate helper; callers pass either a user_id filter or the app-wide day filter and only totals are returned" },
  { match: /DELETE FROM document_collections WHERE document_id = \?/, why: "join table without a user column; runs only after getOwnedDocument() has verified the document's owner" },
  { match: /INSERT INTO document_collections \(document_id, collection_id\)/, why: "runs only after both the document and the collection were verified to belong to the caller" },
  { match: /FROM collections c LEFT JOIN document_collections dc/, why: "filtered by c.user_id on the owning collection (checked below)" },
];

function serverFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "client" ? [] : serverFiles(p);
    return /\.ts$/.test(e.name) ? [p] : [];
  });
}

function statements(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /\.prepare\(\s*(`(?:[^`\\]|\\[\s\S])*`|"(?:[^"\\]|\\[\s\S])*")/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1].slice(1, -1).replace(/\s+/g, " "));
  return out;
}

describe("every query on user-owned tables is scoped to a user", () => {
  const files = [...serverFiles("src/lib"), ...serverFiles("src/app/api")];
  const all = files.flatMap((f) => statements(f).map((sql) => ({ file: f, sql })));

  it("finds the application's SQL", () => {
    expect(all.length).toBeGreaterThan(60);
  });

  it("has no unscoped statement", () => {
    const offenders: string[] = [];
    for (const { file, sql } of all) {
      const touched = OWNED.filter((t) => new RegExp(`\\b(FROM|JOIN|INTO|UPDATE)\\s+${t}\\b`, "i").test(sql));
      if (touched.length === 0) continue;
      if (/\buser_id\b/.test(sql)) continue;
      if (EXEMPT.some((e) => e.match.test(sql))) continue;
      offenders.push(`${file}: ${sql.slice(0, 160)}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the collection listing is filtered by the owning collection's user", () => {
    const sql = all.find((s) => /FROM collections c LEFT JOIN document_collections dc/.test(s.sql))!.sql;
    expect(sql).toMatch(/WHERE c\.user_id = \?/);
  });

  it("every exemption is still in use (no stale entries hiding a future leak)", () => {
    for (const e of EXEMPT) expect(all.some((s) => e.match.test(s.sql)), e.why).toBe(true);
  });
});
