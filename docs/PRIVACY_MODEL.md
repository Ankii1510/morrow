# Privacy model

The in-app Privacy Center presents this to users with live data. This document is the reference.

## Principles

1. Say only what the code does. Every claim below maps to an implementation.
2. Distinguish clearly between what runs in a verified enclave and what runs on the Morrow server.
3. Never fabricate a verification result, and never fall back to an unverified provider.
4. State the limits as prominently as the protections.

## What is stored, and where

Everything is stored under `MORROW_DATA_DIR` (default `./data`) on the machine running Morrow:

| Data | Form |
| --- | --- |
| Account | Email; scrypt password hash; SHA-256 of session tokens |
| Documents | Original bytes (`files/<uuid>`); extracted text per page; passages with page and character offsets; metadata from the file (title, author when present) |
| Indexes | SQLite FTS5 keyword index; one embedding vector per passage; one centroid per document |
| Organisation | Collection names, tags |
| Saved answers | Question, answer, the quoted passages, verification summary; a receipt file with attestation evidence |
| Activity log | Short descriptions such as `Added "Lease" (1 page, 9 passages)`. Never document text or questions |

Morrow does not store: the NEAR AI API key (environment only), plaintext passwords, raw session tokens, request logs, analytics.

## What leaves the browser, and which services process it

See DATA_FLOW.md. In short: the browser talks only to the Morrow server; the Morrow server talks only to NEAR AI Cloud (and to Intel and NVIDIA for attestation evidence, with no user data).

## Protections actually implemented

| Protection | Applies to | Evidence |
| --- | --- | --- |
| Enclave verified before any data is sent (TDX quote, fresh nonce, signer binding, event log, config hash, GPU evidence) | Embeddings, reranking, answers | `npm run verify:near`; Privacy Center; live tests |
| TLS key pinned to the attested gateway | Embeddings, reranking, answers | Same |
| End-to-end encryption to the model enclave key | Answers | Implemented through the SDK; not yet run by the build agent |
| Response signed in the enclave and verified before display | Answers | Same |
| Only retrieved passages are sent, never whole libraries | Answers | `ask/answer.ts` (max 8 passages) |
| Only TEE-hosted models accepted | All AI steps | `assertPolicy`; live test |
| Per-user isolation | All stored data | `api.test.ts` |
| Real deletion with overwrite of freed database pages | All stored data | `api.test.ts` |
| Data export | All stored data | `/api/export`; test |

## What is not protected

- **The Morrow server is not an enclave.** Its operator can read the library. Self-host it.
- **No encryption at rest** by Morrow.
- **Browser to server transport** depends on deployment: loopback on localhost, HTTPS needed elsewhere.
- **Metadata visible to NEAR AI Cloud:** API key identity, timing, request sizes, model ids. Embedding and rerank requests are plaintext inside the attested TLS session (decrypted in the gateway enclave), not end-to-end encrypted to the model.
- **Provider retention.** NEAR AI's documentation says enclave isolation prevents NEAR and infrastructure providers from accessing prompts and outputs, and its marketing claims zero retention. Morrow has not found or verified a contractual retention clause and **makes no zero-retention promise**. Users are pointed to NEAR AI's terms.
- **Answer correctness** is not established by attestation.
- **Backups and snapshots** made outside Morrow are not affected by in-app deletion.

## User controls

Delete a document, a saved answer, or the whole account; export everything as JSON; download any original file; run enclave verification on demand; download and independently verify each answer's receipt; choose the scope a question may draw on.
