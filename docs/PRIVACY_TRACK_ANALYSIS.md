# Privacy & Private AI: track analysis

## The track, verbatim

> Explore confidential computation, private finance and AI that protects sensitive data. Build intelligence without exposure.
> Lean on: Private AI, TEE, NEAR AI Cloud.

## Does Morrow genuinely fit?

Yes, on the track's own terms.

- **Sensitive data is the whole point of the product.** A personal knowledge library holds leases, medical results, insurance policies, contracts and private notes. The value of the product (ask anything about your own papers) and the risk (handing those papers to an AI provider) are the same thing.
- **"Intelligence without exposure" is implemented, not asserted.** Embedding, reranking and answering all run in NEAR AI Cloud enclaves that Morrow verifies before sending anything. Chat content is additionally encrypted to the enclave's attested key, so even the gateway relays ciphertext.
- **The user can check the claim.** The Privacy Center runs a live verification on demand; each answer has a downloadable receipt and an independent verifier script.

## Why existing products do not fully solve this

| Product | Strength | Gap Morrow addresses |
| --- | --- | --- |
| NotebookLM | Excellent grounded answers with citations | Documents and questions are processed on the provider's ordinary infrastructure; privacy rests on policy, with nothing the user can verify |
| Obsidian (with AI plugins) | Local-first notes, strong linking | No built-in grounded QA; AI plugins send text to whichever API the user configures, unverifiably |
| Mem | Automatic organisation | Cloud-hosted; same trust-the-provider model |
| AnythingLLM / local LLM stacks | Can be fully local | Needs capable local hardware; small local models answer worse; no proof to a third party of how inference ran |

Morrow's position: the retrieval quality and model capability of a cloud service, with privacy that is checked cryptographically rather than promised, and an interface built around verifying sources.

## What NEAR contributes

Without NEAR AI Cloud, Morrow would have to choose between a local model (weaker, hardware-bound) or a conventional API (no verifiable privacy). NEAR AI Cloud provides, and Morrow uses:

1. TEE-hosted chat, embedding **and** reranking models, so no step of the pipeline needs a non-confidential provider.
2. Attestation reports with client-nonce freshness, verifiable against Intel and NVIDIA roots of trust.
3. A gateway that itself runs in a TEE and binds its TLS key into its quote.
4. End-to-end encryption of chat fields to the model enclave's key.
5. Response signatures from a key that exists only inside the enclave.

## What makes Morrow original

- **A fully attested RAG pipeline**, not only attested chat. Most private-AI demos verify the final completion and send embeddings elsewhere; here indexing and retrieval go through verified enclaves too.
- **Receipts.** Evidence is stored per answer and can be re-verified offline from Morrow by a standalone script, including negative cases (forged signer, wrong nonce).
- **Honest degradation.** With no key, Morrow still works as a local keyword library and says exactly what is switched off. It has no fallback provider and cannot fabricate an answer or a badge.
- **A Privacy Center that states its limits**, including that the Morrow server is not an enclave.
- **Citation integrity.** Model citations are validated against the passages actually supplied; invented markers are removed and uncited answers are labelled.

## Deliberate divergence from the example prompt

The example prompt asks to "keep nothing server-side after a response returns". That suits a one-shot auditor. It contradicts a knowledge library, whose purpose is to keep and connect documents over time. HACKATHON.md states the prompt is "a starting point, not a requirement".

Morrow's answer to the same concern is different: the server is meant to be the **user's own machine**, storage is a local folder, every stored item is listed in the Privacy Center, and deletion is real (rows removed, freed pages overwritten, files unlinked, dependent answers removed). The limits are stated in the product and the README.

## Other tracks considered

| Track | Fit? | Reasoning |
| --- | --- | --- |
| `security` (AI Security & Defense) | No | That track is about giving agents money safely (spending limits, policy engines, function-call keys). Morrow uses TEE attestation but has no agent, wallet or policy engine. |
| `open` (Open Innovation) | No | For ideas that do not fit a category. Morrow fits `privacy` squarely; adding `open` would only be for exposure. |
| All others | No | They require Intents, DeFi, payments, games, NFTs or DAOs. |

**Recommendation: submit to `privacy` only.**
