# package-lock.parts

Optional split of `package-lock.json` for MCP-sized uploads.

- Complete numeric parts (`00`, `01`, …) are concatenated by `scripts/assemble-lock.mjs`.
- If parts are incomplete, `scripts/fetch-large-assets.sh` (npm `preinstall`) downloads the full lockfile.
