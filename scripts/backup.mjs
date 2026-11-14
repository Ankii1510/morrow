#!/usr/bin/env node
// Consistent, private backup of Morrow's data directory.
//
//   node scripts/backup.mjs [destination-directory]     default: ./.backups
//
// - The database is copied with SQLite's VACUUM INTO, which is safe while Morrow is running.
// - The backup directory is 0700 and every file in it 0600.
// - Files that are encrypted at rest are copied as they are (still encrypted). The database copy
//   contains extracted text in the clear: store backups on an encrypted disk, and never in the repository.
// - In-app deletion does not reach backups. Delete old backups yourself.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = /^\s*(MORROW_DATA_DIR)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const dataDir = path.resolve(process.env.MORROW_DATA_DIR || "./data");
const destRoot = path.resolve(process.argv[2] || "./.backups");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const dest = path.join(destRoot, `morrow-data-${stamp}`);
if (path.resolve(dest).startsWith(dataDir + path.sep)) {
  console.error("The backup destination must not be inside the data directory.");
  process.exit(2);
}
process.umask(0o077);
fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
fs.chmodSync(destRoot, 0o700);

const db = new DatabaseSync(path.join(dataDir, "morrow.sqlite"));
db.prepare("VACUUM INTO ?").run(path.join(dest, "morrow.sqlite"));
db.close();

let files = 0;
function copyTree(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true, mode: 0o700 });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) {
      fs.copyFileSync(s, d);
      fs.chmodSync(d, 0o600);
      files++;
    } // symlinks and special files are skipped on purpose
  }
}
copyTree(path.join(dataDir, "files"), path.join(dest, "files"));
copyTree(path.join(dataDir, "receipts"), path.join(dest, "receipts"));
fs.chmodSync(path.join(dest, "morrow.sqlite"), 0o600);
console.log(`Backup written to ${dest}\n  database copy + ${files} stored file(s), owner-only permissions.`);
console.log("This backup contains personal data. It is not removed by deleting documents or accounts in the app.");
