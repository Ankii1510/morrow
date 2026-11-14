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
    const text = files.map((f) => readFileSync(join(lockParts, f), "utf8")).join("");
    if (text.includes('"lockfileVersion"') && text.length > 10000) {
      writeFileSync(lockOut, text);
      console.log(`assembled package-lock.json from ${files.length} parts (${text.length} chars)`);
    }
  }
}

const manifestPath = join(root, "asset-parts", "manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const entry of manifest) {
    const out = join(root, entry.path);
    const missing = !existsSync(out);
    const tooSmall = existsSync(out) && readFileSync(out).length < Math.min(1000, (entry.size || 1000) / 2);
    if (!missing && !tooSmall && !force) continue;
    const partPaths = entry.parts || [];
    if (!partPaths.every((p) => existsSync(join(root, p)))) {
      console.log(`skip ${entry.path}: missing parts`);
      continue;
    }
    mkdirSync(dirname(out), { recursive: true });
    const b64 = partPaths.map((p) => readFileSync(join(root, p), "utf8").trim()).join("");
    const buf = Buffer.from(b64, "base64");
    writeFileSync(out, buf);
    console.log(`assembled ${entry.path} (${buf.length} bytes)`);
  }
}
