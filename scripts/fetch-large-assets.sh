#!/usr/bin/env bash
# Pulls large binary assets that could not be pushed through the API size limit.
# Source of truth: https://github.com/nehaiqoo-source/morrow
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="https://raw.githubusercontent.com/nehaiqoo-source/morrow/main"
cd "$ROOT"
curl -fsSL "$BASE/package-lock.json" -o package-lock.json
mkdir -p src/app docs/screenshots
curl -fsSL "$BASE/src/app/favicon.ico" -o src/app/favicon.ico
for f in \
  01-library.jpg \
  02-citation-in-document.jpg \
  03-live-enclave-verification.jpg \
  04-ask-without-key.jpg \
  05-cited-answer.jpg \
  06-verified-private-inference.jpg
do
  curl -fsSL "$BASE/docs/screenshots/$f" -o "docs/screenshots/$f"
done
echo "Fetched package-lock.json, favicon.ico, and docs/screenshots/*.jpg"
