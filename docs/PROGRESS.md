# Progress log

All times UTC, 2026-11-14. Times are approximate (reconstructed from command output, not from a timer).

| Time | What happened |
| --- | --- |
| 08:15 | Working directory inspected: empty. Node 25.9, Docker present, no Postgres client, no NEAR credentials in the environment. |
| 08:18 | HACKATHON.md read in full. **Deadline is today 23:59.** No mandatory integrations (Q-011). AI judges screen for reproducibility. |
| 08:22 | Privacy track prompt and NEAR AI Cloud docs read. Found the official `@nearai/inference-sdk` and TEE-hosted embedding and reranking models. |
| 08:25 | Live call: `/v1/attestation/report` returns evidence without a key. Conflict with the agent skill noted. |
| 08:28 | Probe: SDK verified gateway + model enclaves for chat, embedding and rerank models (TDX `UpToDate`, GPU evidence verified, TLS bound). Replayed nonce rejected. |
| 08:30 | Stack chosen (DECISIONS.md). Next.js 16.4 scaffold, dependencies installed. |
| 08:33 | Server core written: config, SQLite schema, auth, HTTP helpers, extraction, chunking, NEAR client, receipts, documents, retrieval, ask, connections; 22 API routes. |
| 08:33 | Offline tests: 30/32. Fixed a chunk boundary at headings and a test helper. 32/32. |
| 08:34 | Live attestation tests: 6/6 (fresh nonce, replay, forged signer, tampered quote, non-TEE model refused). |
| 08:38 | Interface written: design tokens, shell, welcome, library, viewer, ask, search, Privacy Center, settings. |
| 08:40 | Browser run: sign-up, load samples, search, open result at the highlighted passage on page 2, connected documents, live verification in the Privacy Center (3 enclaves verified in 6 to 11 s each), delete with confirmation, mobile layout. No console errors. |
| 08:44 | `verify:near` and `verify:receipt` scripts. Receipt verifier re-verified real stored evidence; rejected a forged signer and an altered nonce. |
| 08:46 | Lint clean. Production build clean (23 pages/routes). |
| 08:47 | README, LICENSE, documentation set. |
| 09:00 | Founder's first key: authenticated, but HTTP 402 (no credits). Key found in `.env.example`; moved to `.env.local`. |
| 09:30 | Second key. `verify:near`: E2EE completion PASS, `provider_tee`. Samples embedded. Hybrid search, three real answers (grounded, insufficient, cross-document), real receipt verified, tampered receipt rejected. Answer page inspected. |

## Verified results

```
npm test            32 passed, 6 skipped (live tests are opt-in)
npm run test:live    6 passed
npm run lint         no findings
npm run typecheck    no errors
npm run build        success, no warnings
npm run verify:near  3 PASS (attestation) + PASS completion, signature kind provider_tee
npm run verify:receipt (real answer)  6 PASS, VERIFIED; tampered copy: NOT VERIFIED
```

## Not verified

Answer quality beyond the four sample documents; behaviour under load; the prompt-injection defences against the live model (tested at prompt-construction level only); rate limits and security headers (no automated test); a fresh clone on another machine.
