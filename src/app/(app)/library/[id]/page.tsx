"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, MessageSquareText, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { api, ApiError, formatBytes, formatDateTime, KIND_LABEL, sourceHref, type Collection, type Doc } from "@/lib/client/api";
import { ErrorNote, Modal, Spinner, useToast } from "@/components/ui";
import { IndexBadge } from "@/components/index-badge";

type Page = { page: number; text: string };
type Passage = { id: number; page: number; heading: string | null; start: number; end: number };
type Connection = {
  documentId: string;
  title: string;
  basis: "meaning" | "terms";
  strength: number;
  sharedTags: string[];
  here: { chunkId: number; page: number; text: string } | null;
  there: { chunkId: number; page: number; text: string } | null;
};

function clip(s: string, n = 190): string {
  const t = s.replace(/^#{1,6}\s+/gm, "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n).trimEnd() + "…" : t;
}

function Viewer() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const passageId = Number(params.get("passage")) || null;
  const pageParam = Number(params.get("page")) || null;

  const [doc, setDoc] = useState<Doc | null>(null);
  const [impact, setImpact] = useState(0);
  const [pages, setPages] = useState<Page[] | null>(null);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [view, setView] = useState<"text" | "original">("text");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const markRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, p, c] = await Promise.all([
        api<{ document: Doc; deletionImpact: { answers: number } }>(`/api/documents/${id}`),
        api<{ pages: Page[]; chunks: Passage[] }>(`/api/documents/${id}/pages`),
        api<{ collections: Collection[] }>("/api/collections"),
      ]);
      setDoc(d.document);
      setImpact(d.deletionImpact.answers);
      setPages(p.pages);
      setPassages(p.chunks);
      setCollections(c.collections);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? { status: e.status, message: e.message } : { status: 0, message: "Could not load this document." });
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void load();
  }, [load]);

  const semantic = doc?.semantic;
  useEffect(() => {
    api<{ connections: Connection[] }>(`/api/documents/${id}/related`)
      .then((r) => setConnections(r.connections))
      .catch(() => setConnections([]));
  }, [id, semantic]);

  useEffect(() => {
    if (semantic !== "pending") return;
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [semantic, load]);

  const target = useMemo(() => passages.find((p) => p.id === passageId) || null, [passages, passageId]);

  // Bring the cited passage (or the requested page) into view once the text is rendered.
  useEffect(() => {
    if (!pages || view !== "text") return;
    const el = markRef.current || (pageParam ? document.getElementById(`page-${pageParam}`) : null);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [pages, view, target, pageParam]);

  async function patch(body: Record<string, unknown>, done?: string) {
    try {
      const r = await api<{ document: Doc }>(`/api/documents/${id}`, { method: "PATCH", json: body });
      setDoc(r.document);
      if (done) toast("ok", done);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Could not save the change.");
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      const r = await api<{ deletedAnswers: number }>(`/api/documents/${id}`, { method: "DELETE" });
      toast("ok", `Deleted${r.deletedAnswers ? ` along with ${r.deletedAnswers} saved answer${r.deletedAnswers === 1 ? "" : "s"} that quoted it` : ""}.`);
      router.replace("/library");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Could not delete the document.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function retry() {
    try {
      await api(`/api/documents/${id}/retry`, { method: "POST" });
      await load();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Could not restart indexing.");
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl py-16">
        <Link href="/library" className="btn btn-ghost mb-4 -ml-2">
          <ArrowLeft size={15} aria-hidden /> Library
        </Link>
        {error.status === 404 ? (
          <div className="sheet px-8 py-12 text-center">
            <p className="display text-2xl">This document is not in your library.</p>
            <p className="mt-2 text-ink-2">It may have been deleted. Citations to deleted documents are removed with them.</p>
          </div>
        ) : (
          <ErrorNote onRetry={() => void load()}>{error.message}</ErrorNote>
        )}
      </div>
    );
  }
  if (!doc || !pages) {
    return (
      <div className="py-24 text-center">
        <Spinner label="Opening document" />
      </div>
    );
  }

  const isPdf = doc.kind === "pdf";
  const openPage = target?.page || pageParam || 1;

  return (
    <div>
      <Link href="/library" className="btn btn-ghost -ml-2 mb-3">
        <ArrowLeft size={15} aria-hidden /> Library
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {renaming !== null ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (renaming.trim()) void patch({ title: renaming }, "Title updated.");
                setRenaming(null);
              }}
            >
              <label htmlFor="title" className="sr-only">
                Document title
              </label>
              <input id="title" autoFocus className="field display h-12 text-2xl" maxLength={200} value={renaming} onChange={(e) => setRenaming(e.target.value)} />
              <button className="btn btn-primary h-12">Save</button>
              <button type="button" className="btn btn-quiet h-12" onClick={() => setRenaming(null)}>
                Cancel
              </button>
            </form>
          ) : (
            <h1 className="display text-[1.9rem] md:text-[2.3rem]">
              {doc.title}{" "}
              <button className="btn btn-ghost inline-flex h-7 px-1.5 align-middle" aria-label="Rename document" onClick={() => setRenaming(doc.title)}>
                <Pencil size={14} aria-hidden />
              </button>
            </h1>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
            <span>{KIND_LABEL[doc.kind]}</span>
            {isPdf ? <span>{doc.pageCount} pages</span> : null}
            <span>{doc.wordCount.toLocaleString()} words</span>
            <IndexBadge doc={doc} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/ask?doc=${doc.id}`} className="btn btn-primary">
            <MessageSquareText size={15} aria-hidden /> Ask about this
          </Link>
        </div>
      </header>

      {target ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#e3d08e] bg-amber-soft px-4 py-2.5 text-sm">
          <span>
            Showing the cited passage{isPdf ? ` on page ${target.page}` : ""}
            {target.heading ? `, under “${clip(target.heading, 60)}”` : ""}.
          </span>
          <Link href={`/library/${doc.id}`} className="btn btn-ghost h-7" replace>
            <X size={14} aria-hidden /> Clear highlight
          </Link>
        </div>
      ) : null}

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_290px]">
        <section aria-label="Document content" className="min-w-0">
          {isPdf ? (
            <div role="tablist" aria-label="View" className="mb-4 inline-flex rounded-md border border-rule-strong p-0.5 text-sm">
              {(["text", "original"] as const).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded px-3 py-1 ${view === v ? "bg-ink text-surface" : "text-ink-2 hover:bg-sunk"}`}>
                  {v === "text" ? "Extracted text" : "Original PDF"}
                </button>
              ))}
            </div>
          ) : null}

          {view === "original" && isPdf ? (
            <div>
              <iframe key={openPage} title={`Original PDF, page ${openPage}`} src={`/api/documents/${doc.id}/file#page=${openPage}`} className="sheet h-[78vh] w-full" />
              <p className="mt-2 text-xs text-ink-3">The original file, opened at page {openPage} in your browser&apos;s own PDF viewer.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {pages.map((p) => {
                const hit = target && target.page === p.page ? target : null;
                return (
                  <article key={p.page} id={`page-${p.page}`} aria-label={isPdf ? `Page ${p.page}` : "Document text"} className="sheet scroll-mt-6 px-6 py-7 md:px-10 md:py-9">
                    {isPdf || pages.length > 1 ? <p className="eyebrow mb-4">Page {p.page}</p> : null}
                    <div className="reading whitespace-pre-wrap break-words">
                      {hit ? (
                        <>
                          {p.text.slice(0, hit.start)}
                          <mark ref={markRef} className="passage">
                            {p.text.slice(hit.start, hit.end)}
                          </mark>
                          {p.text.slice(hit.end)}
                        </>
                      ) : (
                        p.text || <span className="text-ink-3">This page has no extractable text.</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-8 text-sm lg:sticky lg:top-8 lg:self-start">
          <section aria-labelledby="conn-h">
            <h2 id="conn-h" className="eyebrow mb-3">
              Connected documents
            </h2>
            {connections === null ? (
              <Spinner />
            ) : connections.length === 0 ? (
              <p className="text-ink-3">{doc.semantic === "pending" ? "Connections appear once indexing finishes." : "Nothing else in your library overlaps with this document yet."}</p>
            ) : (
              <ul className="space-y-4">
                {connections.map((c) => (
                  <li key={c.documentId} className="border-l-2 border-rule-strong pl-3">
                    <Link href={c.there ? sourceHref({ documentId: c.documentId, page: c.there.page, chunkId: c.there.chunkId }) : `/library/${c.documentId}`} className="display block text-[1.05rem] leading-snug hover:text-moss">
                      {c.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-ink-3">
                      {c.basis === "meaning" ? `Similar meaning · ${Math.round(c.strength * 100)}%` : "Shares distinctive terms"}
                      {c.sharedTags.length ? ` · both tagged ${c.sharedTags.join(", ")}` : ""}
                    </p>
                    {c.there ? <p className="mt-1.5 text-[0.82rem] leading-relaxed text-ink-2">“{clip(c.there.text)}”</p> : null}
                    {c.here ? (
                      <Link href={sourceHref({ documentId: doc.id, page: c.here.page, chunkId: c.here.chunkId })} className="link mt-1 inline-block text-xs" replace>
                        Show the matching passage here
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="tags-h">
            <h2 id="tags-h" className="eyebrow mb-2.5">
              Tags
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {doc.tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-sunk py-0.5 pl-2.5 pr-1 text-xs">
                  {t}
                  <button aria-label={`Remove tag ${t}`} className="rounded-full p-0.5 text-ink-3 hover:text-clay" onClick={() => void patch({ tags: doc.tags.filter((x) => x !== t) })}>
                    <X size={12} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
            <form
              className="mt-2.5 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!tagDraft.trim()) return;
                void patch({ tags: [...doc.tags, tagDraft] });
                setTagDraft("");
              }}
            >
              <label htmlFor="tag" className="sr-only">
                Add a tag
              </label>
              <input id="tag" className="field h-8 text-sm" placeholder="Add a tag" maxLength={32} value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} />
              <button className="btn btn-quiet h-8" disabled={!tagDraft.trim()}>
                Add
              </button>
            </form>
          </section>

          <section aria-labelledby="cols-h">
            <h2 id="cols-h" className="eyebrow mb-2.5">
              Collections
            </h2>
            {collections.length === 0 ? (
              <p className="text-ink-3">
                No collections yet. Create one from the <Link href="/library" className="link">library</Link>.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {collections.map((c) => {
                  const on = doc.collections.includes(c.id);
                  return (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="checkbox" className="h-4 w-4 accent-[#2f4a3a]" checked={on} onChange={() => void patch({ collections: on ? doc.collections.filter((x) => x !== c.id) : [...doc.collections, c.id] })} />
                        {c.name}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="det-h">
            <h2 id="det-h" className="eyebrow mb-2.5">
              Details
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-ink-2">
              <dt className="text-ink-3">File</dt>
              <dd className="break-all">{doc.filename}</dd>
              <dt className="text-ink-3">Size</dt>
              <dd>{formatBytes(doc.sizeBytes)}</dd>
              <dt className="text-ink-3">Added</dt>
              <dd>{formatDateTime(doc.createdAt)}</dd>
              <dt className="text-ink-3">Passages</dt>
              <dd>{doc.chunkCount}</dd>
              {doc.meta.author ? (
                <>
                  <dt className="text-ink-3">Author</dt>
                  <dd>{doc.meta.author}</dd>
                </>
              ) : null}
            </dl>
            {doc.semantic === "failed" || doc.semantic === "unavailable" ? (
              <div className="mt-3 rounded-md border border-rule bg-surface p-3 text-[0.82rem] text-ink-2">
                <p>{doc.semantic === "failed" ? doc.error || "The meaning index could not be built." : "Only the local keyword index exists because NEAR AI Cloud is not configured."}</p>
                {doc.semantic === "failed" ? (
                  <button className="btn btn-quiet mt-2 h-8" onClick={retry}>
                    <RefreshCw size={13} aria-hidden /> Retry indexing
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noopener" className="btn btn-quiet h-8" download={!isPdf ? doc.filename : undefined}>
                <Download size={13} aria-hidden /> Original
              </a>
              <button className="btn btn-danger h-8" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} aria-hidden /> Delete
              </button>
            </div>
          </section>
        </aside>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this document?">
        <p className="text-ink-2">
          “{doc.title}” will be permanently removed from this Morrow server: the original file, its extracted pages, {doc.chunkCount} passages, their embeddings and search index entries.
          {impact > 0 ? ` ${impact} saved answer${impact === 1 ? "" : "s"} that quote it will be deleted too.` : ""} This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-quiet" onClick={() => setConfirmDelete(false)} disabled={deleting}>
            Keep it
          </button>
          <button className="btn btn-danger" onClick={remove} disabled={deleting}>
            {deleting ? <Spinner /> : "Delete permanently"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

export default function DocumentPage() {
  return (
    <Suspense fallback={<Spinner label="Opening document" />}>
      <Viewer />
    </Suspense>
  );
}
