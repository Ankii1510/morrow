#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const partsDir = join(root, "asset-parts");
const manifestPath = join(partsDir, "manifest.json");
const base = "https://raw.githubusercontent.com/nehaiqoo-source/morrow/main";
function sha(buf) { return createHash("sha256").update(buf).digest("hex"); }
function fetchFile(rel) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  execSync(`curl -fsSL "${base}/${rel}" -o "${rel}"`, { cwd: root, stdio: "inherit" });
}
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const item of manifest.binaries || []) {
    const dest = join(root, item.path);
    if (existsSync(dest) && sha(readFileSync(dest)) === item.sha256) continue;
    const missing = (item.parts || []).some((f) => !existsSync(join(partsDir, f)));
    if (missing) { fetchFile(item.path); continue; }
    mkdirSync(dirname(dest), { recursive: true });
    const buf = Buffer.from(item.parts.map((f) => readFileSync(join(partsDir, f), "utf8")).join(""), "base64");
    if (sha(buf) !== item.sha256) { console.error("checksum mismatch", item.path); process.exit(1); }
    writeFileSync(dest, buf);
    console.log(`assembled ${item.path} (${buf.length} bytes)`);
  }
  process.exit(0);
}
for (const rel of ["src/app/favicon.ico","docs/screenshots/01-library.jpg","docs/screenshots/02-citation-in-document.jpg","docs/screenshots/03-live-enclave-verification.jpg","docs/screenshots/04-ask-without-key.jpg","docs/screenshots/05-cited-answer.jpg","docs/screenshots/06-verified-private-inference.jpg"]) {
  const p = join(root, rel);
  if (!existsSync(p) || readFileSync(p).length < 1000) fetchFile(rel);
}
