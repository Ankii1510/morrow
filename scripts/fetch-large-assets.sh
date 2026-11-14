#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f scripts/assemble-lock.mjs ]; then
  node scripts/assemble-lock.mjs || true
fi
if [ -f scripts/assemble-assets.mjs ]; then
  FORCE_ASSEMBLE=1 node scripts/assemble-assets.mjs || true
fi
BASE="${MORROW_ASSET_BASE:-https://raw.githubusercontent.com/nehaiqoo-source/morrow/main}"
need_fetch=0
[ ! -f package-lock.json ] && need_fetch=1
[ ! -f src/app/favicon.ico ] || [ "$(wc -c < src/app/favicon.ico 2>/dev/null || echo 0)" -lt 1000 ] && need_fetch=1
for f in 01-library.jpg 02-citation-in-document.jpg 03-live-enclave-verification.jpg 04-ask-without-key.jpg 05-cited-answer.jpg 06-verified-private-inference.jpg; do
  p="docs/screenshots/$f"
  if [ ! -f "$p" ] || [ "$(wc -c < "$p" 2>/dev/null || echo 0)" -lt 1000 ]; then need_fetch=1; fi
done
if [ "$need_fetch" -eq 1 ]; then
  mkdir -p src/app docs/screenshots
  curl -fsSL "$BASE/package-lock.json" -o package-lock.json
  curl -fsSL "$BASE/src/app/favicon.ico" -o src/app/favicon.ico
  for f in 01-library.jpg 02-citation-in-document.jpg 03-live-enclave-verification.jpg 04-ask-without-key.jpg 05-cited-answer.jpg 06-verified-private-inference.jpg; do
    curl -fsSL "$BASE/docs/screenshots/$f" -o "docs/screenshots/$f"
  done
  echo "fetched large assets from $BASE"
fi
