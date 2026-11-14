"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { api, ApiError, formatBytes, formatDateTime, short, type AttestationSummary } from "@/lib/client/api";
import { ErrorNote, Mono, Note, PageHeader, Spinner } from "@/components/ui";

type Privacy = {
  inventory: { documents: number; originalBytes: number; pages: number; passages: number; embeddedPassages: number; savedAnswers: number; collections: number; sessions: number };
  activity: { kind: string; detail: string; createdAt: number }[];
  storage: { dataDir: string; databaseBytes: number; encryptedAtRest: boolean; databaseEncrypted: boolean; dataDirMode: string; databaseMode: string };
  near: { configured: boolean; baseUrl: string; chatModel: string; embeddingModel: string; rerankModel: string; attestationTtlMinutes: number };
};
type VerifyResult = { role: string; model: string; ms: number } & ({ ok: true; attestation: AttestationSummary } | { ok: false; error: { code: string; message: string; failure: string | null } });

function Section({ id, title, children, lede }: { id: string; title: string; lede?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rule pt-8">
      <h2 id={id} className="display text-[1.55rem]">
        {title}
      </h2>
      {lede ? <p className="mt-1.5 max-w-2xl text-ink-2">{lede}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  const [data, setData] = useState<Privacy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [results, setResults] = useState<{ checkedAt: number; results: VerifyResult[] } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Privacy>("/api/privacy")
      .then((d) => (setData(d), setError(null)))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load privacy information."));
  }, []);
  useEffect(load, [load]);

  async function verify() {
    setVerifying(true);
    setVerifyError(null);
    try {
      setResults(await api("/api/privacy/verify", { method: "POST" }));
    } catch (e) {
      setVerifyError(e instanceof ApiError ? e.message : "Verification could not be run.");
    }
    setVerifying(false);
  }

  if (error) return <ErrorNote onRetry={load}>{error}</ErrorNote>;
  if (!data) return <Spinner label="Loading" />;
  const { inventory: inv, near } = data;

  const flow: { stage: string; where: string; sent: string; protection: string; tee: boolean }[] = [
    { stage: "Upload and storage", where: "This Morrow server", sent: "The original file, from your browser to this server", protection: data.storage.encryptedAtRest ? "Stored in your own folder on the server, encrypted with AES-256-GCM under a key derived for your account. The database of extracted text is not encrypted." : "Stored in your own folder on the server, readable only by the server's operating-system user. Not encrypted at rest: this server has no encryption key configured.", tee: false },
    { stage: "Reading the file", where: "This Morrow server", sent: "Nothing leaves the server", protection: "Text is extracted locally. Files are parsed as data and never executed or rendered server-side.", tee: false },
    { stage: "Keyword index", where: "This Morrow server", sent: "Nothing leaves the server", protection: "A local full-text index in the same database.", tee: false },
    { stage: "Meaning index", where: `NEAR AI Cloud · ${near.embeddingModel}`, sent: "The text of each passage, with the document title and section heading", protection: "Sent only after the gateway and model enclaves are verified, over a TLS key bound to the gateway's attestation.", tee: true },
    { stage: "Searching by meaning", where: `NEAR AI Cloud · ${near.embeddingModel}`, sent: "Your search query or question", protection: "Same verification and TLS pinning as above.", tee: true },
    { stage: "Reranking", where: `NEAR AI Cloud · ${near.rerankModel}`, sent: "Your question and up to 24 candidate passages", protection: "Same verification and TLS pinning as above.", tee: true },
    { stage: "Writing the answer", where: `NEAR AI Cloud · ${near.chatModel}`, sent: "Your question and up to 8 passages", protection: "End-to-end encrypted to the model enclave's attested key. The enclave signs the response and Morrow checks the signature before showing it.", tee: true },
    { stage: "Saved answers and receipts", where: "This Morrow server", sent: "Nothing leaves the server", protection: "The answer, quoted passages and attestation evidence are stored locally until you delete them.", tee: false },
  ];

  return (
    <div className="max-w-4xl space-y-10">
      <PageHeader title="Privacy Center" lede="Exactly what Morrow stores, what leaves this server, who processes it, and what has actually been verified. Nothing here is a promise that the code does not keep." />

      <div className={`flex items-start gap-3 rounded-md border px-4 py-3.5 ${near.configured ? "border-[#c5d3c2] bg-moss-soft/60" : "border-[#e3d08e] bg-amber-soft"}`}>
        {near.configured ? <ShieldCheck size={20} className="mt-0.5 shrink-0 text-moss" aria-hidden /> : <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-ink" aria-hidden />}
        <div className="text-sm">
          <p className="font-medium text-ink">{near.configured ? "Private AI is connected." : "Private AI is not connected."}</p>
          <p className="mt-0.5 text-ink-2">
            {near.configured
              ? "Document text and questions are sent only to NEAR AI Cloud models whose hardware enclaves pass verification. If verification fails, the request is not sent."
              : "No document text or question has left this server. Only local keyword search is available. You can still run the live enclave verification below: it needs no key and sends no data."}
          </p>
        </div>
      </div>

      <Section id="flow" title="Where your information goes" lede="Each step, in the order it happens. Steps marked as enclave run inside a Trusted Execution Environment that Morrow verifies first; the others run on this server.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule-strong text-left text-ink-3">
                <th scope="col" className="w-[17%] py-2 pr-4 font-medium">Step</th>
                <th scope="col" className="w-[23%] py-2 pr-4 font-medium">Where it runs</th>
                <th scope="col" className="w-[25%] py-2 pr-4 font-medium">What is sent</th>
                <th scope="col" className="py-2 font-medium">Protection in place</th>
              </tr>
            </thead>
            <tbody>
              {flow.map((f) => (
                <tr key={f.stage} className="border-b border-rule align-top">
                  <th scope="row" className="py-3 pr-4 text-left font-medium">{f.stage}</th>
                  <td className="py-3 pr-4 text-ink-2">
                    <span className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide ${f.tee ? "bg-moss-soft text-moss" : "bg-sunk text-ink-2"}`}>{f.tee ? "Enclave" : "Local"}</span>
                    <span className="block break-words">{f.where}</span>
                  </td>
                  <td className="py-3 pr-4 text-ink-2">{f.sent}</td>
                  <td className="py-3 text-ink-2">{f.protection}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-ink-3">Your browser talks only to this Morrow server. It never contacts NEAR AI Cloud or any other third party, and Morrow loads no analytics, fonts or scripts from other sites.</p>
      </Section>

      <Section id="verify" title="Verify the enclaves now" lede="Runs a brand-new check with a fresh random nonce for every model Morrow uses. It contacts NEAR AI Cloud, Intel and NVIDIA for attestation evidence and sends none of your data.">
        <button className="btn btn-primary" onClick={verify} disabled={verifying}>
          {verifying ? <Spinner label="Verifying, about 30 seconds" /> : (<><RefreshCw size={15} aria-hidden /> Run a fresh verification</>)}
        </button>
        <div className="mt-5 space-y-3" aria-live="polite">
          {verifyError ? <ErrorNote>{verifyError}</ErrorNote> : null}
          {results?.results.map((r) => (
            <div key={r.role} className={`rounded-md border px-4 py-3.5 text-sm ${r.ok ? "border-[#c5d3c2] bg-surface" : "border-[#d9b3a9] bg-clay-soft"}`}>
              <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                {r.ok ? <Check size={16} className="text-moss" aria-hidden /> : <X size={16} className="text-clay" aria-hidden />}
                <span className="font-medium">{r.role}</span>
                <Mono>{r.model}</Mono>
                <span className={`ml-auto ${r.ok ? "text-moss" : "text-clay"}`}>{r.ok ? `Verified in ${(r.ms / 1000).toFixed(1)}s` : "Not verified"}</span>
              </p>
              {r.ok ? (
                <dl className="mt-3 grid gap-x-4 gap-y-1 text-[0.82rem] sm:grid-cols-[11rem_1fr]">
                  <dt className="text-ink-3">Fresh nonce</dt>
                  <dd><Mono title={r.attestation.gateway.nonce}>{short(r.attestation.gateway.nonce, 16, 8)}</Mono></dd>
                  <dt className="text-ink-3">Gateway enclave</dt>
                  <dd>Intel TDX quote valid, TCB {r.attestation.gateway.tcbStatus} · signer <Mono>{short(r.attestation.gateway.signingAddress)}</Mono></dd>
                  <dt className="text-ink-3">Gateway TLS key</dt>
                  <dd>{r.attestation.gateway.tlsSpkiFingerprint ? (<>Bound to the quote · <Mono>{short(r.attestation.gateway.tlsSpkiFingerprint)}</Mono></>) : "Not bound"}</dd>
                  <dt className="text-ink-3">Model enclave</dt>
                  <dd>
                    {r.attestation.models.length} report{r.attestation.models.length === 1 ? "" : "s"} verified, TCB {[...new Set(r.attestation.models.map((m) => m.tcbStatus))].join(", ")} · signer <Mono>{short(r.attestation.models[0]?.signingAddress || "")}</Mono>
                  </dd>
                  <dt className="text-ink-3">GPU evidence</dt>
                  <dd>{r.attestation.models.every((m) => m.gpuEvidence === "verified") ? "NVIDIA attestation verified" : "Not provided by every report"}</dd>
                </dl>
              ) : (
                <p className="mt-2 text-clay">
                  {r.error.message} {r.error.failure ? <Mono>{r.error.failure}</Mono> : null}
                </p>
              )}
            </div>
          ))}
          {results ? <p className="text-xs text-ink-3">Checked {formatDateTime(results.checkedAt)}. During normal use a verification is reused for at most {near.attestationTtlMinutes} minutes, then repeated with a new nonce.</p> : null}
        </div>
      </Section>

      <Section id="stored" title="What this server holds for you" lede="Live counts from the database.">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
          {[
            ["Documents", inv.documents.toLocaleString(), formatBytes(inv.originalBytes) + " of original files"],
            ["Pages of text", inv.pages.toLocaleString(), "extracted and stored"],
            ["Passages", inv.passages.toLocaleString(), `${inv.embeddedPassages.toLocaleString()} with a meaning index`],
            ["Saved answers", inv.savedAnswers.toLocaleString(), "with sources and receipts"],
          ].map(([k, v, sub]) => (
            <div key={k}>
              <dt className="eyebrow">{k}</dt>
              <dd className="display mt-1 text-[1.9rem]">{v}</dd>
              <dd className="text-xs text-ink-3">{sub}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-sm text-ink-2">
          Also stored: your email, a salted scrypt hash of your password, {inv.sessions} active session token hash{inv.sessions === 1 ? "" : "es"}, {inv.collections} collection name{inv.collections === 1 ? "" : "s"}, tags, and the activity log below. Location: <Mono>{data.storage.dataDir}</Mono> ({formatBytes(data.storage.databaseBytes)} database).
        </p>
      </Section>

      <Section id="limits" title="What is not protected" lede="The limits of the current design, stated plainly.">
        <ul className="max-w-3xl list-disc space-y-2.5 pl-5 text-[0.94rem] text-ink-2">
          <li><span className="font-medium text-ink">This server can read your library.</span> Morrow itself does not run in an enclave. Whoever operates this server, or anyone with access to its disk, can read your documents. The strongest setup is to run Morrow on a machine you control.</li>
          <li>
            <span className="font-medium text-ink">{data.storage.encryptedAtRest ? "Only original files and receipts are encrypted at rest." : "Nothing is encrypted at rest by Morrow on this server."}</span>{" "}
            {data.storage.encryptedAtRest ? "The database holding extracted text, passages, embeddings and saved answers is not encrypted, because search has to read it." : "The operator has not configured an encryption key."} Use full-disk encryption on the machine that hosts Morrow. File permissions: data folder {data.storage.dataDirMode}, database {data.storage.databaseMode} (owner-only is 700 and 600).
          </li>
          <li><span className="font-medium text-ink">One AI key is shared by everyone on this server.</span> Daily per-person and server-wide budgets limit how much any account can spend; your own usage is in Settings.</li>
          <li><span className="font-medium text-ink">Your connection to this server</span> is only as private as its deployment. On localhost it never leaves your machine; on a remote host it needs HTTPS.</li>
          <li><span className="font-medium text-ink">NEAR AI Cloud sees metadata.</span> The gateway can observe which API key is used, when, and request sizes. Embedding and reranking requests are protected by enclave verification and pinned TLS but are not additionally end-to-end encrypted or individually signed.</li>
          <li><span className="font-medium text-ink">Retention at NEAR AI Cloud is governed by their terms.</span> Morrow verifies the enclave software and hardware, and cannot independently audit what the provider retains. Morrow makes no zero-retention promise on their behalf; read their <a className="link" href="https://near.ai/terms-and-policies/near-ai-cloud-terms-of-service" target="_blank" rel="noopener noreferrer">terms</a> and <a className="link" href="https://docs.near.ai/cloud/private-inference" target="_blank" rel="noopener noreferrer">private inference documentation</a>.</li>
          <li><span className="font-medium text-ink">Attestation is not a quality check.</span> It shows where and how the model ran, not that the answer is right. That is what citations are for.</li>
          <li><span className="font-medium text-ink">Same model, shared key.</span> Instances of one model share a signing key, so a signature proves a verified enclave for that model signed the response, not which individual machine did.</li>
        </ul>
      </Section>

      <Section id="delete" title="Deleting your information">
        <ul className="max-w-3xl list-disc space-y-2 pl-5 text-[0.94rem] text-ink-2">
          <li><span className="font-medium text-ink">One document:</span> open it in the <Link href="/library" className="link">library</Link> and choose Delete. The original file, extracted pages, passages, embeddings, search index entries and any saved answers quoting it are removed, and freed database pages are overwritten.</li>
          <li><span className="font-medium text-ink">Everything:</span> delete your account in <Link href="/settings" className="link">Settings</Link>. You can export your data there first.</li>
          <li><span className="font-medium text-ink">Not covered:</span> backups or snapshots made outside Morrow by whoever runs this server, and anything retained by NEAR AI Cloud under its own terms.</li>
        </ul>
      </Section>

      <Section id="activity" title="Recent activity" lede="A plain record of what happened to your library on this server. It never contains document text or questions.">
        {data.activity.length === 0 ? (
          <Note>No activity yet.</Note>
        ) : (
          <ul className="divide-y divide-rule text-sm">
            {data.activity.map((a, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-6 py-2">
                <span className="text-ink-2">{a.detail}</span>
                <span className="text-ink-3">{formatDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
