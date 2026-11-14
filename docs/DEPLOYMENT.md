# Deployment

Morrow is designed to run on a machine its user controls. That is the configuration its privacy model assumes.

## Requirements

- Node.js **24.22.1 or later** (NEAR AI SDK requirement; also provides `node:sqlite`)
- Outbound HTTPS to `cloud-api.near.ai`, Intel's provisioning certification service and NVIDIA's attestation service
- A writable data directory

No database server. The schema is created automatically on first start; there are no migrations to run for a fresh install.

## Environment

Copy `.env.example` to `.env.local`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEARAI_API_KEY` | none | NEAR AI Cloud key. Without it, Ask and meaning search are disabled |
| `NEARAI_BASE_URL` | `https://cloud-api.near.ai/v1` | Gateway |
| `NEARAI_CHAT_MODEL` | `z-ai/glm-5.3-flash` | Must be a NEAR-operated TEE model |
| `NEARAI_EMBEDDING_MODEL` | `Qwen/Qwen3-Embedding-0.6B` | Changing it requires re-indexing existing documents |
| `NEARAI_RERANK_MODEL` | `Qwen/Qwen3-Reranker-0.6B` | |
| `MORROW_DATA_DIR` | `./data` | Database, files, receipts |
| `MORROW_MAX_UPLOAD_MB` | `20` | |
| `MORROW_MAX_PDF_PAGES` | `800` | |
| `MORROW_ATTESTATION_TTL_MINUTES` | `10` | Reuse window for a verified enclave session |
| `MORROW_ALLOW_SIGNUP` | `true` | Set `false` once your account exists on a reachable host |

## Run locally (recommended)

```bash
npm install
npm run dev          # development, http://localhost:3000
# or
npm run build && npm start
```

## Run on your own server

```bash
npm ci && npm run build
MORROW_DATA_DIR=/var/lib/morrow MORROW_ALLOW_SIGNUP=false npm start   # listens on :3000
```

- Put it behind a reverse proxy that terminates HTTPS and forwards `Host` and `X-Forwarded-Proto` (session cookies become `Secure` automatically over HTTPS).
- Run a single instance: the rate limiter, embedding queue and vector cache are in-process.
- Use full-disk encryption and restrict the data directory to the service user (Morrow creates it with mode 0700).
- Back up `MORROW_DATA_DIR` if you want backups; remember that in-app deletion does not reach them.

## Not suitable

Serverless platforms with ephemeral filesystems or multiple instances (the SQLite file and in-memory state would not persist or be shared). Hosting Morrow for other people also changes the privacy model: you would be able to read their documents.

## Changing the embedding model

Vectors from different models are not comparable. After changing `NEARAI_EMBEDDING_MODEL`, clear existing vectors so they are rebuilt on the next library load:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.MORROW_DATA_DIR?process.env.MORROW_DATA_DIR+'/morrow.sqlite':'./data/morrow.sqlite');d.exec('UPDATE chunks SET embedding=NULL; UPDATE documents SET semantic=0, centroid=NULL');"
```
