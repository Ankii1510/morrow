#!/usr/bin/env node
// Independently re-verify a Morrow answer receipt. It does not talk to Morrow and does not need an API key.
//
//   node scripts/verify-receipt.mjs morrow-receipt-<id>.json
//
// What is checked, from the raw evidence in the file:
//   1. The response signature is a valid signature over the signed text by the stated signer.
//   2. The gateway's Intel TDX quote is genuine (Intel DCAP collateral), binds the recorded nonce,
//      the gateway signer and the recorded TLS key, and matches its event log and configuration hash.
//   3. Each model report's TDX quote is genuine and binds the same nonce and the model signer.
//      (GPU evidence is re-verified with NVIDIA when present.)
//   4. The signer of the response is exactly the signer bound into the verified quote
//      (the model enclave for "provider_tee", the gateway for "gateway").
// Network access to Intel and NVIDIA attestation services is required.
import fs from "node:fs";
import crypto from "node:crypto";
import { verifyMessage } from "ethers";
import { verifyGatewayAttestation, verifyModelAttestation, getSdkError } from "@nearai/inference-sdk/node";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/verify-receipt.mjs <receipt.json>");
  process.exit(2);
}
const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
if (receipt.morrowReceipt !== 1) {
  console.error("Not a Morrow receipt (morrowReceipt: 1 expected).");
  process.exit(2);
}

let ok = true;
const pass = (label, detail = "") => console.log(`PASS  ${label}${detail ? `\n      ${detail}` : ""}`);
const fail = (label, detail = "") => {
  ok = false;
  console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ""}`);
};
const same = (a, b) => String(a).toLowerCase().replace(/^0x/, "") === String(b).toLowerCase().replace(/^0x/, "");
const describe = (e) => JSON.stringify(getSdkError(e)?.toJSON()?.failure ?? String(e?.message ?? e));

const { signature, gateway, models } = receipt;
console.log(`Receipt for answer ${receipt.answerId}\nmodel ${receipt.model} · completion ${receipt.completionId} · created ${receipt.createdAt}\n`);

// 1. Signature over the signed text
try {
  let valid = false;
  if (signature.signer.signingAlgo === "ecdsa") {
    valid = same(verifyMessage(signature.signedText, signature.signature.startsWith("0x") ? signature.signature : `0x${signature.signature}`), signature.signer.signingAddress);
  } else if (signature.signer.signingAlgo === "ed25519") {
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(signature.signer.signingAddress.replace(/^0x/, ""), "hex")]);
    const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    valid = crypto.verify(null, Buffer.from(signature.signedText, "utf8"), key, Buffer.from(signature.signature.replace(/^0x/, ""), "hex"));
  }
  if (valid) pass("Response signature is valid", `signed text: ${signature.signedText}\n      signer: ${signature.signer.signingAddress} (${signature.signer.signingAlgo})`);
  else fail("Response signature does not verify");
} catch (e) {
  fail("Response signature could not be checked", describe(e));
}

// 2. Gateway attestation
let gatewaySigner = null;
try {
  const v = await verifyGatewayAttestation({ attestation: gateway.report, clientBinding: { nonce: gateway.nonce, spkiFingerprint: gateway.spkiFingerprint ?? undefined } });
  gatewaySigner = v.signer;
  pass("Gateway TDX quote is genuine and binds the nonce, signer and TLS key", `TCB ${v.tcbStatus} · nonce ${gateway.nonce}\n      signer ${v.signer.signingAddress} · TLS ${v.tlsBinding.kind === "attested" ? v.tlsBinding.spkiFingerprint : "not bound"}`);
} catch (e) {
  fail("Gateway attestation failed", describe(e));
}

// 3. Model attestations
const modelSigners = [];
for (const [i, m] of models.entries()) {
  try {
    const v = await verifyModelAttestation({ attestation: m.report, clientBinding: { nonce: m.nonce } });
    modelSigners.push(v.signer);
    pass(`Model report ${i + 1}/${models.length}: TDX quote is genuine and binds the nonce and signer`, `TCB ${v.tcbStatus} · GPU evidence ${v.gpuEvidence} · signer ${v.signer.signingAddress}`);
  } catch (e) {
    fail(`Model report ${i + 1}/${models.length} failed`, describe(e));
  }
}

// 4. Signer binding
const matches = (s) => s && s.signingAlgo === signature.signer.signingAlgo && same(s.signingAddress, signature.signer.signingAddress);
if (signature.kind === "provider_tee") {
  if (modelSigners.length > 0 && modelSigners.every(matches)) pass("The response was signed by the key bound into the verified model enclave quote");
  else fail("Response signer does not match a verified model enclave");
} else if (signature.kind === "gateway") {
  if (matches(gatewaySigner)) pass("The response was signed by the key bound into the verified gateway quote", "Note: a gateway signature binds the bytes to the gateway, not to the model enclave.");
  else fail("Response signer does not match the verified gateway");
} else fail(`Unknown signature kind: ${signature.kind}`);

console.log(ok ? "\nVERIFIED: every check passed." : "\nNOT VERIFIED: at least one check failed.");
console.log("Scope: this proves where the signed response came from. The signed text commits to SHA-256 hashes of the encrypted");
console.log("request and response; Morrow compared those to the real bytes when the answer was produced and did not keep them.");
process.exit(ok ? 0 : 1);
