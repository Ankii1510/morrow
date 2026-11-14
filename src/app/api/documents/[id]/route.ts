import { requireUser } from "@/lib/auth";
import { db, tx } from "@/lib/db";
import { deleteDocument, deletionImpact, getOwnedDocument, listDocuments } from "@/lib/documents";
import { AppError, json, normalizeTag, readJson, route, str } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, ctx) => {
  const user = requireUser(req);
  const { id } = await ctx.params;
  getOwnedDocument(user.id, id);
  const document = listDocuments(user.id).find((d) => d.id === id);
  return json({ document, deletionImpact: deletionImpact(user.id, id) });
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const user = requireUser(req);
  const { id } = await ctx.params;
  getOwnedDocument(user.id, id);
  const body = await readJson(req);
  tx(() => {
    if (body.title !== undefined) {
      db().prepare("UPDATE documents SET title = ? WHERE id = ? AND user_id = ?").run(str(body.title, "Title", { max: 200 }), id, user.id);
    }
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags) || body.tags.length > 12) throw new AppError(400, "invalid", "A document can have at most 12 tags.");
      const tags = [...new Set(body.tags.map(normalizeTag))];
      db().prepare("DELETE FROM document_tags WHERE document_id = ? AND user_id = ?").run(id, user.id);
      for (const t of tags) db().prepare("INSERT INTO document_tags (document_id, user_id, tag) VALUES (?,?,?)").run(id, user.id, t);
    }
    if (body.collections !== undefined) {
      if (!Array.isArray(body.collections)) throw new AppError(400, "invalid", "collections must be a list of ids.");
      db().prepare("DELETE FROM document_collections WHERE document_id = ?").run(id);
      for (const c of [...new Set(body.collections as unknown[])]) {
        // Only the caller's own collections can be attached.
        const own = db().prepare("SELECT id FROM collections WHERE id = ? AND user_id = ?").get(String(c), user.id);
        if (!own) throw new AppError(404, "not_found", "Collection not found.");
        db().prepare("INSERT INTO document_collections (document_id, collection_id) VALUES (?,?)").run(id, String(c));
      }
    }
  });
  return json({ document: listDocuments(user.id).find((d) => d.id === id) });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const user = requireUser(req);
  const { id } = await ctx.params;
  return json({ ok: true, ...deleteDocument(user.id, id) });
});
