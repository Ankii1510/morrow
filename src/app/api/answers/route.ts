import { requireUser } from "@/lib/auth";
import { listAnswers } from "@/lib/ask/answer";
import { json, route } from "@/lib/http";

export const GET = route(async (req) => json({ answers: listAnswers(requireUser(req).id) }));
