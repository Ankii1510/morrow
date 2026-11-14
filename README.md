# Morrow

**Your knowledge. Your space. Your future.**

Morrow is a personal knowledge library. You add your own documents (PDF, text, Markdown), search them, and ask questions in plain language. Every answer is written only from your documents, cites the passage and page it came from, and comes with cryptographic evidence that the AI ran inside a hardware enclave on NEAR AI Cloud.

Built at NEAR HACKATHON (1 to 14 November 2026). Track: **Privacy & Private AI** (`privacy`). Repository: https://github.com/nehaiqoo-source/morrow

| | |
| --- | --- |
| ![Library](docs/screenshots/01-library.jpg) | ![A citation opened in the source document](docs/screenshots/02-citation-in-document.jpg) |
| ![A cross-document answer with citations](docs/screenshots/05-cited-answer.jpg) | ![Verification panel for that answer: seven checks and the three enclaves used](docs/screenshots/06-verified-private-inference.jpg) |
| ![Live enclave verification](docs/screenshots/03-live-enclave-verification.jpg) | ![Ask screen without a key: no fallback, no fake answer](docs/screenshots/04-ask-without-key.jpg) |

## The problem

People keep their most sensitive information in documents: leases, medical results, insurance policies, contracts, notes. AI assistants are good at answering questions about such documents, but using one normally means handing the documents to a provider and trusting a privacy policy. And when the assistant answers, you usually cannot tell which sentence came from your file and which was made up.

Morrow addresses both halves:

1. **Grounding.** Answers use only retrieved passages from your library. Each claim carries a citation that opens the original document at the exact passage and page. If your documents do not contain the answer, Morrow says so instead of guessing.
2. **Verifiable privacy.** The only place your text is sent is NEAR AI Cloud, and only after Morrow has verified, with a fresh nonce, that both the gateway and the model run in genuine Trusted Execution Environments. The question and passages are end-to-end encrypted to the enclave's attested key. The enclave signs its response, Morrow checks the signature before showing the answer, and you can download the evidence and re-verify it yourself.

## How NEAR fits in

Morrow's entire AI pipeline runs on **NEAR AI Cloud TEE-hosted models** through the official `@nearai/inference-sdk`:

| Step | Model (default) | Protection actually implemented |
| --- | --- | --- |
| Embeddings (meaning index, query) | `Qwen/Qwen3-Embedding-0.6B` | Gateway + model attestation verified first; request sent only over the TLS key bound into the gateway's TDX quote |
| Reranking | `Qwen/Qwen3-Reranker-0.6B` | Same as above |
| Answer generation | `z-ai/glm-5.3-flash` | Same, plus end-to-end encryption to the model enclave key and verification of the enclave's response signature (`provider_tee`) |

Verification is real and fail-closed: Intel TDX quote via DCAP, NVIDIA GPU evidence, nonce and signer binding, event-log replay, TLS key binding. If any check fails the request is not sent, or the response is discarded. There is no mock, no simulated success and no fallback to another provider. See [docs/ATTESTATION_DESIGN.md](docs/ATTESTATION_DESIGN.md).

Morrow does not use a smart contract or wallet: the hackathon rules state there are no mandatory integrations (HACKATHON.md Q-011), and adding a chain component would not serve the product.

## Try it: do X, see Y

