import { authenticate, endSession, requireUser } from "@/lib/auth";
import { deleteAllUserData } from "@/lib/documents";
import { AppError, json, rateLimit, readJson, route } from "@/lib/http";

/** Permanently deletes the account and everything it owns. Requires the password again. */
export const DELETE = route(async (req) => {
  const user = requireUser(req);
  rateLimit(`account-delete:${user.id}`, 5, 15 * 60_000);
  const body = await readJson(req);
  if (typeof body.password !== "string") throw new AppError(400, "invalid", "Enter your password to confirm.");
  authenticate(user.email, body.password);
  const cookie = endSession(req);
  deleteAllUserData(user.id);
  return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
});
