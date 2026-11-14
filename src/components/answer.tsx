"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Download, ExternalLink, ShieldCheck } from "lucide-react";
import { short, sourceHref, type Answer, type AttestationSummary, type Source } from "@/lib/client/api";
import { Mono, Note } from "./ui";

/** Render answer text with citation markers as buttons. No HTML from the model is ever injected. */
function AnswerText({ text, active, onCite, valid }: { text: string; active: number | null; onCite: (n: number) => void; valid: Set<number> }) {
  const inline = (s: string, key: string) =>
    s.split(/(\[[\d]{1,3}\]|\*\*[^*]+\*\*)/g).map((part, i) => {
      const c = /^\[(\d{1,3})\]$/.exec(part);
      if (c && valid.has(Number(c[1]))) {
        const n = Number(c[1]);
        return (
          <button key={`${key}-${i}`} className="cite" aria-pressed={active === n} aria-label={`Source ${n}`} onClick={() => onCite(n)}>
            {n}
          </button>
        );
      }
      const b = /^\*\*([^*]+)\*\*$/.exec(part);
      if (b) return <strong key={`${key}-${i}`}>{b[1]}</strong>;
      return <span key={`${key}-${i}`}>{part}</span>;
    });

  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (list.length) {
      const items = list;
      blocks.push(
        <ul key={`l${k}`} className="my-3 list-disc space-y-1.5 pl-6">
          {items.map((li, i) => (
            <li key={i}>{inline(li, `l${k}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  text.split("\n").forEach((line, i) => {
    const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (m) list.push(m[1]);
    else {
      flush(i);
      if (line.trim()) blocks.push(<p key={`p${i}`} className="my-3 first:mt-0">{inline(line.replace(/^#+\s*/, ""), `p${i}`)}</p>);
    }
  });
  flush(-1);
  return <div className="reading">{blocks}</div>;
}

function SourceCard({ s, active }: { s: Source; active: boolean }) {
  const [open, setOpen] = useState(false);
  const long = s.text.length > 320;
  return (
    <li id={`source-${s.n}`} className={`scroll-mt-24 rounded-md border px-4 py-3.5 transition-colors ${active ? "border-[#d9c26e] bg-amber-soft" : "border-rule bg-surface"}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-5 min-w-5 place-items-center rounded px-1 text-[0.72rem] font-semibold ${s.cited ? "bg-amber text-amber-ink" : "bg-sunk text-ink-3"}`}>{s.n}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="display text-[1.08rem] leading-snug">{s.title}</span>
            <span className="text-xs text-ink-3">
              {s.kind === "pdf" ? `Page ${s.page}` : "Text"}
              {s.heading && s.heading !== s.title ? ` · ${s.heading}` : ""}
            </span>
          </p>
          <blockquote className={`mt-2 whitespace-pre-wrap break-words border-l-2 border-rule-strong pl-3 text-[0.9rem] leading-relaxed text-ink-2 ${!open && long ? "line-clamp-4" : ""}`}>{s.text}</blockquote>
          {s.flagged ? (
            <p className="mt-2 rounded border border-[#e3d08e] bg-amber-soft px-2.5 py-1.5 text-[0.8rem] text-amber-ink">
              This passage contains text that reads like instructions to an AI. Morrow told the model to treat it as quoted material, not as instructions. Check the answer against the source.
            </p>
          ) : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.82rem]">
            <Link href={sourceHref(s)} className="link inline-flex items-center gap-1">
              Open in document <ExternalLink size={12} aria-hidden />
            </Link>
            {long ? (
              <button className="text-ink-3 underline underline-offset-2 hover:text-ink" onClick={() => setOpen(!open)} aria-expanded={open}>
                {open ? "Show less" : "Show full passage"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function AttRow({ label, a }: { label: string; a: AttestationSummary | null }) {
  if (!a) return null;
  return (
    <tr className="border-t border-rule align-top">
      <th scope="row" className="py-2 pr-4 text-left font-medium">
        {label}
      </th>
      <td className="py-2 pr-4">
        <Mono>{a.model}</Mono>
      </td>
      <td className="py-2 pr-4">{[...new Set(a.models.map((m) => m.tcbStatus))].join(", ") || "none"}</td>
      <td className="py-2">
        <Mono title={a.gateway.nonce}>{short(a.gateway.nonce, 8, 4)}</Mono>
      </td>
    </tr>
  );
}

export function VerificationPanel({ answer }: { answer: Answer }) {
  const v = answer.verification;
  const [open, setOpen] = useState(false);
  if (!v) return null;
  return (
    <section aria-labelledby={`ver-${answer.id}`} className="rounded-md border border-[#c5d3c2] bg-moss-soft/60">
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={open} aria-controls={`ver-body-${answer.id}`} onClick={() => setOpen(!open)}>
        <ShieldCheck size={18} className="shrink-0 text-moss" aria-hidden />
        <span className="flex-1">
          <span id={`ver-${answer.id}`} className="font-medium text-moss">
            Verified private inference
          </span>
          <span className="block text-[0.82rem] text-ink-2">
            {v.checks.length} checks passed · {v.signatureKind === "provider_tee" ? "signed inside the model enclave" : "signed by the attested gateway"} · end-to-end encrypted
          </span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-ink-2 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div id={`ver-body-${answer.id}`} className="space-y-5 border-t border-[#c5d3c2] px-4 py-4 text-sm">
          <ol className="space-y-2.5">
            {v.checks.map((c) => (
              <li key={c.id} className="flex gap-2.5">
                <span aria-hidden className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-moss text-[0.6rem] text-surface">
                  ✓
                </span>
                <span>
                  <span className="font-medium">{c.label}</span>
                  <span className="block text-[0.84rem] text-ink-2">{c.detail}</span>
                </span>
              </li>
            ))}
          </ol>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-[0.82rem]">
              <caption className="eyebrow pb-1 text-left">Enclaves used for this answer</caption>
              <thead>
                <tr className="text-left text-ink-3">
                  <th scope="col" className="py-1 pr-4 font-normal">Step</th>
                  <th scope="col" className="py-1 pr-4 font-normal">Model</th>
                  <th scope="col" className="py-1 pr-4 font-normal">Intel TCB</th>
                  <th scope="col" className="py-1 font-normal">Nonce</th>
                </tr>
              </thead>
              <tbody>
                <AttRow label="Query embedding" a={v.embedding} />
                <AttRow label="Reranking" a={v.rerank} />
                <AttRow label="Answer" a={v.chat} />
              </tbody>
            </table>
          </div>

          <dl className="grid gap-x-4 gap-y-1.5 text-[0.82rem] sm:grid-cols-[9.5rem_1fr]">
            <dt className="text-ink-3">Response signer</dt>
            <dd><Mono>{v.signer.signingAddress}</Mono> <span className="text-ink-3">({v.signer.signingAlgo})</span></dd>
            <dt className="text-ink-3">Gateway signer</dt>
            <dd><Mono>{v.chat.gateway.signingAddress}</Mono></dd>
            <dt className="text-ink-3">Gateway TLS key</dt>
            <dd><Mono>{v.chat.gateway.tlsSpkiFingerprint}</Mono></dd>
            <dt className="text-ink-3">Request SHA-256</dt>
            <dd><Mono>{v.requestSha256}</Mono></dd>
            <dt className="text-ink-3">Response SHA-256</dt>
            <dd><Mono>{v.responseSha256}</Mono></dd>
            <dt className="text-ink-3">Completion id</dt>
            <dd><Mono>{v.completionId}</Mono></dd>
          </dl>

          <div className="rounded-md border border-rule bg-surface p-3.5">
            <p className="font-medium">Check this yourself</p>
            <p className="mt-1 text-[0.84rem] text-ink-2">The receipt holds the raw Intel TDX quotes, the nonce and the signature, and none of your content. Re-verify it without trusting Morrow:</p>
            <pre className="mt-2 overflow-x-auto rounded bg-sunk px-3 py-2 font-mono text-[0.76rem]">node scripts/verify-receipt.mjs morrow-receipt-{answer.id}.json</pre>
            <a href={`/api/answers/${answer.id}/receipt`} className="btn btn-quiet mt-3 h-8" download>
              <Download size={13} aria-hidden /> Download receipt
            </a>
          </div>
          <p className="text-[0.8rem] text-ink-3">
            What this does not prove: that the answer is correct, or that this Morrow server itself is trustworthy. See the <Link href="/privacy" className="link">Privacy Center</Link>.
          </p>
        </div>
      ) : null}
    </section>
  );
}

export function AnswerView({ answer }: { answer: Answer }) {
  const [active, setActive] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const cited = answer.sources.filter((s) => s.cited);
  const other = answer.sources.filter((s) => !s.cited);
  const valid = new Set(answer.sources.map((s) => s.n));

  function cite(n: number) {
    setActive(n);
    if (!answer.sources.find((s) => s.n === n)?.cited) setShowAll(true);
    requestAnimationFrame(() => document.getElementById(`source-${n}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

  return (
    <article aria-label="Answer" className="space-y-6">
      <h2 className="display text-[1.6rem] md:text-[1.9rem]">{answer.question}</h2>

      {answer.outcome === "no_sources" ? (
        <Note tone="amber">
          <p className="font-medium text-ink">Nothing in your library matches this question.</p>
          <p className="mt-1">Morrow did not call a model, because there was no evidence to give it. Try different wording, widen the scope, or add the document that would contain the answer.</p>
        </Note>
      ) : (
        <>
          {answer.outcome === "insufficient" ? (
            <Note tone="amber">
              <p className="font-medium text-ink">Your documents do not contain enough to answer this.</p>
              {answer.answer ? <p className="mt-1">{answer.answer}</p> : null}
              <p className="mt-1">The passages Morrow checked are listed below so you can judge for yourself.</p>
            </Note>
          ) : answer.outcome === "withheld" ? (
            <Note tone="amber">
              <p className="font-medium text-ink">Morrow withheld this answer.</p>
              <p className="mt-1">The model&apos;s reply repeated Morrow&apos;s internal instructions instead of answering from your documents, which usually means a document contains text designed to manipulate the AI. The passages that were retrieved are listed below.</p>
            </Note>
          ) : (
            <AnswerText text={answer.answer} active={active} onCite={cite} valid={valid} />
          )}
          {answer.outcome === "uncited" ? (
            <Note tone="amber">
              <span className="font-medium text-ink">Treat this answer with caution.</span> The model did not cite any of the retrieved passages, so Morrow cannot show where these statements come from.
            </Note>
          ) : null}
          {answer.retrieval.invalidCitations.length > 0 ? <p className="text-xs text-ink-3">Morrow removed {answer.retrieval.invalidCitations.length} citation marker(s) that did not point to a retrieved passage.</p> : null}
        </>
      )}

      {answer.sources.length > 0 ? (
        <section aria-labelledby={`src-${answer.id}`}>
          <h3 id={`src-${answer.id}`} className="eyebrow mb-3">
            {cited.length > 0 ? `Sources cited (${cited.length})` : "Passages checked"}
          </h3>
          <ul className="space-y-2.5">
            {(cited.length > 0 ? cited : other).map((s) => (
              <SourceCard key={s.n} s={s} active={active === s.n} />
            ))}
          </ul>
          {cited.length > 0 && other.length > 0 ? (
            <div className="mt-3">
              <button className="text-[0.84rem] text-ink-2 underline underline-offset-2 hover:text-ink" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
                {showAll ? "Hide" : "Show"} {other.length} more passage{other.length === 1 ? "" : "s"} that were retrieved but not cited
              </button>
              {showAll ? (
                <ul className="mt-3 space-y-2.5">
                  {other.map((s) => (
                    <SourceCard key={s.n} s={s} active={active === s.n} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <VerificationPanel answer={answer} />

      {answer.retrieval.notes.length > 0 || answer.verification ? (
        <p className="text-xs text-ink-3">
          Retrieval: {answer.retrieval.mode === "hybrid" ? "keyword + meaning" : "keyword only"}
          {answer.retrieval.reranked ? ", reranked" : ""}. {answer.retrieval.notes.join(" ")}
        </p>
      ) : null}
    </article>
  );
}
