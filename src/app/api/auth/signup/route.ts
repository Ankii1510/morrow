import { config } from "@/lib/config";
import { normalizeEmail, signUp, startSession, validatePassword } from "@/lib/auth";
import { AppError, json, readJson, route, throttleAnonymous } from "@/lib/http";

export const POST = route(async (req) => {
  throttleAnonymous(req, "signup", 5, 60, 3600_000);
  if (!config.allowSignup) throw new AppError(403, "signup_closed", "Sign-up is disabled on this Morrow instance.");
  const body = await readJson(req);
  const result = signUp(normalizeEmail(body.email), validatePassword(body.password));
  if (result.pending) {
    // Identical whether the address was new or already registered.
    return json({ pending: true, message: "If this address can be used, a confirmation link is on its way. Open it to finish creating your library." }, { status: 202 });
  }
  return json({ user: { id: result.user.id, email: result.user.email } }, { status: 201, headers: { "Set-Cookie": startSession(result.user.id, req) } });
});
