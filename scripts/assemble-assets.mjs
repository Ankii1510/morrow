#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
spawnSync(process.execPath, [join(root, "scripts/apply-ingest.mjs")], { stdio: "inherit" });
const partsDir = join(root, "asset-parts");
const manifestPath = join(partsDir, "manifest.json");
function sha(buf) { return createHash("sha256").update(buf).digest("hex"); }
function readPart(name) {
  const direct = join(partsDir, name);
  if (existsSync(direct)) return readFileSync(direct, "utf8");
  const prefix = name + ".";
  const micros = readdirSync(partsDir)
    .filter((f) => f.startsWith(prefix) && /^\d+$/.test(f.slice(prefix.length)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!micros.length) return null;
  return micros.map((f) => readFileSync(join(partsDir, f), "utf8")).join("");
}
if (!existsSync(manifestPath)) { console.error("missing asset-parts/manifest.json"); process.exit(1); }
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const item of manifest.binaries || []) {
  const dest = join(root, item.path);
  if (existsSync(dest) && sha(readFileSync(dest)) === item.sha256) continue;
  const parts = [];
  for (const f of item.parts || []) {
    const c = readPart(f);
    if (c == null) { console.error("missing part", f); process.exit(1); }
    parts.push(c);
  }
  mkdirSync(dirname(dest), { recursive: true });
  const buf = Buffer.from(parts.join(""), "base64");
  if (sha(buf) !== item.sha256) { console.error("checksum mismatch", item.path); process.exit(1); }
  writeFileSync(dest, buf);
  console.log(`assembled ${item.path} (${buf.length} bytes)`);
}
