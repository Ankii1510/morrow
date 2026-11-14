#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node scripts/assemble-lock.mjs
node scripts/assemble-assets.mjs
echo "Large assets ready."
