import {
  InferenceClient,
  createPinnedTlsFetch,
  getSdkError,
  type AttestationVerificationResult,
  type VerifiedCompletionResult,
} from "@nearai/inference-sdk/node";
import { config } from "../config";
import { AppError } from "../http";
import { recordUsage, type ProviderUsage, type UsagePurpose } from "../usage";

/** Who a call is made for, so it can be accounted to them. Always the authenticated user, set by the server. */
export type CallContext = { userId: string; purpose: UsagePurpose };

/**
 * Every call Morrow makes to NEAR AI Cloud goes through this module.
 *
 * Policy (fail closed):
 *  1. Before any document text or question leaves this process, the Gateway and the
 *     target model's TEE are verified with a fresh client-generated nonce
 *     (Intel TDX quote via DCAP, NVIDIA GPU evidence via NRAS, nonce + signer binding,
 *     RTMR3 event-log replay, MRCONFIGID check). The official SDK performs these checks.
 *  2. Requests are only sent over a TLS connection whose public key was bound into the
 *     verified Gateway quote (SPKI pinning).
 *  3. Chat requests are end-to-end encrypted to the attested model key, and the response
 *     signature is verified against the same attested signer before the answer is used.
 *
 * There is no code path that fabricates a verification result: if a check throws,
 * the request is not sent (or the response is not used) and the caller gets an error.
 */

export type AttestationSummary = {
  model: string;
  verifiedAt: number;
  gateway: {
    signingAlgo: string;
    signingAddress: string;
    tcbStatus: string;
    advisoryIds: string[];
    nonce: string;
    tlsSpkiFingerprint: string | null;
  };
  models: {
    signingAlgo: string;
    signingAddress: string;
    tcbStatus: string;
    advisoryIds: string[];
    gpuEvidence: string;
    nonce: string;
  }[];
};

type G = typeof globalThis & { __morrowNear?: { key: string; client: InferenceClient } };

function client(): InferenceClient {
  const g = globalThis as G;
  const key = config.near.apiKey || "";
  if (g.__morrowNear && g.__morrowNear.key === key) return g.__morrowNear.client;
  const c = new InferenceClient({
    baseUrl: config.near.baseUrl,
    apiKey: config.near.apiKey,
    e2ee: true,
    attestationCacheTimeToLiveMs: config.near.attestationTtlMs,
  });
  g.__morrowNear = { key, client: c };
  return c;
}

export function requireKey(): void {
  if (!config.near.apiKey) {
    throw new AppError(503, "near_not_configured", "NEAR AI Cloud is not configured. Add NEARAI_API_KEY to .env.local and restart Morrow.");
  }
}

/** Convert SDK failures to errors that are safe to show. Verification failures are never downgraded. */
export function mapNearError(e: unknown, stage: string): AppError {
  if (e instanceof AppError) return e;
  const sdk = getSdkError(e);
  if (sdk) {
    const j = sdk.toJSON() as { name: string; message: string; failure?: { code?: string } };
    const code = j.failure?.code || "unknown";
    if (j.name === "VerificationError") {
      return new AppError(502, "verification_failed", `TEE verification failed during ${stage} (${code}). Nothing was sent, or the response was discarded.`, { failure: code, stage });
    }
    // The SDK reports HTTP failures in its message (for example "402 No spending limit configured").
    const http = /\b(401|402|403|429)\b/.exec(`${code} ${j.message}`);
    if (http) return providerStatusError(Number(http[1]), stage);
    return new AppError(502, "near_api_error", `NEAR AI Cloud returned an error during ${stage} (${code}).`, { failure: code, stage });
  }
  const msg = (e as Error)?.message || "unknown error";
  const http = /^(401|402|403|429)\b/.exec(msg);
  if (http) return providerStatusError(Number(http[1]), stage);
  return new AppError(502, "near_unreachable", `Could not reach NEAR AI Cloud during ${stage}: ${msg.slice(0, 160)}`, { stage });
}

