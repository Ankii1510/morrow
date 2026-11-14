import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { AppError, json, rateLimit, route } from "@/lib/http";
import { summarize, verifyModelFresh } from "@/lib/near/client";

export const maxDuration = 120;

/**
 * Runs a brand-new attestation verification (new nonce, no cache) for each model Morrow uses.
 * Sends no user data and needs no API key: attestation reports are public.
 */
export const POST = route(async (req) => {
  const user = requireUser(req);
  rateLimit(`verify:${user.id}`, 6, 60_000);
  const targets = [
    { role: "Answers", model: config.near.chatModel },
    { role: "Embeddings", model: config.near.embeddingModel },
    { role: "Reranking", model: config.near.rerankModel },
  ];
  const results = [];
  for (const t of targets) {
    const started = Date.now();
    try {
      const r = await verifyModelFresh(t.model);
      results.push({ ...t, ok: true as const, ms: Date.now() - started, attestation: summarize(t.model, r) });
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError(502, "verification_failed", "Verification failed.");
      results.push({ ...t, ok: false as const, ms: Date.now() - started, error: { code: err.code, message: err.message, failure: err.extra?.failure ?? null } });
    }
  }
  return json({ checkedAt: Date.now(), results });
});