Requirements: **Node.js 24.22.1 or later** (required by the NEAR AI SDK; Morrow also uses Node's built-in SQLite). No database server, no Docker.

```bash
git clone https://github.com/nehaiqoo-source/morrow.git morrow && cd morrow
npm install
cp .env.example .env.local      # then put your NEAR AI Cloud key in NEARAI_API_KEY
npm run dev                     # http://localhost:3000
```

A NEAR AI Cloud key comes from https://cloud.near.ai (or the free hackathon credits at https://nearbuilders.org/dashboard). **Steps 1 to 7 and 11 work without any key.**

| # | Do this | See this |
| --- | --- | --- |
| 1 | `npm run verify:near` | Three `PASS` lines: the chat, embedding and reranking enclaves verified with fresh nonces (TDX `UpToDate`, GPU evidence verified, TLS key bound). No key needed, no data sent. |
| 2 | Open http://localhost:3000, enter any email and a 10+ character password, **Create library** | The empty Library screen. |
| 3 | Click **Add fictional sample documents** | Four documents appear (a lease, an insurance policy, a health summary, a 3-page PDF maintenance log), each with page and word counts. With a key they move from "Indexing meaning" to "Indexed". |
| 4 | Go to **Search**, type `washing machine warranty`, press Enter | The top result is "Home Maintenance Log · Page 2" with the words highlighted. |
| 5 | Click that result | The document opens scrolled to page 2 with the exact passage highlighted. Switch to **Original PDF** to see the real file at the same page. |
| 6 | In the right rail, look at **Connected documents** | The lease and insurance policy are linked, each with the passage that explains the connection. Add a tag and tick a collection. |
| 7 | Go to **Privacy** → **Run a fresh verification** | After about 30 seconds: three green results with a new nonce, gateway and model signer, TCB status, TLS key binding and GPU evidence. The page also lists exactly what is stored and what leaves the server. |
| 8 | (key required) Go to **Ask**, type `When does my lease end and how much notice do I need to give?` | An answer with numbered citations. Under it, the cited passages and a green "Verified private inference" panel. |
| 9 | Click a citation number, then **Open in document** | The lease opens with the cited passage highlighted. |
| 10 | Expand **Verified private inference**, click **Download receipt**, then run `npm run verify:receipt -- ~/Downloads/morrow-receipt-<id>.json` | Every line `PASS` and `VERIFIED: every check passed.` The script re-checks the Intel quotes, nonce, signer and signature without contacting Morrow. |
| 11 | Ask `What is my passport number?` (key required), or with no key just open **Ask** | With a key: "Your documents do not contain enough to answer this", plus the passages that were checked. Without a key: a notice that asking is disabled. Morrow never fabricates an answer. |
| 12 | Open a document → **Delete** → **Delete permanently** | It disappears from the library, search no longer finds its text, and saved answers quoting it are removed. |

Automated checks:

```bash
npm test             # 127 offline tests: ingestion, two-user isolation on every route, storage and encryption, auth and sessions, rate limits, AI budgets, prompt injection, migrations
npm run test:live    # 10 live TEE tests against NEAR AI Cloud: fresh nonce; replay, forged signer, tampered quote, wrong TLS key and altered measurement rejected; forged receipts rejected (no key needed)
npm run test:live:ai # 10 live tests against the real model: prompt-injection attacks, usage accounting, real receipt verification (needs a key; spends a little credit)
npm run check        # typecheck + lint + tests + production build
```

## What is and is not protected

Morrow is precise about its claims. The in-app Privacy Center shows the same information live.

- **Inside a verified enclave:** embedding, reranking and answer generation.
- **On the Morrow server (not an enclave):** uploaded files, extracted text, the keyword index, stored embeddings, saved answers. Whoever runs the server can read them. Run Morrow on a machine you control; that is the design intent.
- **Not claimed:** encryption at rest (use full-disk encryption), zero retention at NEAR AI Cloud (governed by their terms; Morrow cannot audit it), correctness of answers (that is what citations are for), an independent security audit (none has been done).

Details: [docs/PRIVACY_MODEL.md](docs/PRIVACY_MODEL.md), [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md), [docs/DATA_FLOW.md](docs/DATA_FLOW.md).

## Architecture

```
Browser (React)  ──same-origin HTTPS/localhost──▶  Morrow server (Next.js route handlers, Node)
                                                   ├─ auth        scrypt passwords, hashed session tokens
                                                   ├─ ingest      type sniffing → pdf.js / UTF-8 text → page-preserving chunks
                                                   ├─ storage     SQLite (node:sqlite) + FTS5 keyword index + Float32 embeddings
                                                   ├─ retrieval   keyword (BM25) + meaning (cosine) → reciprocal rank fusion → rerank
                                                   ├─ ask         injection-hardened prompt → verified chat → citation validation
                                                   └─ near        attest (fresh nonce) → TLS-pinned / E2EE request → signature check → receipt
                                                                      │
                                                                      ▼
                                              NEAR AI Cloud gateway (TEE) → model enclaves (Intel TDX + NVIDIA)
```

- `src/lib/near/` is the only code that talks to NEAR AI Cloud. `src/lib/ingest/`, `src/lib/retrieval/`, `src/lib/ask/` are independent modules with tests.
- 22 API routes under `src/app/api/`; every data query filters on the signed-in user's id.
- Storage is one SQLite file plus the original files under `./data` (git-ignored).

Why these choices (SQLite instead of Postgres + pgvector, non-streamed answers, no chain component): [docs/DECISIONS.md](docs/DECISIONS.md).

## Hackathon disclosures (HACKATHON.md Q-001 to Q-005)

- **All code in this repository was written during the hackathon window**, on 14 November 2026. There is no pre-existing baseline.
- **Verified from a fresh clone** of the public repository on 14 November 2026: `npm install`, `npm test` (127 passed), `npm run verify:near` (3 enclaves verified, no key), production build, and steps 2 to 4 below against a server with no key.
- **AI-assisted:** the code and documentation were written with Claude Code under the founder's direction.
- **Libraries:** Next.js, React, Tailwind CSS, `@nearai/inference-sdk` (official NEAR AI SDK, which bundles `@phala/dcap-qvl` for Intel quote verification), `pdfjs-dist`, `ethers` (signature check in the receipt verifier), `lucide-react`, Geist and Newsreader fonts, Vitest. Scaffolded with `create-next-app`.
- **Sample documents** in `samples/` are fictional and were written for this project.
- This project is not related to any other submission.

## Known limitations

- Scanned PDFs without a text layer are rejected (no OCR). Word, HTML, images and audio are not supported.
- Vector search is an in-memory scan per user: appropriate for a personal library (tens of thousands of passages), not for a large multi-tenant service.
- Single-process deployment: the rate limiter and embedding queue live in memory.
- Answers are not streamed, so the model enclave signs the exact response bytes; expect 10 to 30 seconds per answer.
- Embedding and reranking requests are attested and TLS-pinned but not individually signed or end-to-end encrypted (NEAR AI Cloud offers that for chat only).
- Retrieval and answer quality have only been tried on the four small sample documents, not measured on a benchmark.
- There are no automated browser tests; the walkthrough above was run by hand. See [docs/PROGRESS.md](docs/PROGRESS.md) for what was run and when.

## Documentation

| Topic | File |
| --- | --- |
| Hackathon rules as researched | [docs/NEAR_HACKATHON_RESEARCH.md](docs/NEAR_HACKATHON_RESEARCH.md), [docs/OFFICIAL_REQUIREMENTS.md](docs/OFFICIAL_REQUIREMENTS.md) |
| Requirement → implementation → evidence | [docs/COMPLIANCE_MATRIX.md](docs/COMPLIANCE_MATRIX.md) |
| Track fit and strategy | [docs/PRIVACY_TRACK_ANALYSIS.md](docs/PRIVACY_TRACK_ANALYSIS.md), [docs/JUDGING_STRATEGY.md](docs/JUDGING_STRATEGY.md) |
| NEAR AI Cloud technical notes | [docs/NEAR_AI_TECHNICAL_RESEARCH.md](docs/NEAR_AI_TECHNICAL_RESEARCH.md), [docs/ATTESTATION_DESIGN.md](docs/ATTESTATION_DESIGN.md) |
| Security and privacy | [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md), [docs/PRIVACY_MODEL.md](docs/PRIVACY_MODEL.md), [docs/DATA_FLOW.md](docs/DATA_FLOW.md) |
| Deployment | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Phase 2 security hardening | [docs/PHASE2_SECURITY_REPORT.md](docs/PHASE2_SECURITY_REPORT.md) |
| Submission materials | [docs/SUBMISSION.md](docs/SUBMISSION.md) |
| Project log | [docs/TASKS.md](docs/TASKS.md), [docs/PROGRESS.md](docs/PROGRESS.md), [docs/DECISIONS.md](docs/DECISIONS.md), [docs/BLOCKERS.md](docs/BLOCKERS.md) |

## License

MIT. See [LICENSE](LICENSE).
