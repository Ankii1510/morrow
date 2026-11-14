import { afterEach, describe, expect, it } from "vitest";
import { Client, PASSWORD } from "./helpers";
import * as signup from "@/app/api/auth/signup/route";
import * as login from "@/app/api/auth/login/route";
import * as resetRequest from "@/app/api/auth/reset/request/route";
import * as resetConfirm from "@/app/api/auth/reset/confirm/route";
import * as verify from "@/app/api/auth/verify/route";
import * as sessionsRoute from "@/app/api/sessions/route";
import * as passwordRoute from "@/app/api/account/password/route";
import * as documents from "@/app/api/documents/route";
import * as collections from "@/app/api/collections/route";
import * as me from "@/app/api/me/route";
import { createAuthToken, createUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientIp, rateLimit, throttleAnonymous } from "@/lib/http";
import { testOutbox } from "@/lib/mail";

const ENV = ["MORROW_MAIL_TRANSPORT", "MORROW_PUBLIC_URL", "MORROW_TRUSTED_PROXY_HOPS", "MORROW_SECURE_COOKIES", "MORROW_REQUIRE_EMAIL_VERIFICATION", "MORROW_SESSION_IDLE_DAYS"];
afterEach(() => {
  for (const k of ENV) delete process.env[k];
  testOutbox().length = 0;
});

let n = 0;
const fresh = () => `user${++n}-${Date.now()}@example.test`;
const post = (c: Client, handler: typeof login.POST, url: string, json: unknown, headers?: Record<string, string>) => c.call(handler, "POST", url, { json, headers });
const signIn = (c: Client, email: string, password = PASSWORD) => post(c, login.POST, "/api/auth/login", { email, password });
const tokenFrom = (text: string) => decodeURIComponent(/token=([^\s&]+)/.exec(text)![1]);
/** Make every rate-limit window look expired, as if time had passed. */
const expireWindows = () => db().prepare("UPDATE rate_limits SET reset_at = 0").run();

describe("brute-force protection", () => {
  it("locks an address after repeated failures, even for the correct password, then recovers", async () => {
    const email = fresh();
    createUser(email, PASSWORD);
    const c = new Client();
    for (let i = 0; i < 10; i++) expect((await signIn(c, email, `wrong-password-${i}`)).status).toBe(401);
    const locked = await signIn(c, email, PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.data.error.code).toBe("too_many_attempts");
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(c.cookie).toBe("");
    expireWindows();
    expect((await signIn(c, email, PASSWORD)).status).toBe(200);
  });

  it("behaves identically for an address with no account, so the lock reveals nothing", async () => {
    const real = fresh();
    createUser(real, PASSWORD);
    const ghost = fresh();
    const seq = async (email: string) => {
      const out: string[] = [];
      for (let i = 0; i < 12; i++) {
        const r = await signIn(new Client(), email, "definitely-wrong-password");
        out.push(`${r.status}:${r.data.error.code}`);
      }
      return out;
    };
    const a = await seq(real);
    expect(await seq(ghost)).toEqual(a);
    expect(a.slice(0, 10).every((x) => x === "401:bad_credentials")).toBe(true);
    expect(a[11]).toBe("429:too_many_attempts");
    expireWindows();
  });

  it("a successful sign-in clears the failure count", async () => {
    const email = fresh();
    createUser(email, PASSWORD);
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 6; i++) await signIn(new Client(), email, "wrong-wrong-wrong");
      expect((await signIn(new Client(), email)).status).toBe(200);
    }
  });
});

describe("forwarded headers", () => {
  const req = (xff?: string) => new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: xff ? { "x-forwarded-for": xff } : {} });

  it("ignores X-Forwarded-For unless a trusted proxy is configured", () => {
    expect(clientIp(req("1.2.3.4"))).toBeNull();
    expect(clientIp(req())).toBeNull();
  });

  it("cannot be bypassed by sending a different forged address on every request", () => {
    let blockedAt = -1;
    for (let i = 0; i < 12 && blockedAt < 0; i++) {
      try {
        throttleAnonymous(req(`10.0.0.${i}`), "spoof-test", 3, 8, 60_000);
      } catch {
        blockedAt = i;
      }
    }
    expect(blockedAt).toBe(8);
  });

  it("behind one trusted proxy, uses the address that proxy appended and ignores what the client prepended", () => {
    process.env.MORROW_TRUSTED_PROXY_HOPS = "1";
    expect(clientIp(req("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIp(req("203.0.113.9"))).toBe("203.0.113.9");
    let blockedAt = -1;
    for (let i = 0; i < 6 && blockedAt < 0; i++) {
      try {
        throttleAnonymous(req(`99.99.99.${i}, 203.0.113.50`), "proxy-test", 3, 1000, 60_000);
      } catch {
        blockedAt = i;
      }
    }
    expect(blockedAt).toBe(3);
    throttleAnonymous(req("99.99.99.1, 203.0.113.51"), "proxy-test", 3, 1000, 60_000);
  });

  it("persists counters in the database rather than in process memory", () => {
    rateLimit("persist-test", 100, 60_000);
    rateLimit("persist-test", 100, 60_000);
    const rows = db().prepare("SELECT key_hash, count FROM rate_limits WHERE count = 2").all() as { key_hash: string; count: number }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.key_hash))).toBe(true);
  });
});
