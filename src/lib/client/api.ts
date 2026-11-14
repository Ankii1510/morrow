/** Browser-side fetch helper. Errors carry the server's code and message so the UI can explain them. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers);
  let body = init?.body;
  if (init?.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network", "Could not reach Morrow. Check that the server is running.");
  }
  const isJson = (res.headers.get("content-type") || "").includes("json");
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    const e = data?.error || {};
    const { code = "error", message = `Request failed (${res.status}).`, ...extra } = e;
    throw new ApiError(res.status, code, message, extra);
  }
  return data as T;
}

export type Doc = {
  id: string;
  title: string;
  filename: string;
  kind: "pdf" | "text" | "markdown";
  sizeBytes: number;
  status: string;
  semantic: "pending" | "ready" | "failed" | "unavailable";
  error: string | null;
  pageCount: number;
  chunkCount: number;
  wordCount: number;
  meta: Record<string, string>;
  createdAt: number;
  tags: string[];
  collections: string[];
};

export type Collection = { id: string; name: string; documentCount: number };
export type TagCount = { tag: string; documentCount: number };

export type Me = {
  user: { id: string; email: string; createdAt: number } | null;
  allowSignup: boolean;
  features: { passwordReset: boolean; emailVerification: boolean; encryptionAtRest: boolean };
  near: { configured: boolean; baseUrl: string; chatModel: string; embeddingModel: string; rerankModel: string; attestationTtlMinutes: number };
  limits: { maxUploadMb: number; maxPdfPages: number };
};

export type AttestationSummary = {
  model: string;
  verifiedAt: number;
  gateway: { signingAlgo: string; signingAddress: string; tcbStatus: string; advisoryIds: string[]; nonce: string; tlsSpkiFingerprint: string | null };
  models: { signingAlgo: string; signingAddress: string; tcbStatus: string; advisoryIds: string[]; gpuEvidence: string; nonce: string }[];
};

export type Verification = {
  status: "verified";
  completionId: string;
  model: string;
  signatureKind: "provider_tee" | "gateway";
  signer: { signingAlgo: string; signingAddress: string };
  signedText: string;
  requestSha256: string | null;
  responseSha256: string | null;
  e2ee: true;
  chat: AttestationSummary;
  embedding: AttestationSummary | null;
  rerank: AttestationSummary | null;
  checks: { id: string; label: string; detail: string }[];
};

export type Source = { n: number; chunkId: number; documentId: string; title: string; kind: string; page: number; heading: string | null; text: string; cited: boolean; flagged?: boolean };

export type Answer = {
  id: string;
  question: string;
  answer: string;
  outcome: "grounded" | "insufficient" | "uncited" | "no_sources" | "withheld";
  sources: Source[];
  verification: Verification | null;
  retrieval: { mode: string; reranked: boolean; notes: string[]; invalidCitations: number[] };
  model: string;
  createdAt: number;
};

export type Hit = { chunkId: number; documentId: string; title: string; kind: string; page: number; heading: string | null; text: string; score: number; via: string[] };

export const KIND_LABEL: Record<string, string> = { pdf: "PDF", text: "Text", markdown: "Markdown" };

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function sourceHref(s: { documentId: string; page: number; chunkId: number }): string {
  return `/library/${s.documentId}?page=${s.page}&passage=${s.chunkId}`;
}

export function short(hex: string, head = 10, tail = 6): string {
  return hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
