#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
{
  const apply = join(root, "scripts", "apply-ingest.mjs");
  if (existsSync(apply) && existsSync(join(root, "_ingest"))) {
    const r = spawnSync(process.execPath, [apply], { stdio: "inherit" });
    if (r.status) process.exit(r.status ?? 1);
  }
}
const lockOut = join(root, "package-lock.json");
const lockParts = join(root, "package-lock.parts");
if (!existsSync(lockOut) && existsSync(lockParts)) {
  const parts = readdirSync(lockParts).filter((f) => /^\d{2}$/.test(f) || /^part-\d+$/.test(f)).sort();
  writeFileSync(lockOut, parts.map((f) => readFileSync(join(lockParts, f), "utf8")).join(""));
  console.log(`assembled package-lock.json from ${parts.length} parts`);
}
