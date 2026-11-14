# NEAR AI Cloud: technical research

Verified on 2026-11-14 against the live documentation, the live API and the published SDK. Items marked **(observed)** were confirmed by running code, not only by reading.

## API basics

| Item | Value | How verified |
| --- | --- | --- |
| Base URL | `https://cloud-api.near.ai/v1` | Quickstart; SDK constant `DEFAULT_NEAR_AI_CLOUD_BASE_URL`; **(observed)** |
| Auth | `Authorization: Bearer <key>`; key from cloud.near.ai, or a separate $10 key from nearbuilders.org/dashboard | Quickstart; HACKATHON.md Q-000 |
| Format | OpenAI-compatible: `/chat/completions`, `/embeddings`, `/models`; plus `/rerank`, `/privacy/classify`, `/privacy/redact`, `/audio/transcriptions`, `/images/generations` | specialized-endpoints guide |
| Model list | `GET /v1/models`, public, 64 models on 2026-11-14 | **(observed)** |
| Attestation | `GET /v1/attestation/report?nonce=<64 hex>&signing_algo=ecdsa|ed25519[&model=<id>&provider=near]`, public | Docs; **(observed)** HTTP 200 without a key |
| Signature | `GET /v1/signature/<completion id>?signing_algo=…` (key required) | response-signatures doc |
| Request id | `X-Request-Id` response header, opaque | Quickstart |

## Privacy tiers (docs: cloud/models)

- **Confidential TEE**: NEAR-operated GPUs in TEEs; attestation, signatures and verification supported. In `/v1/models` these have `owned_by: "nearai"`.
- **3P Confidential TEE** (`owned_by: "attested 3p"`): a third party's enclave with its own evidence format.
- **Incognito** (OpenAI, Anthropic, Google and others): only the gateway is in a TEE; the model runs outside. TEE guarantees do not extend to the provider.

Morrow uses only the first tier and enforces it in code: `assertPolicy` in `src/lib/near/client.ts` rejects any model that returns no NEAR model attestation. **(observed)** `openai/gpt-5-nano` is refused.

## Models chosen

| Role | Model | Notes |
| --- | --- | --- |
| Chat | `z-ai/glm-5.3-flash` | nearai; 1,048,576 context; reasoning model; $0.08 / $0.50 per million tokens; the model used in the SDK's own E2EE example |
| Embeddings | `Qwen/Qwen3-Embedding-0.6B` | nearai; instruction-aware (queries get an `Instruct:` prefix, passages do not) |
| Reranking | `Qwen/Qwen3-Reranker-0.6B` | nearai; `POST /v1/rerank` returns `results[].relevance_score` |

All three overridable by environment variable.

## Official SDK: `@nearai/inference-sdk` 0.3.0

- Requires Node.js 24.22.1+. Entry points: `@nearai/inference-sdk/node` (captures and pins the TLS peer key) and `@nearai/inference-sdk` (browser; cannot see the TLS peer, so no TLS binding).
- `new InferenceClient({ baseUrl, apiKey, e2ee: true })`
  - `client.verify(model)` verifies the gateway and every model attestation candidate and returns the evidence. **(observed)** 7 to 12 s per model; works without a key.
  - `client.chat.completions.create(...)` sends a verified, optionally E2EE completion.
  - `client.verifyResponse(id)` fetches and verifies the response signature against the bytes the client captured.
- Standalone functions used by Morrow's receipt verifier: `verifyGatewayAttestation`, `verifyModelAttestation`, `createPinnedTlsFetch`.
- Default TCB policy accepts `UpToDate` and `OutOfDate`; a strict policy can be supplied. **(observed)** all enclaves reported `UpToDate`.
- Attestation results are cached (default 60 min; Morrow sets 10). Response records expire after 60 minutes, so verification must happen promptly; Morrow verifies immediately.

## What verification actually checks (docs: verification/*)

For the gateway and for each model report:

1. Intel TDX quote verified with a DCAP verifier (`@phala/dcap-qvl`) against Intel collateral; TCB status and advisories evaluated; debug mode rejected.
2. `report_data` read from the verified quote must bind the **client-generated nonce** and the **signing address**.
3. The dstack event log is replayed and must equal RTMR3 in the quote.
4. SHA-256 of the raw `app_compose` must match MRCONFIGID.
5. Gateway only: the TLS public-key fingerprint observed on the connection must be the one bound in the quote.
6. Model only: NVIDIA GPU evidence verified through NRAS when present.

After a completion: `signature_kind` is `provider_tee` (text `<model>:<request sha256>:<response sha256>`, signer must match exactly one verified model report) or `gateway` (text `<request sha256>:<response sha256>`, signer must match the verified gateway).

## Limits the documentation itself states (and Morrow repeats to users)

- A report fetched after a completion cannot replace preflight evidence.
- Instances of one model share a signing key; a matching signer does not identify the serving instance.
- A gateway signature does not prove model TEE execution. Streamed completions are gateway-signed by default, which is why Morrow does **not** stream.
- Preflight evidence plus one signature is not yet a complete model-to-gateway-to-response chain.
- Attestation says nothing about answer quality or a compromised client.
- E2EE covers Chat Completions only. Embeddings and rerank have no documented per-response signature or E2EE.

## Data handling and retention

- Docs (private-inference): prompts, weights and outputs are isolated in hardware; "Infrastructure providers, model providers, and NEAR cannot access your data".
- NEAR AI's marketing describes "provable zero data retention".
- **Not confirmed:** a retention clause for API prompts in the Terms of Service, Privacy Policy or DPA. A web search on 2026-11-14 surfaced those documents but no explicit retention period, and the full legal texts were not reviewed.
- Consequence: Morrow makes **no zero-retention promise**. The Privacy Center says retention is governed by NEAR AI's terms and links to them.

## Not used, and why

- **Direct completions** (`{slug}.completions.near.ai`): documented as experimental with known verification gaps.
- **OHTTP**: optional metadata protection; adds a moving part that could not be tested without a key.
- **Image provenance policy**: valuable hardening (pin enclave images to source builds); out of scope for today.
- **`near-ai-cloud` agent skill**: read; its manual flow is superseded by the SDK and one of its statements is outdated (see NEAR_HACKATHON_RESEARCH.md, conflicts).
