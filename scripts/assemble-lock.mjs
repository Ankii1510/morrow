#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "package-lock.json");
const dir = join(root, "package-lock.parts");
if (existsSync(out) && readFileSync(out).length > 1000) process.exit(0);
if (!existsSync(dir)) { console.error("missing package-lock.parts"); process.exit(1); }
const parts = readdirSync(dir).filter((f) => /^\d+$/.test(f)).sort((a,b)=>a.localeCompare(b, undefined, {numeric:true}));
if (!parts.length) { console.error("no package-lock parts"); process.exit(1); }
writeFileSync(out, parts.map((f) => readFileSync(join(dir, f), "utf8")).join(""));
console.log(`assembled package-lock.json from ${parts.length} parts`);
