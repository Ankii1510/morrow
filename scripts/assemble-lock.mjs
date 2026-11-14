#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lockOut = join(root, "package-lock.json");
const lockParts = join(root, "package-lock.parts");
if (!existsSync(lockOut) && existsSync(lockParts)) {
  const files = readdirSync(lockParts).filter((f) => /^(part-)?\d{2}$/.test(f)).sort();
  if (files.length) {
    writeFileSync(lockOut, files.map((f) => readFileSync(join(lockParts, f), "utf8")).join(""));
    console.log(`assembled package-lock.json from ${files.length} parts`);
  }
}
