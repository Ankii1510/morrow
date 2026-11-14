import { requireUser } from "@/lib/auth";
import { ask } from "@/lib/ask/answer";
import { json, rateLimit, readJson, route, str } from "@/lib/http";
import type { Scope } from "@/lib/retrieval/search";

export const maxDuration = 120;

export const POST = route(async (req) => {
  const user = requireUser(req);
  rateLimit(`ask:${user.id}`, 30, 10 * 60_000);
  const body = await readJson(req);
  const question = str(body.question, "Question", { min: 3, max: 2000 });
  const raw = (body.scope || {}) as Record<string, unknown>;
  const scope: Scope = {
    collectionId: typeof raw.collectionId === "string" ? raw.collectionId : undefined,
    tag: typeof raw.tag === "string" ? raw.tag : undefined,
    documentIds: Array.isArray(raw.documentIds) ? raw.documentIds.filter((x): x is string => typeof x === "string").slice(0, 200) : undefined,
  };
  return json({ answer: await ask(user.id, question, scope) });
});
