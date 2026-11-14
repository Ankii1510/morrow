import fs from "node:fs";
import path from "node:path";
import { requireUser } from "@/lib/auth";
import { ingestDocument } from "@/lib/documents";
import { ACCEPTED_EXTENSIONS } from "@/lib/ingest/extract";
import { AppError, json, rateLimit, route } from "@/lib/http";

/**
 * Adds the fictional sample documents in /samples to the caller's library through the
 * same ingestion path as a normal upload. They are real files, not mock data.
 */
export const POST = route(async (req) => {
  const user = requireUser(req);
  rateLimit(`samples:${user.id}`, 5, 10 * 60_000);
  const dir = path.join(process.cwd(), "samples");
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => ACCEPTED_EXTENSIONS.includes(path.extname(n).toLowerCase())).sort();
  } catch {
    throw new AppError(404, "no_samples", "The samples folder is missing from this installation.");
  }
  const added: string[] = [];
  const skipped: string[] = [];
  for (const name of names) {
    try {
      const doc = await ingestDocument(user.id, name, new Uint8Array(fs.readFileSync(path.join(dir, name))));
      added.push(doc.title);
    } catch (e) {
      if (e instanceof AppError && e.code === "duplicate") skipped.push(name);
      else throw e;
    }
  }
  return json({ added, skipped });
});
