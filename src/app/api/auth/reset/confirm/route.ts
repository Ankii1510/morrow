import { resetPassword, validatePassword } from "@/lib/auth";
import { json, readJson, route, throttleAnonymous } from "@/lib/http";

export const POST = route(async (req) => {
  throttleAnonymous(req, "reset-confirm", 10, 120, 3600_000);
  const body = await readJson(req);
  const password = validatePassword(body.password);
  resetPassword(body.token, password);
  return json({ ok: true });
});
