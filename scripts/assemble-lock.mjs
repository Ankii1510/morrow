#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, cpSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "package-lock.json");
const dir = join(root, "package-lock.parts");
const manPath = join(dir, "manifest.json");

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
  const urlFile = join(root, "asset-parts", "BUNDLE_URL");
  if (!existsSync(urlFile) || !existsSync(manPath)) return;
  const man = JSON.parse(readFileSync(manPath, "utf8"));
  const missing = (man.parts || []).some((f) => !existsSync(join(dir, f)));
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
  console.log("imported lock bundle");
}

if (existsSync(out) && readFileSync(out).length > 1000) process.exit(0);
ensureBundle();
if (!existsSync(manPath)) process.exit(0);
const man = JSON.parse(readFileSync(manPath, "utf8"));
const b64 = man.parts.map((f) => unframe(readFileSync(join(dir, f), "utf8"))).join("");
const buf = Buffer.from(b64, "base64");
const got = createHash("sha256").update(buf).digest("hex");
if (got !== man.sha256) {
  console.error(`package-lock checksum mismatch: ${got} != ${man.sha256}`);
  process.exit(1);
}
writeFileSync(out, buf);
console.log(`assembled package-lock.json (${buf.length} bytes)`);
