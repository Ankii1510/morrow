import crypto from "node:crypto";
import { config, mailEnabled } from "./config";
import { db, tx } from "./db";
import { AppError, clearRateLimit, rateLimit, rateLimited, requestIsHttps } from "./http";
import { link, sendMailQuietly } from "./mail";

export type User = { id: string; email: string; createdAt: number; emailVerified: boolean };

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string") throw new AppError(400, "invalid", "Email is required.");
  const email = raw.trim().toLowerCase();
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, "invalid", "Enter a valid email address.");
  return email;
}

export function validatePassword(raw: unknown): string {
  if (typeof raw !== "string" || raw.length < 10) throw new AppError(400, "invalid", "Password must be at least 10 characters.");
  if (raw.length > 200) throw new AppError(400, "invalid", "Password is too long.");
  return raw;
}

type UserRow = { id: string; email: string; password_hash: string; created_at: number; email_verified_at: number | null };
const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, createdAt: r.created_at, emailVerified: r.email_verified_at !== null });

function findByEmail(email: string): UserRow | undefined {
  return db().prepare("SELECT id, email, password_hash, created_at, email_verified_at FROM users WHERE email = ?").get(email) as UserRow | undefined;
}

// ---------------------------------------------------------------------------------------------
// Sign-up
// ---------------------------------------------------------------------------------------------

/**
 * Create an account. When email verification is on, the outcome is deliberately invisible to the
 * caller: a new address gets a confirmation link, an address that already has an account gets a
 * notice, and the HTTP response is the same in both cases.
 */
export function signUp(email: string, password: string): { user: User; pending: boolean } | { user: null; pending: true } {
  const verify = config.mail.requireVerification;
  const existing = findByEmail(email);
  if (existing) {
    if (!verify) throw new AppError(409, "email_taken", "An account with this email already exists.");
    hashPassword(password); // spend the same time as the path that creates an account
    sendMailQuietly({
      to: email,
      subject: "You already have a Morrow account",
      text: `Someone tried to create a Morrow account with this address, but one already exists.\n\nIf that was you, sign in at ${config.mail.publicUrl} or reset your password at ${config.mail.publicUrl}/reset.\nIf it was not you, you can ignore this message; nothing has changed.`,
    });
    return { user: null, pending: true };
  }
  const now = Date.now();
  const row: UserRow = { id: crypto.randomUUID(), email, password_hash: hashPassword(password), created_at: now, email_verified_at: verify ? null : now };
  db().prepare("INSERT INTO users (id, email, password_hash, created_at, email_verified_at, password_changed_at) VALUES (?,?,?,?,?,?)").run(row.id, email, row.password_hash, now, row.email_verified_at, now);
  if (verify) sendVerification(row.id, email);
  return { user: toUser(row), pending: verify };
}

/** Used by tests and seed scripts: create a verified account directly. */
export function createUser(email: string, password: string): User {
  if (findByEmail(email)) throw new AppError(409, "email_taken", "An account with this email already exists.");
  const now = Date.now();
  const id = crypto.randomUUID();
  db().prepare("INSERT INTO users (id, email, password_hash, created_at, email_verified_at, password_changed_at) VALUES (?,?,?,?,?,?)").run(id, email, hashPassword(password), now, now, now);
  return { id, email, createdAt: now, emailVerified: true };
}

function sendVerification(userId: string, email: string): void {
  const token = createAuthToken(userId, "verify", 24 * 3600_000);
  sendMailQuietly({
    to: email,
    subject: "Confirm your email for Morrow",
    text: `Confirm this address to finish creating your Morrow library:\n\n${link("/verify", token)}\n\nThe link works once and expires in 24 hours. If you did not ask for this, ignore this message.`,
  });
}

// ---------------------------------------------------------------------------------------------
// Sign-in, with brute-force protection that does not reveal which addresses have accounts
// ---------------------------------------------------------------------------------------------

const LOGIN_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;
const failKey = (email: string) => `login-fail:${email}`;

/**
 * Failed attempts are counted per address whether or not an account exists, so the lock behaves
 * identically for registered and unregistered addresses. The lock is temporary (15 minutes) to limit
 * how long someone can keep a real user out by guessing wrong on purpose; a password reset clears it.
 */
