# Tasks

Status as of 2026-11-14 ~09:00 UTC.

## Done

- [x] Read HACKATHON.md, starter prompts, privacy track prompt, NEAR AI Cloud docs, SDK source types
- [x] Research documents and compliance matrix
- [x] Architecture, schema, API structure, security boundaries
- [x] Technical proof: extraction, chunking, keyword retrieval, real attestation verification
- [x] Authentication, sessions, per-user isolation
- [x] Upload, validation, duplicate detection, PDF/TXT/Markdown extraction with page preservation
- [x] Hybrid retrieval pipeline (keyword, meaning and rerank all run for real)
- [x] Ask pipeline: injection-hardened prompt, verified E2EE chat, citation validation, receipts (run end to end with a real key)
- [x] Library, collections, tags, filters, document viewer with passage highlighting and original PDF view
- [x] Connected documents (meaning-based with keyword fallback)
- [x] Privacy Center with live enclave verification and storage inventory
- [x] Settings, data export, account deletion
- [x] Empty, loading, error and success states; mobile layout; keyboard focus, skip link, dialogs
- [x] Tests: 32 offline, 6 live; typecheck; lint; production build
- [x] `verify:near` and `verify:receipt` scripts
- [x] README, LICENSE, deployment guide, submission kit, screenshots

## Needs the founder

- [x] Provide a NEAR AI Cloud key; answer path run end to end
- [x] Record the demo video
- [x] Approve: commit, create public repo, push
- [x] Publish the X post
- [x] Provide submission values, approve the payload, submit (done 2026-11-14 15:29 UTC, HTTP 201)

## Next, after the hackathon

- [ ] Automated browser tests (Playwright) for the main workflow
- [ ] Encryption at rest with a user-held key
- [ ] OCR for scanned PDFs; DOCX support
- [ ] Image-provenance policy: pin enclave measurements to audited builds
- [ ] OHTTP transport to hide request metadata
- [ ] Contradiction detection across documents as a first-class view
- [ ] Content-Security-Policy for app pages; password reset; MFA
- [ ] Streaming answers with gateway-signature verification as an opt-in
