import type { VerifiedGatewayAttestation, VerifiedModelAttestation } from "@nearai/inference-sdk/node";
import { receiptFiles } from "../storage";
import { summarize, type AttestationSummary, type VerifiedChat } from "./client";

/** What the UI shows for each answer. Every row is the result of a check that actually ran. */
export type Check = { id: string; label: string; detail: string };

export type AnswerVerification = {
  status: "verified";
  completionId: string;
  model: string;
  signatureKind: "provider_tee" | "gateway";
  signer: { signingAlgo: string; signingAddress: string };
  signedText: string;
  requestSha256: string | null;
  responseSha256: string | null;
  e2ee: true;
  chat: AttestationSummary;
  embedding: AttestationSummary | null;
  rerank: AttestationSummary | null;
  checks: Check[];
};

/**
 * A receipt is the raw evidence behind an answer, written to disk so the user
 * (or a judge) can re-verify it later without trusting Morrow:
 *   node scripts/verify-receipt.mjs <receipt.json>
 */
export type Receipt = {
  morrowReceipt: 1;
  createdAt: string;
  answerId: string;
  completionId: string;
  model: string;
  signature: { kind: string; signedText: string; signature: string; signer: { signingAlgo: string; signingAddress: string } };
  gateway: { nonce: string; spkiFingerprint: string | null; report: VerifiedGatewayAttestation["report"] };
  /** The verified model report(s) whose signer matches the response signature. */
  models: { nonce: string; report: VerifiedModelAttestation["report"] }[];
  note: string;
};

export function buildVerification(
  c: VerifiedChat,
  embedding: AttestationSummary | null,
  rerank: AttestationSummary | null,
): AnswerVerification {
  const chatSummary = summarize(c.model, c.attestation);
  const sig = c.response.signature;
  const parts = sig.signedText.split(":");
  // provider_tee: <model>:<request_hash>:<response_hash>; gateway: <request_hash>:<response_hash>
  const responseSha256 = parts.length >= 2 ? parts[parts.length - 1] : null;
  const requestSha256 = parts.length >= 2 ? parts[parts.length - 2] : null;
  const modelTcb = [...new Set(chatSummary.models.map((m) => m.tcbStatus))].join(", ");
  const checks: Check[] = [
    {
      id: "gateway_quote",
      label: "Gateway runs in a genuine Intel TDX enclave",
      detail: `Intel DCAP quote verified. TCB status: ${chatSummary.gateway.tcbStatus}. Debug mode off.`,
    },
    {
      id: "nonce",
      label: "Evidence is fresh, not replayed",
      detail: `The quote binds the nonce Morrow generated for this session (${chatSummary.gateway.nonce.slice(0, 16)}…).`,
    },
    {
      id: "tls",
      label: "Connection terminates at the attested Gateway",
      detail: `TLS public key ${chatSummary.gateway.tlsSpkiFingerprint?.slice(0, 16)}… is bound into the quote and pinned for every request.`,
    },
    {
      id: "model_quote",
      label: "Model runs in a verified TEE",
      detail: `${chatSummary.models.length} model attestation candidate(s) verified. TCB status: ${modelTcb}.`,
    },
    {
      id: "gpu",
      label: "GPU confidential-computing evidence",
      detail: chatSummary.models.every((m) => m.gpuEvidence === "verified")
        ? "NVIDIA attestation verified for every candidate."
        : "Not provided by one or more candidates (CPU TEE evidence still verified).",
    },
    {
      id: "e2ee",
      label: "Question and excerpts encrypted to the model's key",
      detail: "Message contents were end-to-end encrypted to the public key bound in the model's quote.",
    },
    {
      id: "signature",
      label: c.response.signatureKind === "provider_tee" ? "Answer signed inside the model TEE" : "Answer signed by the attested Gateway",
      detail:
        c.response.signatureKind === "provider_tee"
          ? `Signature over the exact request and response bytes matches the attested model signer ${sig.signer.signingAddress.slice(0, 14)}….`
          : `Signature matches the attested Gateway signer ${sig.signer.signingAddress.slice(0, 14)}…. This binds the bytes to the Gateway, not to the model TEE.`,
    },
  ];
  return {
    status: "verified",
    completionId: c.completionId,
    model: c.model,
    signatureKind: c.response.signatureKind,
    signer: { ...sig.signer },
    signedText: sig.signedText,
    requestSha256,
    responseSha256,
    e2ee: true,
    chat: chatSummary,
    embedding,
    rerank,
    checks,
  };
}

export function writeReceipt(userId: string, answerId: string, c: VerifiedChat): void {
  const models = c.response.signatureKind === "provider_tee" ? c.response.attestations : c.attestation.models;
  const receipt: Receipt = {
    morrowReceipt: 1,
    createdAt: new Date().toISOString(),
    answerId,
    completionId: c.completionId,
    model: c.model,
    signature: {
      kind: c.response.signatureKind,
      signedText: c.response.signature.signedText,
      signature: c.response.signature.signature,
      signer: { ...c.response.signature.signer },
    },
    gateway: {
      nonce: c.attestation.gateway.report.nonce,
      spkiFingerprint: c.attestation.gateway.tlsBinding.kind === "attested" ? c.attestation.gateway.tlsBinding.spkiFingerprint : null,
      report: c.attestation.gateway.report,
    },
    models: models.map((m) => ({ nonce: m.report.nonce, report: m.report })),
    note:
      "Contains attestation evidence and a signature only. It does not contain your question, your documents or the answer. " +
      "The signed text commits to SHA-256 hashes of the encrypted request and response bytes, which Morrow checked at answer time and did not retain.",
  };
  receiptFiles.write(userId, answerId, JSON.stringify(receipt));
}

/** Receipts live in the owner's own directory; reading one for another user's answer id finds nothing. */
export const readReceipt = (userId: string, answerId: string): string | null => receiptFiles.read(userId, answerId);
export const deleteReceipt = (userId: string, answerId: string): void => receiptFiles.remove(userId, answerId);
