import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AttestationClient, InferenceClient, isVerificationError, verifyGatewayAttestation, verifyModelAttestation } from "@nearai/inference-sdk/node";
import { config } from "@/lib/config";
import { summarize, verifyModelFresh } from "@/lib/near/client";

/**
 * Live tests against NEAR AI Cloud. They need network access but no API key and send no user data.
 * Run with: npm run test:live
 */
const live = process.env.MORROW_LIVE_TESTS ? describe : describe.skip;

live("NEAR AI Cloud attestation (live)", () => {
  it("verifies the Gateway and the chat model TEE with a fresh nonce", async () => {
    const a = summarize(config.near.chatModel, await verifyModelFresh(config.near.chatModel));
    const b = summarize(config.near.chatModel, await verifyModelFresh(config.near.chatModel));
    expect(a.gateway.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(a.gateway.nonce).not.toBe(b.gateway.nonce); // a new nonce every time
    expect(a.gateway.tlsSpkiFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(a.models.length).toBeGreaterThan(0);
    for (const m of a.models) expect(m.nonce).toBe(a.gateway.nonce.length ? m.nonce : "");
  });

  it("verifies the embedding and reranking model TEEs", async () => {
    for (const model of [config.near.embeddingModel, config.near.rerankModel]) {
      const s = summarize(model, await verifyModelFresh(model));
      expect(s.models.length).toBeGreaterThan(0);
    }
  });

  it("rejects a replayed report (nonce mismatch)", async () => {
    const f = await new AttestationClient({ baseUrl: config.near.baseUrl }).fetchGatewayAttestation();
    const replay = verifyGatewayAttestation({ attestation: f.attestation, clientBinding: { ...f.clientBinding, nonce: "ab".repeat(32) } });
    await expect(replay).rejects.toSatisfy((e) => isVerificationError(e) && /nonce/.test(String((e as Error).message)));
  });

  it("rejects a report whose signer was swapped", async () => {
    const f = await new AttestationClient({ baseUrl: config.near.baseUrl }).fetchGatewayAttestation({ signingAlgo: "ecdsa" });
    const forged = { ...f.attestation, signer: { ...f.attestation.signer, signingAddress: "0x" + "11".repeat(20) } };
    await expect(verifyGatewayAttestation({ attestation: forged, clientBinding: f.clientBinding })).rejects.toSatisfy(isVerificationError);
  });

  it("rejects a tampered quote", async () => {
    const f = await new AttestationClient({ baseUrl: config.near.baseUrl }).fetchGatewayAttestation();
    const q = f.attestation.intelQuote;
    const i = Math.floor(q.length / 2);
    const flipped = q.slice(0, i) + (q[i] === "0" ? "1" : "0") + q.slice(i + 1);
    await expect(verifyGatewayAttestation({ attestation: { ...f.attestation, intelQuote: flipped }, clientBinding: f.clientBinding })).rejects.toBeTruthy();
  });

  it("fails closed for a model with no TEE evidence", async () => {
    await expect(verifyModelFresh("openai/gpt-5-nano")).rejects.toMatchObject({ code: "verification_failed" });
  });

  it("rejects a model report checked against a different nonce (nonce binding on the model enclave)", async () => {
    const f = await new AttestationClient({ baseUrl: config.near.baseUrl }).fetchModelAttestations({ model: config.near.chatModel });
    expect(f.attestations.length).toBeGreaterThan(0);
    await verifyModelAttestation({ attestation: f.attestations[0], clientBinding: f.clientBinding }); // genuine: passes
    await expect(verifyModelAttestation({ attestation: f.attestations[0], clientBinding: { nonce: "cd".repeat(32) } })).rejects.toSatisfy(isVerificationError);
  });

  it("rejects a gateway report whose TLS key does not match the connection (certificate binding)", async () => {
    const f = await new AttestationClient({ baseUrl: config.near.baseUrl }).fetchGatewayAttestation();
    expect(f.clientBinding.spkiFingerprint).toMatch(/^[0-9a-f]{64}$/);
    await expect(verifyGatewayAttestation({ attestation: f.attestation, clientBinding: { ...f.clientBinding, spkiFingerprint: "00".repeat(32) } })).rejects.toSatisfy(isVerificationError);
  });

  it("rejects a report whose measured configuration was altered (measurement validation)", async () => {
    const f = await new AttestationClient({ baseUrl: config.near.baseUrl }).fetchGatewayAttestation();
    const altered = { ...f.attestation, appCompose: f.attestation.appCompose + " " };
    await expect(verifyGatewayAttestation({ attestation: altered, clientBinding: f.clientBinding })).rejects.toSatisfy(isVerificationError);
  });

  it("the receipt verifier accepts genuine evidence only with the genuine signer, nonce and file format", async () => {
    const c = new InferenceClient({ baseUrl: config.near.baseUrl, e2ee: true, attestationCacheTimeToLiveMs: 0 });
    const r = await c.verify(config.near.chatModel);
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const forgedSigner = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
    const signedText = `${config.near.chatModel}:${"a".repeat(64)}:${"b".repeat(64)}`;
    const base = {
      morrowReceipt: 1,
      createdAt: new Date().toISOString(),
      answerId: "regression",
      completionId: "regression",
      model: config.near.chatModel,
      gateway: { nonce: r.gateway.report.nonce, spkiFingerprint: r.gateway.tlsBinding.kind === "attested" ? r.gateway.tlsBinding.spkiFingerprint : null, report: r.gateway.report },
      models: r.models.map((m) => ({ nonce: m.report.nonce, report: m.report })),
      // A valid signature, but made by a key that is not the enclave's.
      signature: { kind: "provider_tee", signedText, signature: crypto.sign(null, Buffer.from(signedText), privateKey).toString("hex"), signer: { signingAlgo: "ed25519", signingAddress: forgedSigner } },
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "morrow-receipt-"));
    const run = (name: string, obj: unknown) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, typeof obj === "string" ? obj : JSON.stringify(obj));
      try {
        return { code: 0, out: execFileSync("node", ["scripts/verify-receipt.mjs", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
      } catch (e) {
        const err = e as { status: number; stdout: string };
        return { code: err.status, out: err.stdout || "" };
      }
    };
    const forged = run("forged.json", base);
    expect(forged.code).toBe(1);
    expect(forged.out).toContain("PASS  Gateway TDX quote is genuine"); // the evidence itself is real...
    expect(forged.out).toContain("FAIL  Response signer does not match a verified model enclave"); // ...the signer is not
    expect(forged.out).toContain("NOT VERIFIED");

    const replayed = run("replayed.json", { ...base, gateway: { ...base.gateway, nonce: "cd".repeat(32) }, models: base.models.map((m) => ({ ...m, nonce: "cd".repeat(32) })) });
    expect(replayed.code).toBe(1);
    expect(replayed.out).toContain("FAIL  Gateway attestation failed");
    expect(replayed.out).not.toContain("PASS  Model report");

    expect(run("not-a-receipt.json", { hello: "world" }).code).toBe(2);
    expect(run("garbage.json", "{not json").code).not.toBe(0);
    expect(run("empty-evidence.json", { ...base, models: [] }).code).toBe(1);
  });
});
