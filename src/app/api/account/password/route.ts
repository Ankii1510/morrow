import { changePassword, requireUser, validatePassword } from "@/lib/auth";
import { json, readJson, route } from "@/lib/http";

export const POST = route(async (req) => {
  const user = requireUser(req);
  const body = await readJson(req);
  const next = validatePassword(body.newPassword);
  const revoked = changePassword(req, user, body.currentPassword, next);
  return json({ ok: true, otherSessionsSignedOut: revoked });
});
