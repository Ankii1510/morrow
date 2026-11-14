import path from "node:path";

/**
 * All runtime configuration comes from environment variables.
 * Nothing here is a secret default: the NEAR AI key and the encryption key have no fallback.
 * Values are read through getters so a changed environment is picked up without a rebuild.
 */
function int(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function secret(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export type MailTransport = "none" | "log" | "resend" | "memory";

export const config = {
  get dataDir(): string {
    return path.resolve(/*turbopackIgnore: true*/ process.env.MORROW_DATA_DIR || "./data");
  },
  near: {
    get baseUrl(): string {
      return process.env.NEARAI_BASE_URL || "https://cloud-api.near.ai/v1";
    },
    get apiKey(): string | undefined {
      return secret("NEARAI_API_KEY");
    },
    // Defaults are NEAR-operated "Confidential TEE" models (owned_by: nearai in /v1/models).
    get chatModel(): string {
      return process.env.NEARAI_CHAT_MODEL || "z-ai/glm-5.3-flash";
    },
    get embeddingModel(): string {
      return process.env.NEARAI_EMBEDDING_MODEL || "Qwen/Qwen3-Embedding-0.6B";
    },
    get rerankModel(): string {
      return process.env.NEARAI_RERANK_MODEL || "Qwen/Qwen3-Reranker-0.6B";
    },
    /** How long one verified attestation session is reused before a fresh nonce is required. */
    get attestationTtlMs(): number {
      return int("MORROW_ATTESTATION_TTL_MINUTES", 10) * 60_000;
    },
  },
  limits: {
    get maxUploadBytes(): number {
      return int("MORROW_MAX_UPLOAD_MB", 20) * 1024 * 1024;
    },
    get maxPdfPages(): number {
      return int("MORROW_MAX_PDF_PAGES", 800);
    },
    maxExtractedChars: 4_000_000,
    maxQuestionChars: 2000,
    get maxDocumentsPerUser(): number {
      return int("MORROW_MAX_DOCUMENTS", 2000);
    },
  },
  /**
   * Daily budgets (UTC day). Per-user limits stop one account from draining the shared NEAR AI key;
   * app-wide limits cap total spend whatever the number of accounts.
   */
  quotas: {
    get userDailyQuestions(): number {
      return int("MORROW_USER_DAILY_QUESTIONS", 50, 0);
    },
    get userDailyTokens(): number {
      return int("MORROW_USER_DAILY_TOKENS", 400_000, 0);
    },
    get userDailyEmbedPassages(): number {
      return int("MORROW_USER_DAILY_EMBED_PASSAGES", 3000, 0);
    },
    get appDailyQuestions(): number {
      return int("MORROW_APP_DAILY_QUESTIONS", 1000, 0);
    },
    get appDailyTokens(): number {
      return int("MORROW_APP_DAILY_TOKENS", 5_000_000, 0);
    },
  },
  session: {
    cookieName: "morrow_session",
    /** Absolute lifetime of a session. */
    ttlMs: 14 * 24 * 3600_000,
    /** A session unused for this long expires even if its absolute lifetime has not. */
    get idleMs(): number {
      return int("MORROW_SESSION_IDLE_DAYS", 7) * 24 * 3600_000;
    },
  },
  security: {
    /**
     * Number of reverse proxies in front of Morrow that are under the operator's control.
     * 0 (default) means forwarded headers are ignored entirely: X-Forwarded-For, -Host and -Proto
     * can be set by any client and are not evidence of anything.
     */
    get trustedProxyHops(): number {
      return int("MORROW_TRUSTED_PROXY_HOPS", 0, 0);
    },
    /** Force the Secure cookie flag (set when Morrow is served over HTTPS). */
    get secureCookies(): boolean {
      return process.env.MORROW_SECURE_COOKIES === "true";
    },
    /** 32-byte master key (base64 or 64 hex chars) for encrypting stored files. Undefined = files stored unencrypted. */
    get encryptionKey(): Buffer | undefined {
      const raw = secret("MORROW_ENCRYPTION_KEY");
      if (!raw) return undefined;
      const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
      if (key.length !== 32) throw new Error("MORROW_ENCRYPTION_KEY must be 32 bytes (base64, or 64 hex characters).");
      return key;
    },
  },
  mail: {
    get transport(): MailTransport {
      const t = (process.env.MORROW_MAIL_TRANSPORT || "none").toLowerCase();
      if (t === "log" || t === "resend") return t;
      // The in-memory transport exists only so tests can read delivered links; it is refused outside tests.
      if (t === "memory" && process.env.NODE_ENV === "test") return "memory";
      return "none";
    },
    get from(): string {
      return process.env.MORROW_MAIL_FROM || "";
    },
    get resendApiKey(): string | undefined {
      return secret("RESEND_API_KEY");
    },
    /** Links in emails are built from this, never from the request's Host header. */
    get publicUrl(): string {
      return (process.env.MORROW_PUBLIC_URL || "http://localhost:3000").replace(/\/+$/, "");
    },
    get requireVerification(): boolean {
      return config.mail.transport !== "none" && process.env.MORROW_REQUIRE_EMAIL_VERIFICATION !== "false";
    },
  },
  /** Open self-signup. Set MORROW_ALLOW_SIGNUP=false on a shared host. */
  get allowSignup(): boolean {
    return process.env.MORROW_ALLOW_SIGNUP !== "false";
  },
};

export function nearConfigured(): boolean {
  return Boolean(config.near.apiKey);
}

export function mailEnabled(): boolean {
  return config.mail.transport !== "none";
}
