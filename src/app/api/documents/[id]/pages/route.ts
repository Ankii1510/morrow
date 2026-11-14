import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOwnedDocument } from "@/lib/documents";
import { json, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

/** Extracted text per page plus passage boundaries, so the viewer can highlight a cited passage in place. */
export const GET = route<Ctx>(async (req, ctx) => {
  const user = requireUser(req);
  const { id } = await ctx.params;
  getOwnedDocument(user.id, id);
  const pages = db().prepare("SELECT page, text FROM pages WHERE document_id = ? AND user_id = ? ORDER BY page").all(id, user.id);
  const chunks = db().prepare("SELECT id, page, heading, char_start AS start, char_end AS end FROM chunks WHERE document_id = ? AND user_id = ? ORDER BY ordinal").all(id, user.id);
  return json({ pages, chunks });
});
