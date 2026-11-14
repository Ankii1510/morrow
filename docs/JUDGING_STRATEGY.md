# Judging strategy

## What is actually known about judging

From HACKATHON.md, and nothing more: Claude Code and Codex screen every project (reproducibility check, feature verification, structured report, preliminary score); a human jury decides; a low AI score alone cannot reject a project; the README must work for a machine reader with "do X, see Y" steps and no marketing. **No rubric or weighting is published.** This strategy therefore optimises for the three things that are stated: reproducible, verifiable, clearly explained.

## Where Morrow should be strong

| Lever | Why it matters to the stated process | What Morrow does |
| --- | --- | --- |
| Reproducibility | An AI judge will clone and run it | `npm install && npm run dev`. No Docker, database server or account needed. Most of the walkthrough, and all attestation checks, work with **no API key** |
| Feature verification | An AI judge will check that claims are real | Every claim in the README maps to a test or a command: `npm test` (32), `npm run test:live` (6), `npm run verify:near`, `npm run verify:receipt` |
| Genuine NEAR use | The track leans on TEE and NEAR AI Cloud | Three TEE models, official SDK, fail-closed verification, E2EE, signature checks, receipts |
| Honesty | A judge reading the code will find any overclaim | Limits listed in README, Privacy Center and docs; "Blocked" items marked as such in the compliance matrix |
| A real product | Human jurors respond to something they would use | Complete workflow, considered interface, sensible empty/error states, mobile layout |

## Where Morrow is weak, and the mitigation

| Weakness | Mitigation |
| --- | --- |
| Tested only on four small sample documents | The founder should try two or three of their own documents before recording the demo |
| No on-chain component | Allowed (Q-011). README states it plainly rather than bolting on a token contract |
| No hosted demo | Allowed (Q-012) with a video in the X post. A hosted demo would also weaken the privacy story, since the host could read uploads |
| Built in one day | Disclosed. Scope kept tight: three file formats, one clear workflow |
| Diverges from the example prompt's "keep nothing server-side" | Explained in the README and PRIVACY_TRACK_ANALYSIS.md |

## The demo should show one complete moment

Per HACKATHON.md's guidance for the post: lead with the user problem, go from a real action to a visible result, explain NEAR's role concretely, give a next step. The 90-second script is in SUBMISSION.md. The strongest single moment: ask a question about a lease → cited answer → click the citation → highlighted passage on the page → open the verification panel → run the receipt verifier in a terminal and see `VERIFIED`.

## Priority order for the remaining time

1. Try README steps 8 to 11 yourself in the browser (10 minutes).
2. Record the demo video (20 minutes).
3. Create the public repository and push (founder approval).
4. Publish the X post (founder).
5. Submit (founder approval of the exact payload).
