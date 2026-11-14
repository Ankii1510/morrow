"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Download, LogOut, Trash2 } from "lucide-react";
import { api, ApiError, formatDate, formatDateTime } from "@/lib/client/api";
import { useMe } from "@/components/shell";
import { ErrorNote, Modal, Mono, PageHeader, Spinner, useToast } from "@/components/ui";

type Usage = {
  today: { questions: number; tokens: number; callsWithoutTokenCount: number; passagesEmbedded: number; calls: number };
  limits: { userDailyQuestions: number; userDailyTokens: number; userDailyEmbedPassages: number };
  history: { kind: string; purpose: string; model: string; units: number; promptTokens: number | null; completionTokens: number | null; totalTokens: number | null; status: string; createdAt: number }[];
  notes: string[];
};
type Session = { id: number; current: boolean; createdAt: number; lastSeenAt: number; expiresAt: number; userAgent: string };

function Meter({ label, used, limit, unit }: { label: string; used: number; limit: number; unit: string }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return (
    <div>
      <div className="flex justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="text-ink-2">
          {used.toLocaleString()} of {limit.toLocaleString()} {unit}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunk" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)}>
        <div className={`h-full rounded-full ${pct >= 100 ? "bg-clay" : "bg-moss-2"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function describeAgent(ua: string): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl|node|undici/i.test(ua) ? "Script or API client" : "Browser";
  const os = /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rule grid gap-x-10 gap-y-3 pt-7 md:grid-cols-[200px_1fr]">
      <h2 id={id} className="display text-[1.3rem]">
        {title}
      </h2>
      <div className="min-w-0 text-[0.94rem]">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const { me } = useMe();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const loadSessions = useCallback(() => api<{ sessions: Session[] }>("/api/sessions").then((r) => setSessions(r.sessions)).catch(() => setSessions([])), []);
  useEffect(() => {
    api<Usage>("/api/usage").then(setUsage).catch(() => {});
    void loadSessions();
  }, [loadSessions]);

  async function revoke(body: { scope?: "others" | "all"; id?: number }) {
    try {
      const r = await api<{ revoked: number }>("/api/sessions", { method: "DELETE", json: body });
      if (body.scope === "all") {
        router.replace("/");
        return;
      }
      toast("ok", r.revoked === 0 ? "No other devices were signed in." : `Signed out ${r.revoked} other device${r.revoked === 1 ? "" : "s"}.`);
      void loadSessions();
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Could not sign out those devices.");
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    setPwError(null);
    try {
      const r = await api<{ otherSessionsSignedOut: number }>("/api/account/password", { method: "POST", json: { currentPassword: pw.current, newPassword: pw.next } });
      setPw({ current: "", next: "" });
      toast("ok", `Password changed.${r.otherSessionsSignedOut ? ` ${r.otherSessionsSignedOut} other device${r.otherSessionsSignedOut === 1 ? " was" : "s were"} signed out.` : ""}`);
      void loadSessions();
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : "Could not change the password.");
    }
    setPwBusy(false);
  }

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/account", { method: "DELETE", json: { password } });
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the account.");
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader title="Settings" />

      <Block id="acct" title="Account">
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5">
          <dt className="text-ink-3">Email</dt>
          <dd>{me.user!.email}</dd>
          <dt className="text-ink-3">Created</dt>
          <dd>{formatDate(me.user!.createdAt)}</dd>
        </dl>
      </Block>

      <Block id="password" title="Password">
        <form onSubmit={changePassword} className="max-w-sm space-y-3" noValidate>
          <div>
            <label htmlFor="pw-current" className="mb-1 block text-sm font-medium">
              Current password
            </label>
            <input id="pw-current" type="password" autoComplete="current-password" className="field" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </div>
          <div>
            <label htmlFor="pw-next" className="mb-1 block text-sm font-medium">
              New password
            </label>
            <input id="pw-next" type="password" autoComplete="new-password" minLength={10} className="field" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <p className="mt-1 text-xs text-ink-3">At least 10 characters. Other devices are signed out when you change it.</p>
          </div>
          {pwError ? <ErrorNote>{pwError}</ErrorNote> : null}
          <button className="btn btn-quiet" disabled={pwBusy || !pw.current || pw.next.length < 10}>
            {pwBusy ? <Spinner /> : "Change password"}
          </button>
        </form>
        {!me.features.passwordReset ? <p className="mt-3 text-sm text-ink-3">This server cannot send email, so a forgotten password cannot be reset by link. Keep it somewhere safe.</p> : null}
      </Block>

      <Block id="sessions" title="Signed-in devices">
        {sessions === null ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-rule">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                <span>
                  <span className="font-medium">{describeAgent(s.userAgent)}</span>
                  {s.current ? <span className="ml-2 rounded-full bg-moss-soft px-2 py-0.5 text-xs text-moss">This device</span> : null}
                  <span className="block text-sm text-ink-3">
                    Signed in {formatDateTime(s.createdAt)} · last active {formatDateTime(s.lastSeenAt)}
                  </span>
                </span>
                {!s.current ? (
                  <button className="btn btn-quiet h-8" onClick={() => void revoke({ id: s.id })}>
                    Sign out
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-quiet" onClick={() => void revoke({ scope: "others" })} disabled={!sessions || sessions.length < 2}>
            Sign out other devices
          </button>
          <button className="btn btn-quiet" onClick={() => void revoke({ scope: "all" })}>
            <LogOut size={15} aria-hidden /> Sign out everywhere
          </button>
        </div>
        <p className="mt-3 text-sm text-ink-3">A session ends after 14 days, or after 7 days without use.</p>
      </Block>

      <Block id="usage" title="AI usage today">
        {!usage ? (
          <Spinner />
        ) : (
          <div className="space-y-4">
            <Meter label="Questions asked" used={usage.today.questions} limit={usage.limits.userDailyQuestions} unit="questions" />
            <Meter label="Tokens processed" used={usage.today.tokens} limit={usage.limits.userDailyTokens} unit="tokens" />
            <Meter label="Passages indexed for meaning" used={usage.today.passagesEmbedded} limit={usage.limits.userDailyEmbedPassages} unit="passages" />
            <p className="text-sm text-ink-3">
              {usage.notes.join(" ")}
              {usage.today.callsWithoutTokenCount > 0 ? ` ${usage.today.callsWithoutTokenCount} call${usage.today.callsWithoutTokenCount === 1 ? "" : "s"} today returned no token count, so the token total is a lower bound.` : ""}
            </p>
            {usage.history.length > 0 ? (
              <div>
                <button className="text-sm text-ink-2 underline underline-offset-2 hover:text-ink" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
                  {showHistory ? "Hide" : "Show"} recent calls ({usage.history.length})
                </button>
                {showHistory ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[30rem] text-sm">
                      <thead>
                        <tr className="border-b border-rule-strong text-left text-ink-3">
                          <th scope="col" className="py-1.5 pr-3 font-medium">When</th>
                          <th scope="col" className="py-1.5 pr-3 font-medium">Step</th>
                          <th scope="col" className="py-1.5 pr-3 font-medium">For</th>
                          <th scope="col" className="py-1.5 pr-3 text-right font-medium">Items</th>
                          <th scope="col" className="py-1.5 text-right font-medium">Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usage.history.map((h, i) => (
                          <tr key={i} className="border-b border-rule">
                            <td className="py-1.5 pr-3 text-ink-2">{formatDateTime(h.createdAt)}</td>
                            <td className="py-1.5 pr-3">{h.kind === "chat" ? "Answer" : h.kind === "embedding" ? "Embedding" : "Reranking"}{h.status === "error" ? " (failed)" : ""}</td>
                            <td className="py-1.5 pr-3 text-ink-2">{h.purpose === "index" ? "Indexing" : h.purpose === "ask" ? "A question" : "A search"}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{h.units}</td>
                            <td className="py-1.5 text-right tabular-nums">{h.totalTokens === null ? <span className="text-ink-3">not reported</span> : h.totalTokens.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </Block>

      <Block id="ai" title="Private AI">
        {me.near.configured ? (
          <p className="text-ink-2">Connected to NEAR AI Cloud. Every model below is verified with hardware attestation before Morrow sends it anything. You can re-run that check in the <Link href="/privacy" className="link">Privacy Center</Link>.</p>
        ) : (
          <div className="rounded-md border border-[#e3d08e] bg-amber-soft px-4 py-3.5 text-ink-2">
            <p className="font-medium text-ink">Not connected. Asking questions and searching by meaning are switched off.</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Create an API key at <a className="link" href="https://cloud.near.ai" target="_blank" rel="noopener noreferrer">cloud.near.ai</a>.</li>
              <li>On the machine running Morrow, add <Mono>NEARAI_API_KEY=…</Mono> to the file <Mono>.env.local</Mono>.</li>
              <li>Restart Morrow. Existing documents are indexed for meaning automatically.</li>
            </ol>
            <p className="mt-2">The key is read by the server only and is never sent to your browser.</p>
          </div>
        )}
        <dl className="mt-4 grid gap-y-1.5 sm:grid-cols-[7rem_1fr]">
          <dt className="text-ink-3">Endpoint</dt>
          <dd><Mono>{me.near.baseUrl}</Mono></dd>
          <dt className="text-ink-3">Answers</dt>
          <dd><Mono>{me.near.chatModel}</Mono></dd>
          <dt className="text-ink-3">Embeddings</dt>
          <dd><Mono>{me.near.embeddingModel}</Mono></dd>
          <dt className="text-ink-3">Reranking</dt>
          <dd><Mono>{me.near.rerankModel}</Mono></dd>
        </dl>
        <p className="mt-3 text-sm text-ink-3">Models are chosen by whoever runs this server, through environment variables. Morrow refuses any model that does not return verifiable enclave evidence.</p>
      </Block>

      <Block id="limits" title="Limits">
        <p className="text-ink-2">Files up to {me.limits.maxUploadMb} MB. PDFs up to {me.limits.maxPdfPages} pages. Accepted formats: PDF with a text layer, plain text, Markdown.</p>
      </Block>

      <Block id="data" title="Your data">
        <p className="text-ink-2">Download everything Morrow stores for you as one JSON file: document text, collections, tags, saved answers and the activity log.</p>
        <a href="/api/export" download className="btn btn-quiet mt-3">
          <Download size={15} aria-hidden /> Export my data
        </a>
      </Block>

      <Block id="danger" title="Delete account">
        <p className="text-ink-2">Permanently removes your account, every document, all passages and embeddings, saved answers, receipts and sessions from this server.</p>
        <button className="btn btn-danger mt-3" onClick={() => setConfirm(true)}>
          <Trash2 size={15} aria-hidden /> Delete my account and library
        </button>
      </Block>

      <Modal open={confirm} onClose={() => (setConfirm(false), setPassword(""), setError(null))} title="Delete everything?">
        <form onSubmit={deleteAccount}>
          <p className="text-ink-2">This removes your whole library from this server and cannot be undone. Enter your password to confirm.</p>
          <label htmlFor="confirm-pw" className="mb-1.5 mt-4 block text-sm font-medium">
            Password
          </label>
          <input id="confirm-pw" type="password" autoComplete="current-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error ? <div className="mt-3"><ErrorNote>{error}</ErrorNote></div> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn btn-quiet" onClick={() => setConfirm(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-danger" disabled={busy || !password}>
              {busy ? <Spinner /> : "Delete permanently"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
