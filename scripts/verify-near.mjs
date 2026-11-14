#!/usr/bin/env node
// Minimal end-to-end proof of the NEAR AI Cloud integration, independent of the web app.
//
//   node scripts/verify-near.mjs                 attestation only (no API key needed, sends no data)
//   NEARAI_API_KEY=... node scripts/verify-near.mjs   also sends one E2EE completion and verifies its signature
//
// Uses the official SDK: https://docs.near.ai/cloud/inference-sdk/javascript
import fs from "node:fs";
import { InferenceClient, getSdkError } from "@nearai/inference-sdk/node";

// Load .env.local if present so the script matches the app's configuration.
for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const baseUrl = process.env.NEARAI_BASE_URL || "https://cloud-api.near.ai/v1";
const apiKey = process.env.NEARAI_API_KEY?.trim() || undefined;
const models = {
  chat: process.env.NEARAI_CHAT_MODEL || "z-ai/glm-5.3-flash",
  embedding: process.env.NEARAI_EMBEDDING_MODEL || "Qwen/Qwen3-Embedding-0.6B",
  rerank: process.env.NEARAI_RERANK_MODEL || "Qwen/Qwen3-Reranker-0.6B",
};

const client = new InferenceClient({ baseUrl, apiKey, e2ee: true, attestationCacheTimeToLiveMs: 0 });
let failed = false;

console.log(`NEAR AI Cloud: ${baseUrl}\n`);
for (const [role, model] of Object.entries(models)) {
  const t = Date.now();
  try {
    const r = await client.verify(model);
    console.log(`PASS  ${role.padEnd(9)} ${model}  (${Date.now() - t} ms)`);
    console.log(`      nonce (fresh, client-generated)  ${r.gateway.report.nonce}`);
    console.log(`      gateway  TDX quote valid, TCB ${r.gateway.tcbStatus}, signer ${r.gateway.signer.signingAddress}`);
    console.log(`      gateway  TLS key bound to quote: ${r.gateway.tlsBinding.kind === "attested" ? r.gateway.tlsBinding.spkiFingerprint : "NO"}`);
    for (const m of r.models) console.log(`      model    TDX quote valid, TCB ${m.tcbStatus}, GPU evidence ${m.gpuEvidence}, signer ${m.signer.signingAddress}`);
    if (r.models.length === 0) {
      console.log("FAIL  no model TEE evidence returned");
      failed = true;
    }
  } catch (e) {
    failed = true;
    console.log(`FAIL  ${role.padEnd(9)} ${model}: ${JSON.stringify(getSdkError(e)?.toJSON() ?? String(e))}`);
  }
}

if (!apiKey) {
  console.log("\nNo NEARAI_API_KEY set: skipped the inference step. Attestation above is real and needed no key.");
  process.exit(failed ? 1 : 0);
}

console.log(`\nSending one end-to-end encrypted completion to ${models.chat} ...`);
try {
  const completion = await client.chat.completions.create({
    model: models.chat,
    messages: [{ role: "user", content: "Reply with the single word: verified" }],
    max_tokens: 600,
  });
  const receipt = await client.verifyResponse(completion.id);
  console.log(`PASS  completion ${completion.id}`);
  console.log(`      answer          ${JSON.stringify(completion.choices[0]?.message?.content)}`);
  console.log(`      signature kind  ${receipt.signatureKind}  (provider_tee = signed inside the model enclave)`);
  console.log(`      signer          ${receipt.signature.signer.signingAddress} (${receipt.signature.signer.signingAlgo})`);
  console.log(`      signed text     ${receipt.signature.signedText}`);
} catch (e) {
  failed = true;
  console.log(`FAIL  inference: ${JSON.stringify(getSdkError(e)?.toJSON() ?? String(e))}`);
}
process.exit(failed ? 1 : 0);
