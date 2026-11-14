#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Prefer durable offline ingest chunks when present (no network).
{
  const apply = join(root, "scripts", "apply-ingest.mjs");
  if (existsSync(apply) && existsSync(join(root, "_ingest"))) {
    const r = spawnSync(process.execPath, [apply], { stdio: "inherit" });
    if (r.status) process.exit(r.status ?? 1);
  }
}

// package-lock from parts
const lockOut = join(root, "package-lock.json");
const lockParts = join(root, "package-lock.parts");
if (!existsSync(lockOut) && existsSync(lockParts)) {
  const parts = readdirSync(lockParts).filter((f) => /^\d{2}$/.test(f)).sort();
  writeFileSync(lockOut, parts.map((f) => readFileSync(join(lockParts, f), "utf8")).join(""));
  console.log(`assembled package-lock.json from ${parts.length} parts`);
}

// binaries from asset-parts + manifest
const manifestPath = join(root, "asset-parts", "manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const entry of manifest) {
    const out = join(root, entry.path);
    if (existsSync(out) && !process.env.FORCE_ASSEMBLE) continue;
    mkdirSync(dirname(out), { recursive: true });
    const b64 = entry.parts.map((p) => readFileSync(join(root, p), "utf8")).join("");
    writeFileSync(out, Buffer.from(b64, "base64"));
    console.log(`assembled ${entry.path} (${Buffer.from(b64, "base64").length} bytes)`);
  }
}
