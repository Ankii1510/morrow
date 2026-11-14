import crypto from "node:crypto";
import { config } from "./config";
import { db, tx } from "./db";

/** An error that is safe to show to the client. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init?.headers || {}) },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    const headers: Record<string, string> = {};
    if (typeof e.extra?.retryAfter === "number") headers["Retry-After"] = String(e.extra.retryAfter);
    return json({ error: { code: e.code, message: e.message, ...e.extra } }, { status: e.status, headers });
  }
  // Never log request bodies, document text, questions or tokens: only the error name and message.
  const err = e as Error;
  console.error("[morrow] unhandled error:", err?.name, err?.message);
  return json({ error: { code: "internal", message: "Something went wrong on the server." } }, { status: 500 });
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response> | Response;

/** Wraps a route handler with error mapping and a same-origin check on state-changing requests. */
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      return await handler(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

function proxyTrusted(): boolean {
  return config.security.trustedProxyHops > 0;
}

/** The host this request was addressed to. Forwarded headers count only behind a configured proxy. */
function requestHost(req: Request): string | null {
  return (proxyTrusted() && req.headers.get("x-forwarded-host")) || req.headers.get("host");
}

export function requestIsHttps(req: Request): boolean {
  if (config.security.secureCookies) return true;
  if (proxyTrusted()) {
    const proto = req.headers.get("x-forwarded-proto");
    if (proto) return proto.split(",")[0].trim() === "https";
  }
  return new URL(req.url).protocol === "https:";
}

/**
 * CSRF defence in addition to SameSite=Lax cookies. A state-changing request from a browser
 * must come from the app's own origin: browsers always send Origin (and Sec-Fetch-Site) on such
 * requests. A request with neither header is a non-browser client, which carries no ambient cookies.
 */
export function assertSameOrigin(req: Request): void {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new AppError(403, "bad_origin", "Cross-site request rejected.");
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = requestHost(req);
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError(403, "bad_origin", "Cross-site request rejected.");
  }
  if (!host || originHost !== host) throw new AppError(403, "bad_origin", "Cross-site request rejected.");
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 64 * 1024): Promise<T> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new AppError(413, "too_large", "Request body is too large.");
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError(413, "too_large", "Request body is too large.");
  try {
    const v = JSON.parse(text || "{}");
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as T;
  } catch {
    throw new AppError(400, "bad_json", "Request body must be a JSON object.");
  }
}

export function str(v: unknown, field: string, opts: { min?: number; max: number }): string {
  if (typeof v !== "string") throw new AppError(400, "invalid", `${field} is required.`);
  const s = v.trim();
  if (s.length < (opts.min ?? 1)) throw new AppError(400, "invalid", `${field} is too short.`);
  if (s.length > opts.max) throw new AppError(400, "invalid", `${field} is too long (max ${opts.max} characters).`);
  return s;
}

export function normalizeTag(raw: unknown): string {
  const t = str(raw, "Tag", { max: 32 }).toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}\-_]/gu, "");
  if (!t) throw new AppError(400, "invalid", "Tags may contain letters, numbers, dashes and underscores.");
  return t;
}

// ---------------------------------------------------------------------------------------------
// Rate limiting: fixed-window counters stored in SQLite, so they survive restarts and are shared
// by anything using the same database file. Keys are hashed before storage.
// ---------------------------------------------------------------------------------------------

const keyHash = (key: string) => crypto.createHash("sha256").update(key).digest("hex");
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < 10 * 60_000) return;
  lastSweep = now;
  db().prepare("DELETE FROM rate_limits WHERE reset_at < ?").run(now);
}

/** Count one event against `key`; throws 429 with Retry-After when the window's limit is exceeded. */
export function rateLimit(key: string, limit: number, windowMs: number, message?: string): void {
  const now = Date.now();
  const h = keyHash(key);
  const over = tx(() => {
    sweep(now);
    const row = db().prepare("SELECT count, reset_at FROM rate_limits WHERE key_hash = ?").get(h) as { count: number; reset_at: number } | undefined;
    if (!row || row.reset_at <= now) {
      db().prepare("INSERT INTO rate_limits (key_hash, count, reset_at) VALUES (?,?,?) ON CONFLICT(key_hash) DO UPDATE SET count = 1, reset_at = excluded.reset_at").run(h, 1, now + windowMs);
      return 0;
    }
    db().prepare("UPDATE rate_limits SET count = count + 1 WHERE key_hash = ?").run(h);
    return row.count + 1 > limit ? row.reset_at : 0;
  });
  if (over) {
    const retry = Math.max(1, Math.ceil((over - now) / 1000));
    throw new AppError(429, "rate_limited", message || `Too many requests. Try again in ${retry < 90 ? `${retry} seconds` : `${Math.ceil(retry / 60)} minutes`}.`, { retryAfter: retry });
  }
}

/** Read-only check: is this key currently over its limit? Does not count an event. */
export function rateLimited(key: string, limit: number): number {
  const now = Date.now();
  const row = db().prepare("SELECT count, reset_at FROM rate_limits WHERE key_hash = ?").get(keyHash(key)) as { count: number; reset_at: number } | undefined;
  return row && row.reset_at > now && row.count >= limit ? Math.max(1, Math.ceil((row.reset_at - now) / 1000)) : 0;
}

export function clearRateLimit(key: string): void {
  db().prepare("DELETE FROM rate_limits WHERE key_hash = ?").run(keyHash(key));
}

/**
 * The client's network address, or null when it cannot be known.
 *
 * X-Forwarded-For is attacker-controlled unless a proxy the operator runs overwrites or appends
 * to it. With MORROW_TRUSTED_PROXY_HOPS = n, the address n entries from the right is the one
 * the outermost trusted proxy saw; anything further left was supplied by the client and is ignored.
 * With no trusted proxy the header is ignored completely.
 */
export function clientIp(req: Request): string | null {
  const hops = config.security.trustedProxyHops;
  if (hops <= 0) return null;
  const parts = (req.headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = parts[parts.length - hops];
  return ip && ip.length <= 64 ? ip : null;
}

/**
 * Throttle an unauthenticated endpoint. Per address when the address is trustworthy; otherwise a
 * single shared bucket with a higher ceiling, which caps total attempts without letting a client
 * escape the limit by inventing addresses.
 */
export function throttleAnonymous(req: Request, name: string, perIp: number, shared: number, windowMs: number): void {
  const ip = clientIp(req);
  if (ip) rateLimit(`${name}:ip:${ip}`, perIp, windowMs);
  rateLimit(`${name}:all`, shared, windowMs, "This server is receiving too many requests of this kind. Try again in a few minutes.");
}
