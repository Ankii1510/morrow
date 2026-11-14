#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -d package-lock.parts ]; then
  cat package-lock.parts/part-* 2>/dev/null || cat package-lock.parts/[0-9][0-9] > package-lock.json
fi
if [ -f scripts/assemble-assets.mjs ]; then
  FORCE_ASSEMBLE=1 node scripts/assemble-assets.mjs
fi
