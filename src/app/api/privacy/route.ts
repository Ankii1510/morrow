import fs from "node:fs";
import { requireUser } from "@/lib/auth";
import { config, nearConfigured } from "@/lib/config";
import { db, dataPath } from "@/lib/db";
import { json, route } from "@/lib/http";
import { storageStatus } from "@/lib/storage";

/** A live inventory of what this Morrow instance holds for the signed-in user. Counts come from the database, not from copy. */
export const GET = route(async (req) => {
  const user = requireUser(req);
  const one = (sql: string) => (db().prepare(sql).get(user.id) as { n: number | null }).n || 0;
  const inventory = {
    documents: one("SELECT count(*) AS n FROM documents WHERE user_id = ?"),
    originalBytes: one("SELECT sum(size_bytes) AS n FROM documents WHERE user_id = ?"),
    pages: one("SELECT count(*) AS n FROM pages WHERE user_id = ?"),
    passages: one("SELECT count(*) AS n FROM chunks WHERE user_id = ?"),
    embeddedPassages: one("SELECT count(*) AS n FROM chunks WHERE user_id = ? AND embedding IS NOT NULL"),
    savedAnswers: one("SELECT count(*) AS n FROM answers WHERE user_id = ?"),
    collections: one("SELECT count(*) AS n FROM collections WHERE user_id = ?"),
    sessions: one("SELECT count(*) AS n FROM sessions WHERE user_id = ?"),
  };
  const activity = db().prepare("SELECT kind, detail, created_at AS createdAt FROM activity WHERE user_id = ? ORDER BY id DESC LIMIT 30").all(user.id);
  let dbBytes = 0;
  try {
    dbBytes = fs.statSync(dataPath("morrow.sqlite")).size;
  } catch {}
  return json({
    inventory,
    activity,
    storage: { dataDir: config.dataDir, databaseBytes: dbBytes, ...storageStatus() },
    near: {
      configured: nearConfigured(),
      baseUrl: config.near.baseUrl,
      chatModel: config.near.chatModel,
      embeddingModel: config.near.embeddingModel,
      rerankModel: config.near.rerankModel,
      attestationTtlMinutes: Math.round(config.near.attestationTtlMs / 60_000),
    },
  });
});
