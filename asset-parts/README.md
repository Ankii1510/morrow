# asset-parts

Base64 chunks for binary assets that cannot be uploaded intact through the GitHub MCP (UTF-8 transport).

- `src__app__favicon.ico.*.b64` — verified; `FORCE_ASSEMBLE=1 node scripts/assemble-assets.mjs` writes `src/app/favicon.ico`.
- Screenshots and the lockfile are restored by `scripts/fetch-large-assets.sh` on `npm install` / `preinstall` when local files are missing or placeholders.
