# Official requirements, classified

Each item is tagged with how binding it is. Source references are to https://nearhackathon.com/HACKATHON.md unless noted.

## 1. Mandatory hackathon rules

| ID | Requirement | Source |
| --- | --- | --- |
| M-01 | Repository is public by 2026-11-14T23:59Z and stays public through judging | Start here #2, Q-014 |
| M-02 | README states what the product is, the problem, and "do X, see Y" steps; written for a machine and a human; no marketing | Procedure 1 |
| M-03 | A public X post by the human: says it was built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon, has a demo video or screenshots (a video is required when judges cannot open a hosted demo, Q-012) | Start here #3, Procedure 2 |
| M-04 | Exactly one submission per project, via the API or form, inside the window, with every field valid | Procedure 3, Submission API |
| M-05 | Human confirms the exact payload before it is sent; never resubmit; fix mistakes via request-changes | "Never without…" |
| M-06 | Submission values come from the human; none invented | "What the human decides" |
| M-07 | Work judged must be created in the window (from 2026-10-19); pre-existing code separated and disclosed | Q-001 to Q-004 |
| M-08 | Libraries, templates and AI-written code listed in the README | Q-005 |
| M-09 | LICENSE file present | Q-014 |
| M-10 | No secrets in the repository or its history | "Never without…", SUBMITTING.md |
| M-11 | If one person submits two projects, each README names the other | Q-015 |
| M-12 | Prize payout account is a mainnet NEAR account created by the team | "What the human decides" |

## 2. Track-specific expectations (Privacy & Private AI)

The track table says: "Explore confidential computation, private finance and AI that protects sensitive data. Build intelligence without exposure." Hints: PRIVATE AI, TEE, NEAR AI CLOUD. These are explicitly "hints and wishes, not requirements" (Tracks section, Q-011).

| ID | Expectation | Binding? |
| --- | --- | --- |
| T-01 | The project genuinely fits the track it selects | Yes: "every track the project fits" |
| T-02 | AI that protects sensitive data; intelligence without exposure | Track definition |
| T-03 | Lean on Private AI, TEE, NEAR AI Cloud and name what you used in the README | Hint |

## 3. Recommended integrations (from the example prompt; not requirements)

| ID | Recommendation | Source |
| --- | --- | --- |
| R-01 | Call NEAR AI Cloud through its OpenAI-compatible API, base URL `https://cloud-api.near.ai/v1`, key in `.env` | tracks/03-privacy.md |
| R-02 | Choose a TEE-hosted model from the models endpoint | same |
| R-03 | Fetch the attestation report with a fresh random nonce and verify it as the verification docs describe | same |
| R-04 | Show a "Verified" panel listing what was checked | same |
| R-05 | Ship fictional sample documents so judges can run it without real data | same |
| R-06 | Start with a minimal script that sends one completion and verifies attestation | same |
| R-07 | "Keep nothing server-side after a response returns" | same; deliberately not followed, see PRIVACY_TRACK_ANALYSIS.md |
| R-08 | Use the `near-ai-cloud` agent skill | same; read as reference, superseded by the official SDK |
| R-09 | Hosted demo kept up until 2026-11-18, ideally 2026-11-25 ("a plus") | Q-012 |

## 4. Optional improvements

Tagging @NearLegion and @NearBuilders in the post; OHTTP transport; image-provenance policy on enclave measurements; strict `UpToDate`-only TCB policy.

## 5. Morrow's own product features (not hackathon requirements)

Library, collections, tags, page-preserving viewer, hybrid retrieval, grounded answers with validated citations, connected documents, Privacy Center, data export, account deletion, verification receipts and the independent receipt verifier.
