import { requireUser } from "@/lib/auth";
import { json, rateLimit, readJson, route } from "@/lib/http";
import { search } from "@/lib/retrieval/search";

/**
 * Search the caller's own library. The app uses POST so the query travels in the request body:
 * query strings end up in server, proxy and browser-history logs, and a search query is personal.
 */
export const POST = route(async (req) => {
  const user = requireUser(req);
  rateLimit(`search:${user.id}`, 120, 60_000);
  const body = await readJson(req);
  const q = typeof body.q === "string" ? body.q.slice(0, 500) : "";
  const result = await search(user.id, q, {
    limit: 20,
    scope: { collectionId: typeof body.collection === "string" ? body.collection : undefined, tag: typeof body.tag === "string" ? body.tag : undefined },
  });
  return json(result);
});

/** Kept for scripts and API clients. Morrow's own interface does not use it. */
export const GET = route(async (req) => {
  const user = requireUser(req);
  rateLimit(`search:${user.id}`, 120, 60_000);
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").slice(0, 500);
  const result = await search(user.id, q, {
    limit: 20,
    scope: { collectionId: url.searchParams.get("collection") || undefined, tag: url.searchParams.get("tag") || undefined },
  });
  return json(result);
});
