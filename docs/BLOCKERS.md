# Blockers

## B-00 and B-01: NEAR AI Cloud key (resolved 2026-11-14 ~09:35 UTC)

The first key authenticated but returned `HTTP 402 no_limit_configured` on every billable call. After the founder swapped in a
key with a balance, everything that had been untested was run for real against NEAR AI Cloud:

- `npm run verify:near`: end-to-end encrypted completion, `provider_tee` signature verified.
- The four sample documents were embedded in a TEE and became "Indexed".
- Hybrid search returned the right passage for a paraphrase sharing no keywords with it.
- Three questions through `/api/ask`: a grounded cited answer, an "insufficient evidence" outcome for a fact not in the library,
  and a cross-document answer citing two documents. Each was reranked and carried 7 passed checks.
- A real answer's receipt was downloaded and passed `verify:receipt` (6/6 PASS, `VERIFIED`); it contained none of the content;
  a copy with one altered character in the signed text failed.

Operational note: a key placed in `.env.example` was moved to the git-ignored `.env.local` before anything was committed.
If a key is ever committed, revoke it in the dashboard; deleting the file is not enough.

## B-02: Founder-only actions (open)

Public repository, X post with video, mainnet NEAR payout account, submission values and consent, final payload approval. See SUBMISSION.md. None can or should be done by the build agent without explicit approval.

## B-03: NEAR AI retention terms not verified (accepted)

The legal documents were located but not reviewed in full, and no explicit retention period for API prompts was found. Morrow therefore makes no retention claim. Not a blocker for submission.
