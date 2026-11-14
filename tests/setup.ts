import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Every test file gets its own empty data directory. Offline tests never see an API key,
// so they prove the app behaves correctly (and honestly) without NEAR AI credentials.
process.env.MORROW_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "morrow-test-"));
// Only the opt-in live AI suite may use the real key (it spends a small amount of credit).
if (!process.env.MORROW_LIVE_AI) delete process.env.NEARAI_API_KEY;
// Tests never inherit production-style settings from the developer's shell.
for (const k of ["MORROW_ENCRYPTION_KEY", "MORROW_MAIL_TRANSPORT", "MORROW_TRUSTED_PROXY_HOPS", "MORROW_SECURE_COOKIES", "MORROW_ALLOW_SIGNUP"]) delete process.env[k];
