# Compliance matrix

Status is one of: **Done** (implemented and evidenced), **Founder** (requires the founder's action or approval), **Blocked** (cannot be completed by the build agent; see BLOCKERS.md), **Not followed** (a deliberate, documented choice). Nothing is marked Done without evidence that was actually produced on 2026-11-14.

IDs refer to OFFICIAL_REQUIREMENTS.md.

## Mandatory rules

| ID | Requirement | Implementation | Evidence | Test | Status |
| --- | --- | --- | --- | --- | --- |
| M-01 | Public repo by deadline | Public at https://github.com/nehaiqoo-source/morrow since 2026-11-14 | `gh repo view` reports PUBLIC; fresh clone tested | Fresh clone: install, 127 tests, build, no-key walkthrough | Done |
| M-02 | README: product, problem, do X see Y | `README.md` sections "The problem", "Try it: do X, see Y" (12 steps) | README.md | Steps 1 to 7 and 12 executed in a browser; steps 8 to 11 executed through the same API and the answer page inspected, 2026-11-14 | Done |
| M-03 | X demo post with video | Draft text and a shot-by-shot demo script in `docs/SUBMISSION.md` | SUBMISSION.md | n/a | **Founder** |
| M-04 | One valid submission in the window | Field checklist and validation rules in `docs/SUBMISSION.md`; no payload generated | SUBMISSION.md | n/a | **Founder** |
| M-05 | Human confirms payload | Nothing has been sent or prepared with invented values | n/a | n/a | **Founder** |
| M-06 | No invented submission values | No name, email, wallet or team size appears anywhere in the repo | `grep -ri "\.near" docs/` shows only examples from the rules | n/a | Done |
| M-07 | Built in the window | Every file created 2026-11-14 | File timestamps; first commit date once committed | n/a | Done |
| M-08 | Libraries and AI use disclosed | README "Hackathon disclosures" | README.md | n/a | Done |
| M-09 | LICENSE | MIT | `LICENSE` | n/a | Done |
| M-10 | No secrets | Key read from env only; `.env*` git-ignored except `.env.example`; `/data` ignored | `.gitignore`, `src/lib/config.ts` | `git grep -nE "sk-|Bearer [A-Za-z0-9]{20}"` returns nothing | Done |
| M-11 | Second project disclosure | README states no related submission | README.md | n/a | Done (founder to correct if untrue) |
| M-12 | Mainnet payout account | Not created or guessed | n/a | n/a | **Founder** |

## Track fit and recommended integrations

| ID | Item | Implementation | Evidence | Test | Status |
| --- | --- | --- | --- | --- | --- |
| T-01/T-02 | Fits Privacy & Private AI | Sensitive personal documents; all AI steps in verified TEEs | PRIVACY_TRACK_ANALYSIS.md | n/a | Done |
| T-03 | Names what it leans on | README "How NEAR fits in" | README.md | n/a | Done |
| R-01 | NEAR AI Cloud OpenAI-compatible API, key in env | `src/lib/near/client.ts`; `.env.example` | Source | Embeddings, rerank and chat all called successfully with a key | Done |
| R-02 | TEE-hosted models | Defaults are `owned_by: nearai` models; policy rejects models without model TEE evidence (`assertPolicy`) | `/v1/models` snapshot; source | `tests/attestation.live.test.ts` "fails closed for a model with no TEE evidence": pass | Done |
| R-03 | Fresh nonce + verification per docs | Official SDK: DCAP quote check, nonce + signer binding, RTMR3 replay, MRCONFIGID, GPU evidence, TLS SPKI binding | `npm run verify:near` output: 3 PASS | Live tests: fresh nonce differs per run; replayed nonce, forged signer and tampered quote rejected: 6/6 pass | Done |
| R-03b | Response signature verified | `chat()` calls `verifyResponse` and discards the answer on failure | `verify:near` output: `signature kind provider_tee` | Three real answers, each `provider_tee` | Done |
| R-04 | "Verified" panel listing checks | Answer verification panel (`src/components/answer.tsx`); Privacy Center live verification | Screenshot 03 (Privacy Center, real data) | Privacy Center exercised in browser | Done (answer panel showed 7 checks and 3 enclaves for a real answer) |
| R-05 | Fictional samples | `samples/` (3 text files + generated PDF); one-click load | Screenshot 01 | `tests/ingest.test.ts`, browser run | Done |
| R-06 | Minimal script | `scripts/verify-near.mjs` | Output recorded in PROGRESS.md | Run with a key: 3 attestation PASS + completion PASS | Done |
| R-07 | Keep nothing server-side | Morrow stores the library on the user's own server | PRIVACY_TRACK_ANALYSIS.md "Deliberate divergence" | n/a | **Not followed** (documented) |
| R-09 | Hosted demo | None | n/a | n/a | Not done; local demo + video is allowed (Q-012) |

## Definition of done (product workflow)

| # | Step | Evidence | Status |
| --- | --- | --- | --- |
| 1 | User opens Morrow | Browser run; welcome and sign-up | Done |
| 2 | Uploads a document | `tests/api.test.ts` "uploads, extracts and indexes"; samples loaded in browser | Done |
| 3 | Document processes | Same; page and passage counts shown | Done (all four samples reached "Indexed") |
| 4 | Content searchable | Search screenshot; test "finds content by keyword with page numbers" | Done (keyword and hybrid) |
| 5 | User asks a question | Three real questions answered | Done |
| 6 | Relevant evidence retrieved | Hybrid retrieval + rerank on real questions | Done |
| 7 | Grounded answer generated | Grounded, insufficient-evidence and cross-document outcomes observed; unit tests | Done |
| 8 | User opens a citation | Same deep link as search results, exercised in browser | Done |
| 9 | Verifies original document and page | Viewer highlight on page 2; Original PDF tab | Done |
| 10 | Manage or delete | Tags, collections, delete exercised; deletion test | Done |
| 11 | Privacy Center accurate | Live inventory test; page reviewed | Done |
| 12 | TEE verification independently verifiable | `scripts/verify-receipt.mjs` re-verified real stored evidence and rejected a forged signer and a wrong nonce | Done (a real answer's receipt verified; tampered copy rejected) |
