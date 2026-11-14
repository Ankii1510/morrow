#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ingest = join(root, "_ingest");
if (!existsSync(ingest)) {
  console.log("no _ingest; nothing to apply");
  process.exit(0);
}
const files = readdirSync(ingest).filter((f) => /^\d{4}\.hex$/.test(f)).sort();
if (files.length === 0) {
  console.log("no ingest chunks");
  process.exit(0);
}
const first = readFileSync(join(ingest, files[0]), "utf8").trim();
const m = /^T1:(\d{4})\/(\d{4}):([0-9a-f]{16}):/.exec(first);
if (!m) throw new Error("bad ingest header");
const N = Number(m[2]);
if (files.length < N) {
  console.log(`ingest incomplete ${files.length}/${N}; skipping`);
  process.exit(0);
}
const EXPECT = "51019d17b1ec78c0086628ce3ce2baa93a855ef691af3834035743144be31d39";
const parts = [];
for (let i = 0; i < N; i++) {
  const text = readFileSync(join(ingest, `${String(i).padStart(4, "0")}.hex`), "utf8").trim();
  const idx = text.lastIndexOf(":");
  const prefix = text.slice(0, idx);
  let hexdata = text.slice(idx + 1);
  // V/W letter encoding avoids MCP 5/9 digit corruption (V=5, W=9)
  hexdata = hexdata.replace(/V/g, "5").replace(/W/g, "9").replace(/[^0-9a-fA-F]/g, "");
  const meta = prefix.split(":");
  if (meta[0] !== "T1") throw new Error(`bad meta ${prefix}`);
  const h = meta[2].replace(/V/g, "5").replace(/W/g, "9");
  const got = createHash("sha256").update(hexdata, "utf8").digest("hex").slice(0, 16);
  if (got !== h) throw new Error(`chunk hash mismatch ${i}: ${got} != ${h}`);
  parts.push(hexdata);
}
const raw = Buffer.from(parts.join(""), "hex");
const digest = createHash("sha256").update(raw).digest("hex");
if (digest !== EXPECT) throw new Error(`tgz hash mismatch ${digest}`);
const tgz = join(root, ".morrow-durable.tgz");
const staging = join(root, ".morrow-durable-staging");
writeFileSync(tgz, raw);
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
execSync(`tar -xzf ${JSON.stringify(tgz)} -C ${JSON.stringify(staging)}`, { stdio: "inherit" });
unlinkSync(tgz);
for (const dir of ["asset-parts", "package-lock.parts"]) {
  const src = join(staging, dir);
  if (!existsSync(src)) continue;
  const dest = join(root, dir);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}
rmSync(staging, { recursive: true, force: true });
console.log(`applied durable ingest tarball (${raw.length} bytes)`);
