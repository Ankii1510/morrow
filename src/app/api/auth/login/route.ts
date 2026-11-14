import { authenticate, normalizeEmail, startSession } from "@/lib/auth";
import { AppError, json, readJson, route, throttleAnonymous } from "@/lib/http";

export const POST = route(async (req) => {
  // Per-address limit when the address is trustworthy, plus a server-wide ceiling. Per-account
  // lockout is handled inside authenticate().
  throttleAnonymous(req, "login", 20, 300, 10 * 60_000);
  const body = await readJson(req);
  if (typeof body.password !== "string" || body.password.length > 200) throw new AppError(400, "invalid", "Password is required.");
  const user = authenticate(normalizeEmail(body.email), body.password);
  return json({ user: { id: user.id, email: user.email } }, { headers: { "Set-Cookie": startSession(user.id, req) } });
});
