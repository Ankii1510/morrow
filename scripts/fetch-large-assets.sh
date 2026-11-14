#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Prefer local parts/assemble when present; otherwise fetch from public upstream mirror.
if [ -d package-lock.parts ]; then
  cat package-lock.parts/part-* 2>/dev/null || cat package-lock.parts/[0-9][0-9] > package-lock.json || true
fi
if [ -f scripts/assemble-assets.mjs ]; then
  FORCE_ASSEMBLE=1 node scripts/assemble-assets.mjs || true
fi
BASE="${MORROW_ASSET_BASE:-https://raw.githubusercontent.com/nehaiqoo-source/morrow/main}"
need_fetch=0
[ ! -f package-lock.json ] && need_fetch=1
[ ! -f src/app/favicon.ico ] || [ "$(wc -c < src/app/favicon.ico)" -lt 1000 ] && need_fetch=1
for f in 01-library.jpg 02-citation-in-document.jpg 03-live-enclave-verification.jpg 04-ask-without-key.jpg 05-cited-answer.jpg 06-verified-private-inference.jpg; do
  p="docs/screenshots/$f"
  if [ ! -f "$p" ] || [ "$(wc -c < "$p")" -lt 1000 ]; then need_fetch=1; fi
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