export function authenticate(email: string, password: string): User {
  const locked = rateLimited(failKey(email), LOGIN_FAILURES);
  if (locked) {
    throw new AppError(429, "too_many_attempts", `Too many failed sign-in attempts for this address. Try again in ${Math.ceil(locked / 60)} minutes, or reset your password.`, { retryAfter: locked });
  }
  const row = findByEmail(email);
  // Hash even when the user is unknown so timing does not reveal which emails exist.
  const ok = row ? verifyPassword(password, row.password_hash) : (hashPassword(password), false);
  if (!row || !ok) {
    try {
      rateLimit(failKey(email), LOGIN_FAILURES, LOGIN_WINDOW_MS);
    } catch {
      /* the limit is enforced on the next attempt, with the generic message below for this one */
    }
    throw new AppError(401, "bad_credentials", "Email or password is incorrect.");
  }
  clearRateLimit(failKey(email));
  if (config.mail.requireVerification && row.email_verified_at === null) {
    // Only reachable with the correct password, so this does not reveal anything to a stranger.
    try {
      rateLimit(`verify-resend:${row.id}`, 3, 3600_000);
      sendVerification(row.id, row.email);
    } catch {
      /* already sent recently */
    }
    throw new AppError(403, "email_unverified", "Confirm your email address first. We have sent you a new confirmation link.");
  }
  return toUser(row);
}

// ---------------------------------------------------------------------------------------------
// One-time tokens (password reset, email verification)
// ---------------------------------------------------------------------------------------------

type Purpose = "reset" | "verify";

/**
 * Returns the raw token for the email; only its SHA-256 is stored.
 * A new reset link cancels older unused reset links. Verification links are not cancelled by a
 * re-send, so whichever confirmation email the person opens still works until it expires.
 */
export function createAuthToken(userId: string, purpose: Purpose, ttlMs: number): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  tx(() => {
    db().prepare("DELETE FROM auth_tokens WHERE (user_id = ? AND purpose = 'reset' AND ? = 'reset' AND used_at IS NULL) OR (user_id = ? AND expires_at < ?)").run(userId, purpose, userId, now - 7 * 24 * 3600_000);
    db().prepare("INSERT INTO auth_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?,?,?,?,?)").run(sha256(token), userId, purpose, now, now + ttlMs);
  });
  return token;
}

/** Atomically spend a token. Unknown, expired, already-used and wrong-purpose tokens all fail the same way. */
function consumeAuthToken(token: unknown, purpose: Purpose): string {
  const invalid = new AppError(400, "invalid_token", "This link is invalid or has expired. Request a new one.");
  if (typeof token !== "string" || token.length < 20 || token.length > 200) throw invalid;
  const now = Date.now();
  const r = db().prepare("UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id").get(now, sha256(token), purpose, now) as { user_id: string } | undefined;
  if (!r) throw invalid;
  return r.user_id;
}

/** Always succeeds from the caller's point of view; mail is sent only if the account exists. */
export function requestPasswordReset(email: string): void {
  if (!mailEnabled()) throw new AppError(503, "mail_not_configured", "Password reset is not available on this Morrow server because it cannot send email. Ask whoever runs it.");
  try {
    rateLimit(`reset:${email}`, 3, 3600_000);
  } catch {
    return; // silently: the response must not differ
  }
  const row = findByEmail(email);
  if (!row) {
    hashPassword("equalise-timing");
    return;
  }
  const token = createAuthToken(row.id, "reset", 30 * 60_000);
  sendMailQuietly({
    to: row.email,
    subject: "Reset your Morrow password",
    text: `Use this link to choose a new password:\n\n${link("/reset", token)}\n\nIt works once and expires in 30 minutes. Choosing a new password signs you out everywhere.\nIf you did not ask for this, ignore this message; your password has not changed.`,
  });
}

export function resetPassword(token: unknown, newPassword: string): void {
  const userId = consumeAuthToken(token, "reset");
  const now = Date.now();
  let email = "";
  tx(() => {
    // Receiving the link proves control of the mailbox, so the address is verified too.
    const r = db().prepare("UPDATE users SET password_hash = ?, password_changed_at = ?, email_verified_at = coalesce(email_verified_at, ?) WHERE id = ? RETURNING email").get(hashPassword(newPassword), now, now, userId) as { email: string } | undefined;
    if (!r) throw new AppError(400, "invalid_token", "This link is invalid or has expired. Request a new one.");
    email = r.email;
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    db().prepare("DELETE FROM auth_tokens WHERE user_id = ? AND purpose = 'reset'").run(userId);
  });
  clearRateLimit(failKey(email));
}