export function summarize(model: string, r: AttestationVerificationResult): AttestationSummary {
  return {
    model,
    verifiedAt: r.verifiedAt,
    gateway: {
      signingAlgo: r.gateway.signer.signingAlgo,
      signingAddress: r.gateway.signer.signingAddress,
      tcbStatus: r.gateway.tcbStatus,
      advisoryIds: [...r.gateway.advisoryIds],
      nonce: r.gateway.report.nonce,
      tlsSpkiFingerprint: r.gateway.tlsBinding.kind === "attested" ? r.gateway.tlsBinding.spkiFingerprint : null,
    },
    models: r.models.map((m) => ({
      signingAlgo: m.signer.signingAlgo,
      signingAddress: m.signer.signingAddress,
      tcbStatus: m.tcbStatus,
      advisoryIds: [...m.advisoryIds],
      gpuEvidence: m.gpuEvidence,
      nonce: m.report.nonce,
    })),
  };
}

/** Verify (or reuse a still-fresh verification of) the Gateway and the model's TEE. */
export async function verifyModel(model: string): Promise<AttestationVerificationResult> {
  try {
    const r = await client().verify(model);
    assertPolicy(model, r);
    return r;
  } catch (e) {
    throw mapNearError(e, `attestation of ${model}`);
  }
}

/**
 * Run a verification that cannot be served from cache: a new client, a new nonce.
 * Works without an API key (attestation reports are public), so the Privacy Center
 * can show real evidence before any credential or document exists.
 */
export async function verifyModelFresh(model: string): Promise<AttestationVerificationResult> {
  try {
    const c = new InferenceClient({ baseUrl: config.near.baseUrl, apiKey: config.near.apiKey, e2ee: true, attestationCacheTimeToLiveMs: 0 });
    const r = await c.verify(model);
    assertPolicy(model, r);
    return r;
  } catch (e) {
    throw mapNearError(e, `attestation of ${model}`);
  }
}

/** Morrow's own acceptance policy on top of the SDK's cryptographic checks. */
function assertPolicy(model: string, r: AttestationVerificationResult): void {
  if (r.models.length === 0) {
    throw new AppError(502, "verification_failed", `${model} returned no model TEE evidence. Morrow only sends your data to models with verified TEE attestation.`, { failure: "policy.no_model_evidence" });
  }
  if (r.gateway.tlsBinding.kind !== "attested") {
    throw new AppError(502, "verification_failed", "The Gateway TLS key is not bound to its attestation.", { failure: "policy.tls_unbound" });
  }
}

function pinnedFetch(r: AttestationVerificationResult): typeof fetch {
  if (r.gateway.tlsBinding.kind !== "attested") throw new AppError(502, "verification_failed", "The Gateway TLS key is not bound to its attestation.");
  return createPinnedTlsFetch(r.gateway.tlsBinding.spkiFingerprint);
}

