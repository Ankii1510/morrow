import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client, PASSWORD, sample, upload, userIdOf } from "./helpers";
import * as signup from "@/app/api/auth/signup/route";
import * as askRoute from "@/app/api/ask/route";
import * as usageRoute from "@/app/api/usage/route";
import * as account from "@/app/api/account/route";
import * as documents from "@/app/api/documents/route";
import * as searchRoute from "@/app/api/search/route";
import { db } from "@/lib/db";
import { providerStatusError } from "@/lib/near/client";
import { appUsageToday, assertQuota, dayStart, exclusiveAsk, recordUsage, userUsageToday } from "@/lib/usage";

const QUOTA_ENV = ["MORROW_USER_DAILY_QUESTIONS", "MORROW_USER_DAILY_TOKENS", "MORROW_USER_DAILY_EMBED_PASSAGES", "MORROW_APP_DAILY_QUESTIONS", "MORROW_APP_DAILY_TOKENS"];
afterEach(() => {
  for (const k of QUOTA_ENV) delete process.env[k];
});

const clients: Record<string, Client> = {};
const ids: Record<string, string> = {};
async function user(name: string): Promise<string> {
  if (!ids[name]) {
    clients[name] = new Client();
    await clients[name].call(signup.POST, "POST", "/api/auth/signup", { json: { email: `${name}@example.test`, password: PASSWORD } });
    ids[name] = userIdOf(`${name}@example.test`);
  }
  return ids[name];
}
const ask = (name: string) => clients[name].call(askRoute.POST, "POST", "/api/ask", { json: { question: "What is the monthly rent?" } });
const chatEvent = (userId: string, tokens: number | null = 1000) =>
  recordUsage({ userId, kind: "chat", purpose: "ask", model: "m", units: 1, usage: tokens === null ? undefined : { prompt_tokens: tokens - 100, completion_tokens: 100, total_tokens: tokens }, ok: true });
const errCode = (fn: () => void) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return (e as { code: string }).code;
  }
};

beforeAll(async () => {
  for (const n of ["ann", "ben", "cat"]) await user(n);
});

describe("accounting", () => {
  it("records provider-reported tokens exactly and never invents them when they are missing", async () => {
    const id = await user("acct");
    recordUsage({ userId: id, kind: "chat", purpose: "ask", model: "chat-model", units: 1, usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 }, ok: true });
    recordUsage({ userId: id, kind: "embedding", purpose: "index", model: "embed-model", units: 24, usage: { prompt_tokens: 3000, total_tokens: 3000 }, ok: true });
    recordUsage({ userId: id, kind: "rerank", purpose: "ask", model: "rerank-model", units: 8, usage: undefined, ok: true }); // provider returned no usage
    recordUsage({ userId: id, kind: "embedding", purpose: "search", model: "embed-model", units: 1, usage: { prompt_tokens: "12" as unknown as number }, ok: true }); // malformed
    recordUsage({ userId: id, kind: "chat", purpose: "ask", model: "chat-model", units: 1, ok: false });
    const t = userUsageToday(id);
    expect(t.tokens).toBe(4020);
    expect(t.callsWithoutTokenCount).toBe(2);
    expect(t.passagesEmbedded).toBe(24);
    expect(t.questions).toBe(2); // a failed attempt still counts against the question budget
    const rows = db().prepare("SELECT kind, total_tokens FROM usage_events WHERE user_id = ? ORDER BY id").all(id) as { kind: string; total_tokens: number | null }[];
    expect(rows.map((r) => r.total_tokens)).toEqual([1020, 3000, null, null, null]);
  });

  it("stores counts only: no question, passage or answer text", () => {
    const cols = (db().prepare("SELECT group_concat(name) AS c FROM pragma_table_info('usage_events')").get() as { c: string }).c.split(",");
    expect(cols.sort()).toEqual(["completion_tokens", "created_at", "id", "kind", "model", "prompt_tokens", "purpose", "status", "total_tokens", "units", "user_id"]);
  });

  it("does not count yesterday's usage against today", async () => {
    const id = await user("yesterday");
    chatEvent(id, 5000);
    db().prepare("UPDATE usage_events SET created_at = ? WHERE user_id = ?").run(dayStart() - 1, id);
    expect(userUsageToday(id).tokens).toBe(0);
    expect(userUsageToday(id).questions).toBe(0);
  });

  it("shows each user only their own usage", async () => {
    const a = (await clients.acct.call(usageRoute.GET, "GET", "/api/usage")).data;
    const b = (await clients.ben.call(usageRoute.GET, "GET", "/api/usage")).data;
    expect(a.today.tokens).toBe(4020);
    expect(a.history).toHaveLength(5);
    expect(b.today.calls).toBe(0);
    expect(b.history).toEqual([]);
    expect(JSON.stringify(b)).not.toContain("chat-model");
    expect(Object.keys(a)).not.toContain("app"); // app-wide totals are not exposed
    expect((await new Client().call(usageRoute.GET, "GET", "/api/usage")).status).toBe(401);
  });
});

