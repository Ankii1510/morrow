import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listDocuments } from "@/lib/documents";
import { rateLimit, route } from "@/lib/http";
import { usageHistory } from "@/lib/usage";

/** Everything Morrow stores for the user as one JSON file (original files are downloaded per document). */
export const GET = route(async (req) => {
  const user = requireUser(req);
  rateLimit(`export:${user.id}`, 10, 10 * 60_000);
  const documents = listDocuments(user.id).map((d) => ({
    ...d,
    pages: db().prepare("SELECT page, text FROM pages WHERE document_id = ? AND user_id = ? ORDER BY page").all(d.id, user.id),
  }));
  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      account: { email: user.email, createdAt: user.createdAt },
      documents,
      collections: db().prepare("SELECT id, name, created_at AS createdAt FROM collections WHERE user_id = ?").all(user.id),
      answers: db().prepare("SELECT id, question, answer, sources_json AS sources, model, created_at AS createdAt FROM answers WHERE user_id = ? ORDER BY created_at").all(user.id),
      aiUsage: usageHistory(user.id, 200),
      activity: db().prepare("SELECT kind, detail, created_at AS createdAt FROM activity WHERE user_id = ? ORDER BY id").all(user.id),
    },
    null,
    2,
  );
  return new Response(body, { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="morrow-export.json"', "Cache-Control": "private, no-store" } });
});
