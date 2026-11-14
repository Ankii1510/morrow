import { endSession } from "@/lib/auth";
import { json, route } from "@/lib/http";

export const POST = route(async (req) => json({ ok: true }, { headers: { "Set-Cookie": endSession(req) } }));