describe("per-user limits", () => {
  it("stops a user at their daily question limit before anything is sent, without affecting others", async () => {
    process.env.MORROW_USER_DAILY_QUESTIONS = "2";
    const ann = await user("ann");
    // Under the limit the request passes the budget check and stops only because this test run has no provider key.
    expect((await ask("ann")).data.error.code).toBe("near_not_configured");
    chatEvent(ann);
    chatEvent(ann);
    const blocked = await ask("ann");
    expect(blocked.status).toBe(429);
    expect(blocked.data.error.code).toBe("quota_exceeded");
    expect(blocked.data.error.message).toMatch(/resets in/);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await ask("ben")).data.error.code).toBe("near_not_configured");
    expect((db().prepare("SELECT count(*) AS n FROM answers").get() as { n: number }).n).toBe(0);
  });

  it("stops a user at their daily token limit", async () => {
    process.env.MORROW_USER_DAILY_TOKENS = "5000";
    const ben = await user("ben");
    chatEvent(ben, 4999);
    expect(errCode(() => assertQuota(ben, "ask"))).toBe("ok");
    chatEvent(ben, 1);
    expect(errCode(() => assertQuota(ben, "ask"))).toBe("quota_exceeded");
    expect(errCode(() => assertQuota(ben, "search"))).toBe("quota_exceeded");
    expect((await ask("ben")).status).toBe(429);
  });

  it("caps how many passages one user can have embedded per day", async () => {
    process.env.MORROW_USER_DAILY_EMBED_PASSAGES = "100";
    const cat = await user("cat");
    recordUsage({ userId: cat, kind: "embedding", purpose: "index", model: "e", units: 90, usage: { total_tokens: 10 }, ok: true });
    expect(errCode(() => assertQuota(cat, "index", 10))).toBe("ok");
    expect(errCode(() => assertQuota(cat, "index", 11))).toBe("quota_exceeded");
  });

  it("a limit of zero switches the feature off", async () => {
    process.env.MORROW_USER_DAILY_QUESTIONS = "0";
    const id = await user("zero");
    expect(errCode(() => assertQuota(id, "ask"))).toBe("quota_exceeded");
  });

  it("allows only one question at a time per user", async () => {
    let release!: () => void;
    const first = exclusiveAsk("u1", () => new Promise<string>((r) => (release = () => r("done"))));
    await expect(exclusiveAsk("u1", async () => "second")).rejects.toMatchObject({ code: "busy", status: 429 });
    await expect(exclusiveAsk("u2", async () => "other user")).resolves.toBe("other user");
    release();
    await expect(first).resolves.toBe("done");
    await expect(exclusiveAsk("u1", async () => "after")).resolves.toBe("after");
  });
});

describe("server-wide limits", () => {
  it("stop everyone once the shared budget is spent, with an operator-facing message", async () => {
    const before = appUsageToday().questions;
    process.env.MORROW_APP_DAILY_QUESTIONS = String(before + 1);
    const dan = await user("dan");
    expect(errCode(() => assertQuota(dan, "ask"))).toBe("ok");
    chatEvent(dan);
    const r = await ask("ann");
    expect(r.status).toBe(503);
    expect(r.data.error.code).toBe("app_quota_exceeded");
    expect(r.data.error.message).toMatch(/This Morrow server/);
    process.env.MORROW_APP_DAILY_TOKENS = "1";
    expect(errCode(() => assertQuota(ids.cat, "search"))).toBe("app_quota_exceeded");
  });

  it("cannot be reset by deleting an account and signing up again", async () => {
    const id = await user("churn");
    chatEvent(id, 7777);
    const total = appUsageToday();
    expect((await clients.churn.call(account.DELETE, "DELETE", "/api/account", { json: { password: PASSWORD } })).status).toBe(200);
    expect(appUsageToday().tokens).toBe(total.tokens);
    expect(appUsageToday().questions).toBe(total.questions);
    // ...but the rows no longer point at the person.
    expect((db().prepare("SELECT count(*) AS n FROM usage_events WHERE user_id = ?").get(id) as { n: number }).n).toBe(0);
    expect((db().prepare("SELECT count(*) AS n FROM users WHERE id = ?").get(id) as { n: number }).n).toBe(0);
  });
});

describe("degradation when budgets are exhausted", () => {
  it("keyword search and uploads keep working", async () => {
    process.env.MORROW_USER_DAILY_TOKENS = "1";
    const id = await user("local");
    chatEvent(id, 10);
    const up = await clients.local.call(documents.POST, "POST", "/api/documents", { form: upload("lease-agreement-2025.md", sample("lease-agreement-2025.md")) });
    expect(up.status).toBe(201);
    const s = await clients.local.call(searchRoute.GET, "GET", "/api/search?q=security+deposit");
    expect(s.status).toBe(200);
    expect(s.data.hits.length).toBeGreaterThan(0);
  });
});

describe("provider payment and quota errors", () => {
  it("are reported as the operator's problem, never as success", () => {
    const credits = providerStatusError(402, "inference");
    expect([credits.status, credits.code]).toEqual([503, "near_credits"]);
    expect(credits.message).toMatch(/credits/);
    expect(providerStatusError(401, "embedding").code).toBe("near_auth");
    expect(providerStatusError(403, "embedding").code).toBe("near_auth");
    const limited = providerStatusError(429, "inference");
    expect(limited.code).toBe("near_rate_limited");
    expect(limited.extra?.retryAfter).toBe(60);
    expect(providerStatusError(500, "inference").code).toBe("near_api_error");
    for (const s of [401, 402, 429]) expect(providerStatusError(s, "x").message).not.toMatch(/NEARAI_API_KEY=|sk-/);
  });
});
