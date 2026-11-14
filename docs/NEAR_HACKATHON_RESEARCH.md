# NEAR Hackathon research

Researched on 2026-11-14 (08:15 to 08:30 UTC) from the live official sources. Re-read `HACKATHON.md` before submitting: it says dates and rules may change.

## Sources read in full

| Source | URL | Status |
| --- | --- | --- |
| Agent instructions (authoritative) | https://nearhackathon.com/HACKATHON.md | Read in full (247 lines) |
| Starter prompts repo: README, `00-setup.md`, `SUBMITTING.md` | https://github.com/nearai/near-hackathon-prompt-examples | Read in full |
| Privacy track prompt | `tracks/03-privacy.md` in that repo | Read in full |
| NEAR AI Cloud docs index | https://docs.near.ai/llms.txt | Read; 14 relevant pages fetched (see NEAR_AI_TECHNICAL_RESEARCH.md) |
| NEAR agent skill `near-ai-cloud` | https://github.com/near/agent-skills | SKILL.md read |
| Live API | `GET /v1/models`, `GET /v1/attestation/report` on `cloud-api.near.ai` | Called directly |
| Official SDK | `@nearai/inference-sdk@0.3.0` (npm) | Installed; type definitions and docs read; executed |
| Landing page | https://nearhackathon.com/ | Fetched; a client-rendered page whose facts are restated in HACKATHON.md |

Not read in depth because they do not apply to this project: NEAR Intents, Aurora, HOT, Rhea and other partner docs; `docs.near.org` smart-contract material (Morrow has no on-chain component, see DECISIONS.md D-07).

## Key facts

| Fact | Value | Source |
| --- | --- | --- |
| Hackathon starts | 2026-11-01T00:00Z | HACKATHON.md Facts |
| Development ends = submission deadline | **2026-11-14T23:59Z** | HACKATHON.md Facts |
| Judging | 16 to 18 Nov 2026, results by 2026-11-18T23:59Z | HACKATHON.md Facts |
| Registration | None. The final submission is the only registration | Start here #1 |
| Submissions | One per project; one person may submit at most 2 independent, disclosed projects | Q-015 |
| Submission channel | `POST https://nearhackathon.com/api/applications` or the form at `/#apply` | Procedure 3 |
| Editing | Not possible. Corrections go through https://nearhackathon.com/request-changes | Procedure 4 |
| Prizes | $250,000 pool: $55k grand prize; $10k / $3k / $2k in each of 13 tracks; paid in NEAR within 30 days | Prizes, Q-016 |
| Judges | Claude Code and Codex screen every project (reproducibility, feature verification, report, preliminary score). Humans decide | Q-017 |

## Eligibility and originality rules

- Code written from the announcement on 2026-10-19 through 2026-11-14 counts. Earlier commits are baseline (Q-001).
- A new repository is not required, but old work must be separated (Q-003, Q-004). Morrow is entirely new, so this is moot.
- Libraries, templates, boilerplate and AI-written code are all allowed and must be listed in the README (Q-005).
- **There are no mandatory integrations.** "Hints are hints" (Q-011). The track's "lean on" list and example prompt are wishes, not requirements.
- Testnet-only and local-only projects are eligible. A local-only demo needs a public repo, a reproducible README and an X post **with a video** (Q-010, Q-012).
- Any license; add a LICENSE file; the repo stays public through judging (Q-014).

## What is submitted (decided by the human, never invented)

Project name, team lead name, contact email, team size (`1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+`), tracks, mainnet NEAR account for payout, public repository URL, public X demo post URL, a 20 to 2000 character description, and consent to the contact notice read verbatim.

## Actions that require the human's explicit confirmation

Sending the submission; posting on X; making the repository public, pushing or force-pushing; signing transactions or spending tokens; committing secrets (never).

## Conflicts between sources

| Topic | Source A | Source B | Resolution |
| --- | --- | --- | --- |
| Does `/v1/attestation/report` need an API key? | `near-ai-cloud` agent skill v1.1.0: "now requires an API key" | Live docs (gateway-attestation, model-attestations, API reference): "No API key is needed", and the live endpoint returned 200 without one | Followed the live docs and observed behaviour. Morrow sends the key when it has one and works without it. |
| Example model ids | Agent skill: `deepseek-ai/DeepSeek-V3.1`; quickstart: `zai-org/GLM-5.1-FP8` | SDK docs and live `/v1/models`: `z-ai/glm-5.3-flash` | Used the id present in the live catalogue. |
| "Keep nothing server-side after a response returns" | Privacy track example prompt | HACKATHON.md: the prompt "is a starting point, not a requirement" | Not a rule. Morrow is a library and stores data on the user's own server by design; see PRIVACY_TRACK_ANALYSIS.md. |

## Judging criteria

HACKATHON.md publishes **no scoring rubric or weights**. What it does state: AI judges check reproducibility and verify features and produce a preliminary score; a human jury decides; the README must say what the product is, the problem it solves and how to try it as "do X, see Y" steps, with no marketing. JUDGING_STRATEGY.md is built on those stated facts only.
