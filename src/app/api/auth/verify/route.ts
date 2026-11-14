import { verifyEmail } from "@/lib/auth";
import { json, readJson, route, throttleAnonymous } from "@/lib/http";

export const POST = route(async (req) => {
  throttleAnonymous(req, "verify", 20, 240, 3600_000);
  verifyEmail((await readJson(req)).token);
  return json({ ok: true });
});
