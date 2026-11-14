#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lockOut = join(root, "package-lock.json");
const lockParts = join(root, "package-lock.parts");
if (!existsSync(lockOut) && existsSync(lockParts)) {
  const files = readdirSync(lockParts)
    .filter((f) => /^(part-)?\d{2,3}$/.test(f))
    .sort();
  if (!files.length) process.exit(0);
  const text = files.map((f) => readFileSync(join(lockParts, f), "utf8")).join("");
  // Ignore stub/incomplete part sets; fetch-large-assets.sh will supply the real lockfile.
  if (!text.includes('"lockfileVersion"') || text.length < 100000) {
    console.log(`skip assemble-lock: parts look incomplete (${text.length} chars)`);
    process.exit(0);
  }
  writeFileSync(lockOut, text);
  console.log(`assembled package-lock.json from ${files.length} parts (${text.length} chars)`);
}
