"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Trash2 } from "lucide-react";
import { api, ApiError, formatDateTime, type Answer, type Collection, type Doc, type TagCount } from "@/lib/client/api";
import { useMe } from "@/components/shell";
import { AnswerView } from "@/components/answer";
import { ErrorNote, Modal, Note, PageHeader, Spinner, useToast } from "@/components/ui";

type HistoryItem = { id: string; question: string; grounded: boolean; createdAt: number };

const STARTERS = ["What deadlines or renewal dates should I know about?", "Summarise what my documents say about costs and fees.", "Do any of my documents disagree with each other?"];

function Ask() {
  const { me } = useMe();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const answerId = params.get("a");
  const docParam = params.get("doc");

  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<string>(docParam ? `doc:${docParam}` : "all");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [removing, setRemoving] = useState<HistoryItem | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const loadHistory = useCallback(() => api<{ answers: HistoryItem[] }>("/api/answers").then((r) => setHistory(r.answers)).catch(() => {}), []);

  useEffect(() => {
    void loadHistory();
    api<{ documents: Doc[] }>("/api/documents").then((r) => setDocs(r.documents)).catch(() => {});
    api<{ collections: Collection[]; tags: TagCount[] }>("/api/collections").then((r) => (setCollections(r.collections), setTags(r.tags))).catch(() => {});
  }, [loadHistory]);

  useEffect(() => {
    if (!answerId) return;
    let live = true;
    api<{ answer: Answer }>(`/api/answers/${answerId}`)
      .then((r) => live && (setAnswer(r.answer), setError(null)))
      .catch((e) => live && setError(e instanceof ApiError ? e : null));
    return () => {
      live = false;
    };
  }, [answerId]);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy]);

  async function submit(text: string) {
    const q = text.trim();
    if (q.length < 3 || busy) return;
    setBusy(true);
    setElapsed(0);
    setError(null);
    setAnswer(null);
    const body: { question: string; scope: Record<string, unknown> } = { question: q, scope: {} };
    if (scope.startsWith("doc:")) body.scope.documentIds = [scope.slice(4)];
    if (scope.startsWith("col:")) body.scope.collectionId = scope.slice(4);
    if (scope.startsWith("tag:")) body.scope.tag = scope.slice(4);
    try {
      const r = await api<{ answer: Answer }>("/api/ask", { method: "POST", json: body });
      setAnswer(r.answer);
      setQuestion("");
      if (r.answer.outcome !== "no_sources") {
        router.replace(`/ask?a=${r.answer.id}`, { scroll: false });
        void loadHistory();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "error", "Something went wrong."));
    }
    setBusy(false);
  }

  async function removeAnswer() {
    if (!removing) return;
    try {
      await api(`/api/answers/${removing.id}`, { method: "DELETE" });
      toast("ok", "Saved answer deleted.");
      if (answer?.id === removing.id) {
        setAnswer(null);
        router.replace("/ask");
      }
      setRemoving(null);
      void loadHistory();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Could not delete the answer.");
    }
  }

  const empty = docs.length === 0;

  return (
    <div className="grid gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_250px]">
      <div className="min-w-0 max-w-3xl">
        <PageHeader title="Ask Morrow" lede="Answers come only from your documents, with a citation for every claim. When your documents do not say, Morrow tells you." />

        {!me.near.configured ? (
          <div className="mb-6">
            <Note tone="amber">
              <p className="font-medium text-ink">Asking needs a private AI connection.</p>
              <p className="mt-1">
                This Morrow server has no NEAR AI Cloud key, so it will not generate answers. It never falls back to a non-private model. Keyword <Link href="/search" className="link">search</Link> works without it. <Link href="/settings" className="link">How to connect</Link>.
              </p>
            </Note>
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(question);
          }}
          className="sheet p-3 focus-within:border-rule-strong"
        >
          <label htmlFor="question" className="sr-only">
            Your question
          </label>
          <textarea
            id="question"
            ref={box}
            rows={2}
            maxLength={2000}
            className="reading block w-full resize-none bg-transparent px-2 py-1.5 placeholder:text-ink-3 focus:outline-none"
            placeholder={empty ? "Add a document to your library first" : "Ask a question about your documents"}
            value={question}
            disabled={busy}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit(question);
              }
            }}
          />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-rule px-1 pt-2.5">
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="scope" className="text-ink-3">
                Look in
              </label>
              <select id="scope" className="max-w-[15rem] rounded border border-rule-strong bg-surface px-2 py-1 text-sm" value={scope} onChange={(e) => setScope(e.target.value)} disabled={busy}>
                <option value="all">My whole library</option>
                {collections.length > 0 ? (
                  <optgroup label="Collections">
                    {collections.map((c) => (
                      <option key={c.id} value={`col:${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {tags.length > 0 ? (
                  <optgroup label="Tags">
                    {tags.map((t) => (
                      <option key={t.tag} value={`tag:${t.tag}`}>
                        #{t.tag}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {docs.length > 0 ? (
                  <optgroup label="One document">
                    {docs.map((d) => (
                      <option key={d.id} value={`doc:${d.id}`}>
                        {d.title}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy || question.trim().length < 3 || !me.near.configured || empty}>
              Ask <ArrowUp size={15} aria-hidden />
            </button>
          </div>
        </form>

        <div className="mt-8" aria-live="polite">
          {busy ? (
            <div className="sheet px-5 py-5">
              <Spinner label={`Working · ${elapsed}s`} />
              <p className="mt-2 text-sm text-ink-2">Finding passages in your library, verifying the enclave&apos;s attestation, generating the answer inside it, then checking its signature. The first question after a pause takes longest because the attestation is checked afresh.</p>
            </div>
          ) : error ? (
            <ErrorNote onRetry={error.code === "near_not_configured" || !question ? undefined : () => void submit(question)}>
              <p className="font-medium">{error.code === "verification_failed" ? "Morrow stopped because verification failed." : "No answer was produced."}</p>
              <p className="mt-0.5">{error.message}</p>
              {error.code === "verification_failed" ? <p className="mt-1">This is deliberate: Morrow does not show answers it cannot tie to a verified enclave.</p> : null}
            </ErrorNote>
          ) : answer ? (
            <AnswerView key={answer.id} answer={answer} />
          ) : empty ? (
            <Note>
              Your library is empty. <Link href="/library" className="link">Add a document</Link> and come back to ask about it.
            </Note>
          ) : (
            <section aria-labelledby="starters">
              <h2 id="starters" className="eyebrow mb-3">
                Try asking
              </h2>
              <ul className="space-y-2">
                {STARTERS.map((s) => (
                  <li key={s}>
                    <button className="reading w-full rounded-md border border-rule bg-surface px-4 py-2.5 text-left text-[1.02rem] hover:border-rule-strong hover:bg-paper" onClick={() => (setQuestion(s), box.current?.focus())}>
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <aside aria-labelledby="hist-h" className="text-sm xl:pt-3">
        <h2 id="hist-h" className="eyebrow mb-3">
          Saved answers
        </h2>
        {history.length === 0 ? (
          <p className="text-ink-3">Answers are saved on this Morrow server with their sources and verification evidence, so you can return to them.</p>
        ) : (
          <ul className="space-y-0.5">
            {history.map((h) => (
              <li key={h.id} className="group flex items-start">
                <Link href={`/ask?a=${h.id}`} scroll={false} aria-current={answer?.id === h.id ? "true" : undefined} className={`min-w-0 flex-1 rounded px-2 py-1.5 ${answer?.id === h.id ? "bg-sunk" : "hover:bg-sunk/60"}`}>
                  <span className="line-clamp-2 leading-snug">{h.question}</span>
                  <span className="text-xs text-ink-3">
                    {formatDateTime(h.createdAt)}
                    {h.grounded ? "" : " · not answered"}
                  </span>
                </Link>
                <button className="ml-0.5 mt-1 rounded p-1 text-ink-3 opacity-0 hover:text-clay focus-visible:opacity-100 group-hover:opacity-100" aria-label={`Delete saved answer: ${h.question}`} onClick={() => setRemoving(h)}>
                  <Trash2 size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title="Delete this saved answer?">
        <p className="text-ink-2">The question, the answer, its quoted passages and its verification receipt will be removed from this server.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-quiet" onClick={() => setRemoving(null)}>
            Keep it
          </button>
          <button className="btn btn-danger" onClick={removeAnswer}>
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}

export default function AskPage() {
  return (
    <Suspense fallback={<Spinner label="Loading" />}>
      <Ask />
    </Suspense>
  );
}
