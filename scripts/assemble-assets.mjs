#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.env.FORCE_ASSEMBLE === "1" || process.argv.includes("--force");

const lockOut = join(root, "package-lock.json");
const lockParts = join(root, "package-lock.parts");
if ((!existsSync(lockOut) || force) && existsSync(lockParts)) {
  const files = readdirSync(lockParts).filter((f) => /^(part-)?\d{2}$/.test(f)).sort();
  if (files.length) {
    writeFileSync(lockOut, files.map((f) => readFileSync(join(lockParts, f), "utf8")).join(""));
    console.log(`assembled package-lock.json from ${files.length} parts`);
  }
}

const manifestPath = join(root, "asset-parts", "manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const entry of manifest) {
    const out = join(root, entry.path);
    if (existsSync(out) && !force) continue;
    mkdirSync(dirname(out), { recursive: true });
    const b64 = entry.parts.map((p) => readFileSync(join(root, p), "utf8").trim()).join("");
    const buf = Buffer.from(b64, "base64");
    writeFileSync(out, buf);
    console.log(`assembled ${entry.path} (${buf.length} bytes)`);
  }
}
