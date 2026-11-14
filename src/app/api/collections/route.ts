import crypto from "node:crypto";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppError, json, readJson, route, str } from "@/lib/http";

export const GET = route(async (req) => {
  const user = requireUser(req);
  const collections = db()
    .prepare(
      `SELECT c.id, c.name, c.created_at AS createdAt, count(dc.document_id) AS documentCount
       FROM collections c LEFT JOIN document_collections dc ON dc.collection_id = c.id
       WHERE c.user_id = ? GROUP BY c.id ORDER BY c.name COLLATE NOCASE`,
    )
    .all(user.id);
  const tags = db().prepare("SELECT tag, count(*) AS documentCount FROM document_tags WHERE user_id = ? GROUP BY tag ORDER BY tag").all(user.id);
  return json({ collections, tags });
});

export const POST = route(async (req) => {
  const user = requireUser(req);
  const name = str((await readJson(req)).name, "Name", { max: 60 });
  if (db().prepare("SELECT 1 FROM collections WHERE user_id = ? AND name = ? COLLATE NOCASE").get(user.id, name)) {
    throw new AppError(409, "exists", "You already have a collection with that name.");
  }
  const n = (db().prepare("SELECT count(*) AS n FROM collections WHERE user_id = ?").get(user.id) as { n: number }).n;
  if (n >= 200) throw new AppError(409, "limit", "Collection limit reached.");
  const id = crypto.randomUUID();
  db().prepare("INSERT INTO collections (id, user_id, name, created_at) VALUES (?,?,?,?)").run(id, user.id, name, Date.now());
  return json({ collection: { id, name, documentCount: 0 } }, { status: 201 });
});
