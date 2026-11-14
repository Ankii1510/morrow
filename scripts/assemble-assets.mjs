#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const partsDir = join(root, "asset-parts");
const manifestPath = join(partsDir, "manifest.json");

function unframe(s) {
  if (!s.startsWith("#framed-v1")) return s.replace(/\n+$/, "");
  let out = "";
  for (const line of s.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    out += line.slice(i + 1);
  }
  return out;
}

function ensureBundle() {
  const urlFile = join(partsDir, "BUNDLE_URL");
  if (!existsSync(urlFile) || !existsSync(manifestPath)) return;
  const man = JSON.parse(readFileSync(manifestPath, "utf8"));
  const missing = (man.binaries || []).some((item) =>
    (item.parts || []).some((f) => !existsSync(join(partsDir, f)))
  );
  if (!missing) return;
  const url = readFileSync(urlFile, "utf8").trim();
  const tar = join(root, ".bundle.tar.gz");
  execSync(`curl -fsSL -o "${tar}" "${url}"`, { stdio: "inherit" });
  execSync(`tar xzf "${tar}" -C "${root}"`, { stdio: "inherit" });
  const src = join(root, "morrow-bundle");
  if (existsSync(src)) {
    cpSync(src, root, { recursive: true });
    rmSync(src, { recursive: true, force: true });
  }
  rmSync(tar, { force: true });
  console.log("imported asset bundle");
}

ensureBundle();
if (!existsSync(manifestPath)) process.exit(0);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const item of manifest.binaries || []) {
  const dest = join(root, item.path);
  if (existsSync(dest)) {
    const got = createHash("sha256").update(readFileSync(dest)).digest("hex");
    if (got === item.sha256) continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  const b64 = item.parts.map((f) => unframe(readFileSync(join(partsDir, f), "utf8"))).join("");
  const buf = Buffer.from(b64, "base64");
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== item.sha256) {
    console.error(`checksum mismatch for ${item.path}: ${got} != ${item.sha256}`);
    process.exit(1);
  }
  writeFileSync(dest, buf);
  console.log(`assembled ${item.path} (${buf.length} bytes)`);
}
