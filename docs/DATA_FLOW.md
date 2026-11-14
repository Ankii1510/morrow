# Data flow

## Components

```
[ Browser ] ⇄ [ Morrow server: Next.js on Node ] ⇄ [ NEAR AI Cloud gateway (TEE) ] ⇄ [ Model enclaves (TDX + NVIDIA) ]
                     │
                     └─ ./data  (SQLite database, original files, receipts)
```

The browser talks only to the Morrow server (same origin). It loads no third-party scripts, fonts or analytics: fonts are bundled in the build.

## By processing location

| Location | What happens there | Data present |
| --- | --- | --- |
| **Browser** | Rendering, file selection, highlighting search terms | The session cookie (HttpOnly, not readable by scripts); whatever is on screen. Nothing is kept in localStorage or IndexedDB. |
| **Application server** | Auth, file validation, PDF/text extraction, chunking, keyword search, vector search, prompt assembly, citation validation, attestation verification | Everything, in memory while processing. **Not a TEE.** |
| **Database / disk** (`MORROW_DATA_DIR`) | Storage | Email, password hash, session token hashes, original files, page text, passages, embeddings, collections, tags, saved answers with quoted passages, activity log, receipts. Not encrypted at rest by Morrow. |
| **Embedding generation** (NEAR AI Cloud TEE) | Vectors for passages and queries | Passage text with title and heading; query text |
| **Reranking** (NEAR AI Cloud TEE) | Relevance scoring | The question and up to 24 candidate passages |
| **Inference** (NEAR AI Cloud TEE, E2EE) | Writing the answer | System prompt, the question, up to 8 passages with document titles and page numbers |
| **Intel / NVIDIA attestation services** | Verifying quotes | Attestation evidence only. No user data. |

## What leaves the browser

Email and password (sign-in), uploaded files, questions and search queries, organisational edits. All go to the Morrow server only.

## What leaves the Morrow server

| Destination | Content | Condition |
| --- | --- | --- |
| `cloud-api.near.ai` `/attestation/report` | A random nonce and a model id | Always allowed; no user data |
| `cloud-api.near.ai` `/embeddings`, `/rerank` | Passage text, queries | Key configured **and** enclave verification passed; TLS pinned |
| `cloud-api.near.ai` `/chat/completions` | Question + passages, encrypted to the model enclave key | Same, plus E2EE |
| `cloud-api.near.ai` `/signature/<id>` | A completion id | After a completion |
| Intel PCS, NVIDIA NRAS | Quotes and GPU evidence | During verification |

Nothing else. No telemetry, error reporting or logging service.

## What is never sent anywhere

Original files, whole documents (only retrieved passages are sent for answering), passwords, session tokens, the activity log, other users' data.

## Logs

The server logs only the name and message of unexpected errors. It does not log request bodies, document text, questions, answers or the API key.

## Deletion

| Action | Removed |
| --- | --- |
| Delete a document | Original file; page text; passages; embeddings; keyword index entries; tag and collection links; saved answers that quote it and their receipts |
| Delete a saved answer | The question, answer, quoted passages, verification record, receipt |
| Delete account (password required) | All of the above for the user, plus the account, sessions, collections and activity log |

SQLite runs with `secure_delete` on (freed pages are overwritten) and the write-ahead log is truncated after a deletion. Out of Morrow's control: filesystem or VM snapshots and backups of the server, SSD wear-levelling remnants, and anything retained by NEAR AI Cloud under its own terms.
