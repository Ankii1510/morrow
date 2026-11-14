import { endSession, listSessions, requireUser, revokeSession, revokeSessions } from "@/lib/auth";
import { AppError, json, readJson, route } from "@/lib/http";

/** The caller's own sessions. Session tokens and their hashes are never returned. */
export const GET = route(async (req) => {
  const user = requireUser(req);
  return json({ sessions: listSessions(req, user.id) });
});

/**
 * { scope: "others" }  sign out every other device
 * { scope: "all" }     sign out everywhere, including here
 * { id: number }       sign out one session
 */
export const DELETE = route(async (req) => {
  const user = requireUser(req);
  const body = await readJson(req);
  if (body.scope === "others") return json({ ok: true, revoked: revokeSessions(req, user.id, true) });
  if (body.scope === "all") {
    const cookie = endSession(req);
    return json({ ok: true, revoked: revokeSessions(req, user.id, false) + 1 }, { headers: { "Set-Cookie": cookie } });
  }
  if (typeof body.id === "number" && Number.isInteger(body.id)) {
    if (!revokeSession(user.id, body.id)) throw new AppError(404, "not_found", "Session not found.");
    return json({ ok: true, revoked: 1 });
  }
  throw new AppError(400, "invalid", "Specify a scope or a session id.");
});