async function postJson<T>(r: AttestationVerificationResult, pathname: string, body: unknown, stage: string): Promise<T> {
  requireKey();
  let res: Response;
  try {
    res = await pinnedFetch(r)(`${config.near.baseUrl}${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.near.apiKey}`,
        "x-no-aliasing": "true", // fail instead of silently routing to a different model
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw mapNearError(e, stage);
  }
  if (!res.ok) {
    const status = res.status;
    await res.body?.cancel().catch(() => {});
    throw providerStatusError(status, stage);
  }
  return (await res.json()) as T;
}

/**
 * Provider-side payment, quota and auth failures, worded for the person using Morrow. These are the
 * operator's problem to fix, so the message says so instead of suggesting the user did something wrong.
 */
export function providerStatusError(status: number, stage: string): AppError {
  if (status === 401 || status === 403) return new AppError(503, "near_auth", "NEAR AI Cloud rejected this server's API key. Whoever runs this Morrow server needs to check it.");
  if (status === 402) return new AppError(503, "near_credits", "This server's NEAR AI Cloud account has no credits or spending limit. Whoever runs this Morrow server needs to add credits.");
  if (status === 429) return new AppError(503, "near_rate_limited", "NEAR AI Cloud is rate limiting this server. Try again in a minute.", { retryAfter: 60 });
  return new AppError(502, "near_api_error", `NEAR AI Cloud returned HTTP ${status} during ${stage}.`);
}

const EMBED_BATCH = 24;

/** Run one provider call and record it against the user, with the provider's own token counts when it returns them. */
async function accounted<T extends { usage?: ProviderUsage }>(ctx: CallContext, kind: "embedding" | "rerank", model: string, units: number, call: () => Promise<T>): Promise<T> {
  try {
    const out = await call();
    recordUsage({ userId: ctx.userId, kind, purpose: ctx.purpose, model, units, usage: out.usage, ok: true });
    return out;
  } catch (e) {
    recordUsage({ userId: ctx.userId, kind, purpose: ctx.purpose, model, units, ok: false });
    throw e;
  }
}

/** Embeddings from a TEE-hosted model, sent only to the attested, TLS-pinned Gateway. */
export async function embed(texts: string[], ctx: CallContext): Promise<{ vectors: Float32Array[]; attestation: AttestationSummary }> {
  requireKey();
  const model = config.near.embeddingModel;
  const att = await verifyModel(model);
  const vectors: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const out = await accounted(ctx, "embedding", model, batch.length, () => postJson<{ data: { index: number; embedding: number[] }[]; usage?: ProviderUsage }>(att, "/embeddings", { model, input: batch }, "embedding"));
    if (!Array.isArray(out.data) || out.data.length !== batch.length) throw new AppError(502, "near_api_error", "Embedding response had an unexpected shape.");
    const ordered = [...out.data].sort((a, b) => a.index - b.index);
    for (const d of ordered) vectors.push(normalizeVec(Float32Array.from(d.embedding)));
  }
  return { vectors, attestation: summarize(model, att) };
}

export function normalizeVec(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Qwen3-Embedding is instruction-aware: queries carry a task instruction, passages do not. */
export function queryInstruction(q: string): string {
  return `Instruct: Given a question, retrieve passages from the user's personal documents that answer it\nQuery: ${q}`;
}

export async function rerank(query: string, documents: string[], ctx: CallContext): Promise<{ scores: number[]; attestation: AttestationSummary }> {
  requireKey();
  const model = config.near.rerankModel;
  const att = await verifyModel(model);
  const out = await accounted(ctx, "rerank", model, documents.length, () => postJson<{ results: { index: number; relevance_score: number }[]; usage?: ProviderUsage }>(att, "/rerank", { model, query, documents }, "reranking"));
  const scores = new Array<number>(documents.length).fill(0);
  for (const r of out.results || []) if (r.index >= 0 && r.index < scores.length) scores[r.index] = r.relevance_score;
  return { scores, attestation: summarize(model, att) };
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type VerifiedChat = {
  completionId: string;
  model: string;
  content: string;
  attestation: AttestationVerificationResult;
  response: VerifiedCompletionResult;
};

/**
 * One end-to-end encrypted, non-streamed completion. Non-streamed on purpose:
 * the model TEE signs unmodified response bytes (signature kind "provider_tee"),
 * whereas streamed responses are re-signed by the Gateway only.
 */
export async function chat(messages: ChatMessage[], ctx: CallContext, maxTokens = 3000): Promise<VerifiedChat> {
  requireKey();
  const model = config.near.chatModel;
  const attestation = await verifyModel(model);
  let completion;
  try {
    completion = await client().chat.completions.create({ model, messages, max_tokens: maxTokens, stream: false });
  } catch (e) {
    recordUsage({ userId: ctx.userId, kind: "chat", purpose: ctx.purpose, model, units: 1, ok: false });
    throw mapNearError(e, "inference");
  }
  // Recorded as soon as the provider has done the work, whether or not the answer is later accepted.
  recordUsage({ userId: ctx.userId, kind: "chat", purpose: ctx.purpose, model, units: 1, usage: completion.usage as ProviderUsage, ok: true });
  let response: VerifiedCompletionResult;
  try {
    response = await client().verifyResponse(completion.id);
  } catch (e) {
    // The answer exists but cannot be tied to the attested signer: discard it.
    throw mapNearError(e, "response signature verification");
  }
  const content = completion.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AppError(502, "empty_completion", "The model returned an empty answer.");
  }
  return { completionId: completion.id, model, content, attestation, response };
}
