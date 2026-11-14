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
    expect(blockedAt).toBe(8); // the shared ceiling, regardless of the invented addresses
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
    expect(blockedAt).toBe(3); // forged left-hand entries did not create fresh buckets
    throttleAnonymous(req("99.99.99.1, 203.0.113.51"), "proxy-test", 3, 1000, 60_000); // a different real client is unaffected
  });

  it("persists counters in the database rather than in process memory", () => {
    rateLimit("persist-test", 100, 60_000);
    rateLimit("persist-test", 100, 60_000);
    const rows = db().prepare("SELECT key_hash, count FROM rate_limits WHERE count = 2").all() as { key_hash: string; count: number }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.key_hash))).toBe(true); // hashed: no raw key, email or address
  });
});

describe("cookies and cross-site requests", () => {
  it("sets HttpOnly, SameSite=Lax and never exposes the token to scripts", async () => {
    const email = fresh();
    createUser(email, PASSWORD);
    const r = await signIn(new Client(), email);
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/); // plain http://localhost in this test
    expect(JSON.stringify(r.data)).not.toContain(cookie.split(";")[0].split("=")[1]);
  });

  it("adds Secure when configured, and ignores a forged X-Forwarded-Proto otherwise", async () => {
    const email = fresh();
    createUser(email, PASSWORD);
    const forged = await post(new Client(), login.POST, "/api/auth/login", { email, password: PASSWORD }, { "x-forwarded-proto": "https" });
    expect(forged.headers.get("set-cookie")).not.toMatch(/Secure/);
    process.env.MORROW_SECURE_COOKIES = "true";
    expect((await signIn(new Client(), email)).headers.get("set-cookie")).toMatch(/; Secure/);
  });

  it("rejects cross-site writes, including ones that forge X-Forwarded-Host", async () => {
    const email = fresh();
    createUser(email, PASSWORD);
    const c = new Client();
    await signIn(c, email);
    const attempt = (headers: Record<string, string>) => c.call(collections.POST, "POST", "/api/collections", { json: { name: `c${Math.random()}` }, headers });
    expect((await attempt({ origin: "https://evil.example" })).status).toBe(403);
    expect((await attempt({ origin: "https://evil.example", "x-forwarded-host": "evil.example" })).status).toBe(403);
    expect((await attempt({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await attempt({ "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await attempt({ origin: "null" })).status).toBe(403);
    expect((await attempt({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin" })).status).toBe(201);
  });
});

describe("sessions", () => {
  it("lists devices, revokes one, and signs out the others without touching the current one", async () => {
    const email = fresh();
    createUser(email, PASSWORD);
    const laptop = new Client();
    const phone = new Client();
    const tablet = new Client();
    for (const c of [laptop, phone, tablet]) await signIn(c, email);
    const list = (await laptop.call(sessionsRoute.GET, "GET", "/api/sessions")).data.sessions as { id: number; current: boolean }[];
    expect(list).toHaveLength(3);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    const other = list.find((s) => !s.current)!;
    expect((await laptop.call(sessionsRoute.DELETE, "DELETE", "/api/sessions", { json: { id: other.id } })).status).toBe(200);
    const r = await laptop.call(sessionsRoute.DELETE, "DELETE", "/api/sessions", { json: { scope: "others" } });
    expect(r.data.revoked).toBe(1);
    expect((await phone.call(documents.GET, "GET", "/api/documents")).status).toBe(401);
    expect((await tablet.call(documents.GET, "GET", "/api/documents")).status).toBe(401);
    expect((await laptop.call(documents.GET, "GET", "/api/documents")).status).toBe(200);
  });

  it("signs out everywhere, including the device that asked", async () => {
    const email = fresh();
    createUser(email, PASSWORD);
    const a = new Client();
    const b = new Client();
    await signIn(a, email);
    await signIn(b, email);
    const r = await a.call(sessionsRoute.DELETE, "DELETE", "/api/sessions", { json: { scope: "all" } });
    expect(r.data.revoked).toBe(2);
    expect(r.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await b.call(documents.GET, "GET", "/api/documents")).status).toBe(401);
    expect((await a.call(me.GET, "GET", "/api/me")).data.user).toBeNull();
  });

  it("expires a session that has been idle too long, and one past its absolute lifetime", async () => {
    const email = fresh();
    createUser(email, PASSWORD);
    const idle = new Client();
    await signIn(idle, email);
    expect((await idle.call(documents.GET, "GET", "/api/documents")).status).toBe(200);
    db().prepare("UPDATE sessions SET last_seen_at = ? WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(Date.now() - 8 * 24 * 3600_000, email);
    expect((await idle.call(documents.GET, "GET", "/api/documents")).status).toBe(401);
    expect((db().prepare("SELECT count(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ?").get(email) as { n: number }).n).toBe(0);

    const old = new Client();
    await signIn(old, email);
    db().prepare("UPDATE sessions SET expires_at = ? WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(Date.now() - 1000, email);
    expect((await old.call(documents.GET, "GET", "/api/documents")).status).toBe(401);
  });

  it("rejects a forged or tampered cookie", async () => {
    const c = new Client();
    c.cookie = "morrow_session=" + "A".repeat(43);
    expect((await c.call(documents.GET, "GET", "/api/documents")).status).toBe(401);
    c.cookie = "morrow_session=' OR 1=1 --";
    expect((await c.call(documents.GET, "GET", "/api/documents")).status).toBe(401);
  });
});

describe("changing the password", () => {
  it("needs the current password, signs out other devices, and retires the old password", async () => {
    const email = fresh();
    createUser(email, PASSWORD);
    const here = new Client();
    const elsewhere = new Client();
    await signIn(here, email);
    await signIn(elsewhere, email);
    const NEW = "a brand new passphrase";
    expect((await post(here, passwordRoute.POST, "/api/account/password", { currentPassword: "not it at all", newPassword: NEW })).status).toBe(401);
    expect((await post(here, passwordRoute.POST, "/api/account/password", { currentPassword: PASSWORD, newPassword: "short" })).status).toBe(400);
    const ok = await post(here, passwordRoute.POST, "/api/account/password", { currentPassword: PASSWORD, newPassword: NEW });
    expect(ok.data.otherSessionsSignedOut).toBe(1);
    expect((await elsewhere.call(documents.GET, "GET", "/api/documents")).status).toBe(401);
    expect((await here.call(documents.GET, "GET", "/api/documents")).status).toBe(200);
    expect((await signIn(new Client(), email, PASSWORD)).status).toBe(401);
    expect((await signIn(new Client(), email, NEW)).status).toBe(200);
    expect((await post(new Client(), passwordRoute.POST, "/api/account/password", { currentPassword: NEW, newPassword: "whatever-long-enough" })).status).toBe(401);
  });
});

describe("password reset", () => {
  it("is switched off, and says why, when the server cannot send email", async () => {
    const r = await post(new Client(), resetRequest.POST, "/api/auth/reset/request", { email: fresh() });
    expect(r.status).toBe(503);
    expect(r.data.error.code).toBe("mail_not_configured");
    expect((await new Client().call(me.GET, "GET", "/api/me")).data.features.passwordReset).toBe(false);
  });

  it("answers identically for known and unknown addresses, and only mails the real one", async () => {
    process.env.MORROW_MAIL_TRANSPORT = "memory";
    process.env.MORROW_REQUIRE_EMAIL_VERIFICATION = "false";
    const real = fresh();
    createUser(real, PASSWORD);
    const a = await post(new Client(), resetRequest.POST, "/api/auth/reset/request", { email: real });
    const b = await post(new Client(), resetRequest.POST, "/api/auth/reset/request", { email: fresh() });
    expect([a.status, a.data]).toEqual([b.status, b.data]);
    expect(testOutbox().map((m) => m.to)).toEqual([real]);
  });

  it("builds the link from the configured public URL, not from the request's Host header", async () => {
    process.env.MORROW_MAIL_TRANSPORT = "memory";
    process.env.MORROW_REQUIRE_EMAIL_VERIFICATION = "false";
    process.env.MORROW_PUBLIC_URL = "https://morrow.example";
    const email = fresh();
    createUser(email, PASSWORD);
    await new Client().call(resetRequest.POST, "POST", "/api/auth/reset/request", { json: { email }, headers: { host: "attacker.example", origin: "http://attacker.example" } });
    expect(testOutbox()[0].text).toContain("https://morrow.example/reset?token=");
    expect(testOutbox()[0].text).not.toContain("attacker.example");
  });

  it("changes the password once, signs out every device, and cannot be replayed", async () => {
    process.env.MORROW_MAIL_TRANSPORT = "memory";
    process.env.MORROW_REQUIRE_EMAIL_VERIFICATION = "false";
    const email = fresh();
    createUser(email, PASSWORD);
    const device = new Client();
    await signIn(device, email);
    await post(new Client(), resetRequest.POST, "/api/auth/reset/request", { email });
    const token = tokenFrom(testOutbox()[0].text);
    // Only a hash of the token is stored.
    expect((db().prepare("SELECT count(*) AS n FROM auth_tokens WHERE token_hash = ?").get(token) as { n: number }).n).toBe(0);
    const NEW = "reset to this passphrase";
    expect((await post(new Client(), resetConfirm.POST, "/api/auth/reset/confirm", { token, password: "short" })).status).toBe(400);
    expect((await post(new Client(), resetConfirm.POST, "/api/auth/reset/confirm", { token, password: NEW })).status).toBe(200);
    expect((await device.call(documents.GET, "GET", "/api/documents")).status).toBe(401);
    expect((await signIn(new Client(), email, PASSWORD)).status).toBe(401);
    expect((await signIn(new Client(), email, NEW)).status).toBe(200);
    const replay = await post(new Client(), resetConfirm.POST, "/api/auth/reset/confirm", { token, password: "another long passphrase" });
    expect(replay.status).toBe(400);
    expect(replay.data.error.code).toBe("invalid_token");
    expect((await signIn(new Client(), email, NEW)).status).toBe(200);
  });

  it("rejects expired, unknown, wrong-purpose and superseded tokens the same way", async () => {
    const email = fresh();
    const user = createUser(email, PASSWORD);
    const tryReset = async (token: unknown) => (await post(new Client(), resetConfirm.POST, "/api/auth/reset/confirm", { token, password: "some new passphrase" })).data.error?.code;
    const expired = createAuthToken(user.id, "reset", 60_000);
    db().prepare("UPDATE auth_tokens SET expires_at = ? WHERE user_id = ?").run(Date.now() - 1, user.id);
    expect(await tryReset(expired)).toBe("invalid_token");
    expect(await tryReset("x".repeat(43))).toBe("invalid_token");
    expect(await tryReset(undefined)).toBe("invalid_token");
    expect(await tryReset(createAuthToken(user.id, "verify", 60_000))).toBe("invalid_token");
    const first = createAuthToken(user.id, "reset", 60_000);
    const second = createAuthToken(user.id, "reset", 60_000); // a newer request cancels the older link
    expect(await tryReset(first)).toBe("invalid_token");
    expect((await post(new Client(), resetConfirm.POST, "/api/auth/reset/confirm", { token: second, password: "some new passphrase" })).status).toBe(200);
  });

  it("limits how many reset emails one address can trigger", async () => {
    process.env.MORROW_MAIL_TRANSPORT = "memory";
    process.env.MORROW_REQUIRE_EMAIL_VERIFICATION = "false";
    const email = fresh();
    createUser(email, PASSWORD);
    for (let i = 0; i < 6; i++) expect((await post(new Client(), resetRequest.POST, "/api/auth/reset/request", { email })).status).toBe(200);
    expect(testOutbox()).toHaveLength(3);
  });

  it("clears a brute-force lock, so a locked-out owner can get back in", async () => {
    process.env.MORROW_MAIL_TRANSPORT = "memory";
    process.env.MORROW_REQUIRE_EMAIL_VERIFICATION = "false";
    const email = fresh();
    createUser(email, PASSWORD);
    for (let i = 0; i < 11; i++) await signIn(new Client(), email, "attacker-guess-xyz");
    expect((await signIn(new Client(), email)).status).toBe(429);
    await post(new Client(), resetRequest.POST, "/api/auth/reset/request", { email });
    const NEW = "owner chose a new one";
    await post(new Client(), resetConfirm.POST, "/api/auth/reset/confirm", { token: tokenFrom(testOutbox()[0].text), password: NEW });
    expect((await signIn(new Client(), email, NEW)).status).toBe(200);
  });
});

describe("email verification and non-enumerating sign-up", () => {
  it("without email delivery, sign-up signs in immediately and reports a taken address (documented limitation)", async () => {
    const email = fresh();
    const c = new Client();
    expect((await post(c, signup.POST, "/api/auth/signup", { email, password: PASSWORD })).status).toBe(201);
    expect(c.cookie).not.toBe("");
    expect((await post(new Client(), signup.POST, "/api/auth/signup", { email, password: PASSWORD })).status).toBe(409);
  });

  it("with email delivery, new and already-registered addresses get the same response and no session", async () => {
    process.env.MORROW_MAIL_TRANSPORT = "memory";
    const taken = fresh();
    createUser(taken, PASSWORD);
    const c1 = new Client();
    const c2 = new Client();
    const a = await post(c1, signup.POST, "/api/auth/signup", { email: fresh(), password: PASSWORD });
    const b = await post(c2, signup.POST, "/api/auth/signup", { email: taken, password: "an attacker's guess" });
    expect(a.status).toBe(202);
    expect([b.status, b.data]).toEqual([a.status, a.data]);
    expect(c1.cookie + c2.cookie).toBe("");
    expect(testOutbox()).toHaveLength(2);
    expect(testOutbox()[1].to).toBe(taken);
    expect(testOutbox()[1].text).not.toContain("token=");
    // The existing account's password was not changed by the second sign-up.
    process.env.MORROW_REQUIRE_EMAIL_VERIFICATION = "false";
    expect((await signIn(new Client(), taken, "an attacker's guess")).status).toBe(401);
    expect((await signIn(new Client(), taken, PASSWORD)).status).toBe(200);
  });

  it("blocks sign-in until the address is confirmed, then allows it; the link works once", async () => {
    process.env.MORROW_MAIL_TRANSPORT = "memory";
    const email = fresh();
    await post(new Client(), signup.POST, "/api/auth/signup", { email, password: PASSWORD });
    const token = tokenFrom(testOutbox()[0].text);
    const early = await signIn(new Client(), email);
    expect(early.status).toBe(403);
    expect(early.data.error.code).toBe("email_unverified");
    expect((await signIn(new Client(), email, "wrong password here")).status).toBe(401); // a stranger learns nothing
    expect((await post(new Client(), verify.POST, "/api/auth/verify", { token: "not-a-real-token-not-a-real-token" })).status).toBe(400);
    expect((await post(new Client(), verify.POST, "/api/auth/verify", { token })).status).toBe(200);
    expect((await post(new Client(), verify.POST, "/api/auth/verify", { token })).status).toBe(400);
    expect((await signIn(new Client(), email)).status).toBe(200);
  });

  it("a verification link cannot be used to reset a password", async () => {
    process.env.MORROW_MAIL_TRANSPORT = "memory";
    const email = fresh();
    await post(new Client(), signup.POST, "/api/auth/signup", { email, password: PASSWORD });
    const token = tokenFrom(testOutbox()[0].text);
    expect((await post(new Client(), resetConfirm.POST, "/api/auth/reset/confirm", { token, password: "hijack attempt long" })).status).toBe(400);
  });

  it("the in-memory mail transport cannot be enabled outside tests", async () => {
    const { config } = await import("@/lib/config");
    process.env.MORROW_MAIL_TRANSPORT = "memory";
    const before = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(config.mail.transport).toBe("none");
    (process.env as Record<string, string>).NODE_ENV = before!;
  });
});
