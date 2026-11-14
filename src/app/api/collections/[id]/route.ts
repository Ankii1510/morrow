import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppError, json, readJson, route, str } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, ctx) => {
  const user = requireUser(req);
  const { id } = await ctx.params;
  const name = str((await readJson(req)).name, "Name", { max: 60 });
  const clash = db().prepare("SELECT 1 FROM collections WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?").get(user.id, name, id);
  if (clash) throw new AppError(409, "exists", "You already have a collection with that name.");
  const r = db().prepare("UPDATE collections SET name = ? WHERE id = ? AND user_id = ?").run(name, id, user.id);
  if (r.changes === 0) throw new AppError(404, "not_found", "Collection not found.");
  return json({ ok: true });
});

/** Deleting a collection never deletes documents; it only removes the grouping. */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const user = requireUser(req);
  const { id } = await ctx.params;
  const r = db().prepare("DELETE FROM collections WHERE id = ? AND user_id = ?").run(id, user.id);
  if (r.changes === 0) throw new AppError(404, "not_found", "Collection not found.");
  return json({ ok: true });
});
