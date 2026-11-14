#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "package-lock.json");
const dir = join(root, "package-lock.parts");
if (existsSync(out) && readFileSync(out).length > 1000) process.exit(0);
if (existsSync(dir)) {
  const parts = readdirSync(dir).filter((f) => /^\d+$/.test(f)).sort();
  if (parts.length) {
    writeFileSync(out, parts.map((f) => readFileSync(join(dir, f), "utf8")).join(""));
    console.log(`assembled package-lock.json from ${parts.length} parts`);
    process.exit(0);
  }
}
execSync("curl -fsSL https://raw.githubusercontent.com/nehaiqoo-source/morrow/main/package-lock.json -o package-lock.json", { cwd: root, stdio: "inherit" });
