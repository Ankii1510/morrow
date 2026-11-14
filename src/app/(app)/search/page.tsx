"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { api, ApiError, sourceHref, type Hit } from "@/lib/client/api";
import { ErrorNote, PageHeader, Spinner } from "@/components/ui";

type Result = { hits: Hit[]; mode: "hybrid" | "keyword"; notes: string[] };

/** Mark the query's words inside a passage. Pure text manipulation: nothing is rendered as HTML. */
const STOP = new Set("the and for are was were with that this from have has had not but you your its they them their when what where which who why how does did will can could should would about into than then there these those".split(" "));

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].filter((t) => !STOP.has(t)).slice(0, 12);
  if (terms.length === 0) return <>{text}</>;
  // Match from the start of a word so "end" marks "ends" but not "calendar".
  const re = new RegExp(`(?<![\\p{L}\\p{N}])((?:${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[\\p{L}\\p{N}]*)`, "giu");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="term">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** The query lives in the URL fragment (#q=...), which browsers never send to a server, so it stays out of access logs. */
function readHash(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("q") || "";
}

function Search() {
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      const v = readHash();
      setQ(v);
      setDraft(v);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear results when the query is cleared
      setResult(null);
      return;
    }
    let live = true;
    setBusy(true);
    setError(null);
    api<Result>("/api/search", { method: "POST", json: { q } })
      .then((r) => live && setResult(r))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Search failed."))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [q]);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Search" lede="Find the exact passage across everything in your library, by wording and by meaning." />
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const next = draft.trim();
          window.location.hash = next ? `q=${encodeURIComponent(next)}` : "";
          setQ(next);
        }}
      >
        <label htmlFor="q" className="sr-only">
          Search your documents
        </label>
        <div className="relative flex-1">
          <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <input id="q" autoFocus className="field h-11 pl-9" placeholder="e.g. boiler service, deposit return, vitamin D" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} />
        </div>
        <button className="btn btn-primary h-11" disabled={!draft.trim()}>
          Search
        </button>
      </form>

      <div className="mt-7" aria-live="polite">
        {busy ? (
          <Spinner label="Searching" />
        ) : error ? (
          <ErrorNote>{error}</ErrorNote>
        ) : result ? (
          <>
            <p className="mb-4 text-sm text-ink-3">
              {result.hits.length === 0 ? "No passages found" : `${result.hits.length} passage${result.hits.length === 1 ? "" : "s"}`} · {result.mode === "hybrid" ? "matched by wording and meaning" : "matched by wording only"}
              {result.notes.length ? ` · ${result.notes.join(" ")}` : ""}
            </p>
            {result.hits.length === 0 ? (
              <div className="sheet px-6 py-10 text-center text-ink-2">
                <p>Nothing in your library matches “{q}”.</p>
                <p className="mt-1 text-sm">Try fewer or different words{result.mode === "keyword" ? "; keyword search needs the same wording your documents use" : ""}.</p>
              </div>
            ) : (
              <ol className="space-y-3">
                {result.hits.map((h) => (
                  <li key={h.chunkId}>
                    <Link href={sourceHref(h)} className="sheet block px-5 py-4 hover:border-rule-strong">
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <span className="display text-[1.12rem]">{h.title}</span>
                        <span className="text-xs text-ink-3">
                          {h.kind === "pdf" ? `Page ${h.page}` : "Text"}
                          {h.heading && h.heading !== h.title ? ` · ${h.heading}` : ""}
                        </span>
                      </p>
                      <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap break-words text-[0.92rem] leading-relaxed text-ink-2">
                        <Highlight text={h.text} query={q} />
                      </p>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : (
          <p className="text-ink-3">Search looks inside every document. To get a written answer with citations instead, use <Link href="/ask" className="link">Ask</Link>.</p>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return <Search />;
}