export function verifyEmail(token: unknown): void {
  const userId = consumeAuthToken(token, "verify");
  db().prepare("UPDATE users SET email_verified_at = coalesce(email_verified_at, ?) WHERE id = ?").run(Date.now(), userId);
}

/** Change password while signed in. Every other session is revoked; the current one stays. */
export function changePassword(req: Request, user: User, current: unknown, next: string): number {
  if (typeof current !== "string") throw new AppError(400, "invalid", "Enter your current password.");
  rateLimit(`pw-change:${user.id}`, 8, 15 * 60_000);
  const row = findByEmail(user.email);
  if (!row || !verifyPassword(current, row.password_hash)) throw new AppError(401, "bad_credentials", "Your current password is incorrect.");
  const keep = readToken(req);
  return tx(() => {
    db().prepare("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?").run(hashPassword(next), Date.now(), user.id);
    return Number(db().prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(user.id, keep ? sha256(keep) : "").changes);
  });
}

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

/** Creates a session and returns the Set-Cookie header value. Only a hash of the token is stored. */
export function startSession(userId: string, req: Request): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  db().prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  // Keep at most 20 sessions per account: the oldest are dropped.
  db().prepare("DELETE FROM sessions WHERE user_id = ? AND rowid NOT IN (SELECT rowid FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 19)").run(userId, userId);
  db().prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?,?,?,?,?,?)").run(sha256(token), userId, now, now + config.session.ttlMs, now, (req.headers.get("user-agent") || "").slice(0, 200));
  return sessionCookie(token, Math.floor(config.session.ttlMs / 1000), req);
}

function sessionCookie(value: string, maxAge: number, req: Request): string {
  const secure = requestIsHttps(req) ? "; Secure" : "";
  return `${config.session.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readToken(req: Request): string | undefined {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === config.session.cookieName) return part.slice(i + 1).trim() || undefined;
  }
  return undefined;
}

export function endSession(req: Request): string {
  const token = readToken(req);
  if (token) db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  return sessionCookie("", 0, req);
}

/**
 * The signed-in user, derived only from the session cookie. A session is valid while it is inside its
 * absolute lifetime and has been used within the idle window. Password resets delete every session and
 * password changes delete every other session, so no session survives a credential change it should not.
 */
export function currentUser(req: Request): User | null {
  const token = readToken(req);
  if (!token) return null;
  const now = Date.now();
  const h = sha256(token);
  const row = db()
    .prepare(
      `SELECT u.id, u.email, u.password_hash, u.created_at, u.email_verified_at, s.last_seen_at, s.created_at AS session_created, u.password_changed_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(h, now) as (UserRow & { last_seen_at: number | null; session_created: number; password_changed_at: number | null }) | undefined;
  if (!row) return null;
  const lastSeen = row.last_seen_at ?? row.session_created;
  if (now - lastSeen > config.session.idleMs) {
    db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(h);
    return null;
  }
  // Touch at most once a minute to avoid a write on every request.
  if (now - lastSeen > 60_000) db().prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(now, h);
  return toUser(row);
}

export function requireUser(req: Request): User {
  const user = currentUser(req);
  if (!user) throw new AppError(401, "unauthenticated", "Sign in to continue.");
  return user;
}

export function listSessions(req: Request, userId: string) {
  const token = readToken(req);
  const mine = token ? sha256(token) : "";
  const rows = db().prepare("SELECT rowid AS id, token_hash, created_at, last_seen_at, expires_at, user_agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC").all(userId, Date.now()) as { id: number; token_hash: string; created_at: number; last_seen_at: number | null; expires_at: number; user_agent: string | null }[];
  return rows.map((r) => ({ id: r.id, current: r.token_hash === mine, createdAt: r.created_at, lastSeenAt: r.last_seen_at ?? r.created_at, expiresAt: r.expires_at, userAgent: r.user_agent || "" }));
}

/** Revoke one of the caller's own sessions by id. Another user's session id simply matches nothing. */
export function revokeSession(userId: string, id: number): boolean {
  return db().prepare("DELETE FROM sessions WHERE rowid = ? AND user_id = ?").run(id, userId).changes > 0;
}

/** Sign out everywhere, optionally keeping the session making the request. */
export function revokeSessions(req: Request, userId: string, keepCurrent: boolean): number {
  const token = readToken(req);
  const keep = keepCurrent && token ? sha256(token) : "";
  return Number(db().prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(userId, keep).changes);
}
