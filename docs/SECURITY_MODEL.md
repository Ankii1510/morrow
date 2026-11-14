# Security model

> Phase 2 (2026-11-14) changed several controls described here: storage layout and optional encryption, persistent rate limits, lockout, quotas, password reset, sessions and CSP. [PHASE2_SECURITY_REPORT.md](PHASE2_SECURITY_REPORT.md) is the current reference where the two differ.

No independent security audit has been performed. This document describes what is implemented and tested, and what is not.

## Assets

The user's documents and derived text; questions and answers; credentials and sessions; the NEAR AI API key; the integrity of citations and of verification results.

## Trust boundaries

| Party | Trusted for | Not trusted for |
| --- | --- | --- |
| The Morrow server and whoever operates it | Everything: it sees plaintext | n/a. This is why Morrow is designed to be self-hosted |
| The browser | Displaying data for the signed-in user | Supplying file types, ids or ownership |
| Uploaded documents | Nothing. Always untrusted input | Instructions, file-type claims, sizes |
| NEAR AI Cloud gateway and models | Only what attestation and signatures establish | Anything unverified; retention |
| The language model's output | Text to display | Citations (validated), markup (never rendered as HTML) |

## Controls

| Area | Control | Where | Tested by |
| --- | --- | --- | --- |
| Passwords | scrypt (N=16384, r=8, p=1), per-user salt, constant-time compare, minimum 10 characters | `src/lib/auth.ts` | `api.test.ts` "stores only a hash" |
| Sessions | 256-bit random token; only its SHA-256 is stored; HttpOnly, SameSite=Lax, Secure over HTTPS; 14-day expiry; deleted on logout | `auth.ts` | same; "ends the session on logout" |
| Login enumeration | Same error and a dummy hash for unknown emails | `auth.ts` | "rejects … wrong credentials" |
| CSRF | SameSite=Lax plus an Origin check on every non-GET route | `http.ts` `assertSameOrigin` | "rejects cross-site state-changing requests" |
| Authorisation | Every route calls `requireUser`; every query filters on `user_id`; one ownership helper (`getOwnedDocument`) returns 404 for another user's id | all routes, `documents.ts` | "never exposes another user's documents" (GET, pages, file, related, PATCH, DELETE) |
| Retrieval isolation | Keyword and vector search filter by `user_id` on the base table; scopes resolve only to the caller's documents; collections attachable only by their owner | `retrieval/search.ts` | "never returns another user's passages … even when scoped to their document ids"; collection tests |
| Upload validation | Extension allow-list **and** content sniffing (PDF magic bytes, NUL-byte check, strict UTF-8); browser MIME type ignored; size limit checked before and after buffering; page and text limits; SHA-256 duplicate detection; nothing is stored unless parsing succeeds | `ingest/extract.ts`, `documents.ts` | `ingest.test.ts` rejects corrupt, mislabelled, empty, binary, non-UTF-8, `.exe`, `.html`; `api.test.ts` rejects duplicate, oversized |
| Safe parsing | PDFs parsed for text only with pdf.js: no rendering, no embedded script execution, no XFA, no remote fetches. Stored under a server-generated UUID, never the user's filename | `ingest/extract.ts` | "sanitises hostile filenames" |
| Serving files | Originals require ownership; `nosniff`; PDFs inline, text files as `text/plain` attachments with a sandbox CSP so uploads can never run as HTML in the app's origin | `api/documents/[id]/file` | "serves the original file …" |
| Prompt injection | See below | `ask/prompt.ts` | `prompt.test.ts` |
| Citation integrity | Markers must reference a supplied passage; others are stripped and counted; uncited answers are labelled | `ask/prompt.ts`, `ask/answer.ts` | "keeps valid citations and removes invented ones" |
| Output rendering | Model and document text is rendered through React text nodes only; no `dangerouslySetInnerHTML` anywhere | `components/answer.tsx` | Code inspection: `grep -r dangerouslySetInnerHTML src` is empty |
| FTS injection | Queries rebuilt from quoted alphanumeric terms | `retrieval/search.ts` `ftsQuery` | "cannot inject query syntax" |
| SQL injection | Prepared statements with bound parameters throughout | all `db().prepare` calls | Code inspection |
| Rate limiting | Per-IP for auth; per-user for upload, search, ask, verification, samples | `http.ts` `rateLimit` | Not covered by an automated test |
| Secrets | API key from the environment only; never sent to the browser, logged or stored; `.env*` git-ignored | `config.ts` | `/api/me` returns only `configured: boolean` |
| Headers | `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, restrictive `Permissions-Policy`, no `X-Powered-By` | `next.config.ts` | Not covered by an automated test |
| Logging | Error name and message only; never bodies or content | `http.ts` | Code inspection |
| Deletion | Cascading deletes, FTS cleanup, file unlink, `secure_delete`, WAL truncation | `documents.ts` | "removes the file, pages, passages and search index entries"; account deletion test |
| Attestation | Fail-closed policy | ATTESTATION_DESIGN.md | `attestation.live.test.ts` (6 tests) |

## Prompt injection

Uploaded text is treated as hostile. Layers:

1. **Placement.** Passages appear only inside `<source>` blocks in the user turn. The system prompt states that source text is data and must never be followed.
2. **Defusing.** Before insertion, any text that could close or forge a `<source>` block or imitate a role marker (`</source>`, `<system>`, `<|…|>`) is neutralised, in passages, titles, headings and the question.
3. **No capabilities.** The model has no tools, no browsing, no memory and no access to anything beyond the passages in the request. A successful injection can change the wording of one answer; it cannot read other documents, other users' data or take any action.
4. **Output validation.** Citations are checked against the supplied passages, and the answer is rendered as plain text.
5. **Scope.** Retrieval is limited to the asking user's documents before the prompt is built.

Residual risk: a malicious document the user uploads can still bias or distort an answer that cites it. The citation shows which document a statement came from, which is the user's means of detecting this. This has been tested at the prompt-construction level only, not against the live model.

## Known gaps

- No independent audit or penetration test.
- No encryption at rest.
- No multi-factor authentication, password reset or email verification.
- No Content-Security-Policy header for the app's own pages.
- Rate limiting and the job queue are in-process; not suitable for multi-instance hosting.
- Enclave measurements are not pinned to audited source builds.
- Dependencies were not reviewed beyond `npm install` reporting.
