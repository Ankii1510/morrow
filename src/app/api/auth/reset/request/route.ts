import { normalizeEmail, requestPasswordReset } from "@/lib/auth";
import { json, readJson, route, throttleAnonymous } from "@/lib/http";

/** Always answers the same way, whether or not the address has an account. */
export const POST = route(async (req) => {
  throttleAnonymous(req, "reset-request", 5, 60, 3600_000);
  const body = await readJson(req);
  requestPasswordReset(normalizeEmail(body.email));
  return json({ ok: true, message: "If an account exists for that address, a reset link has been sent. It expires in 30 minutes." });
});
