"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, FileText, FolderPlus, Plus, Trash2, Upload, X } from "lucide-react";
import { api, ApiError, formatBytes, formatDate, KIND_LABEL, type Collection, type Doc, type TagCount } from "@/lib/client/api";
import { useMe } from "@/components/shell";
import { ErrorNote, Modal, Note, PageHeader, Spinner, useToast } from "@/components/ui";
import { IndexBadge } from "@/components/index-badge";

type UploadItem = { id: number; name: string; state: "uploading" | "done" | "error"; message?: string; documentId?: string };
const ACCEPT = ".pdf,.txt,.text,.md,.markdown";

export default function LibraryPage() {
  const { me } = useMe();
  const toast = useToast();
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [collection, setCollection] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [newCollection, setNewCollection] = useState<string | null>(null);
  const [removeCollection, setRemoveCollection] = useState<Collection | null>(null);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const filterInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const load = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([api<{ documents: Doc[] }>("/api/documents"), api<{ collections: Collection[]; tags: TagCount[] }>("/api/collections")]);
      setDocs(d.documents);
      setCollections(c.collections);
      setTags(c.tags);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your library.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void load();
  }, [load]);

  // While any document is still being embedded, refresh quietly.
  const pending = docs?.some((d) => d.semantic === "pending") ?? false;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [pending, load]);

  // "/" focuses the filter, like most document tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        filterInput.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function uploadFiles(files: File[]) {
    for (const file of files) {
      const id = Date.now() + Math.random();
      setUploads((u) => [...u, { id, name: file.name, state: "uploading" }]);
      const patch = (p: Partial<UploadItem>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x)));
      if (file.size > me.limits.maxUploadMb * 1048576) {
        patch({ state: "error", message: `Larger than the ${me.limits.maxUploadMb} MB limit.` });
        continue;
      }
      try {
        const form = new FormData();
        form.set("file", file);
        const r = await api<{ document: Doc }>("/api/documents", { method: "POST", body: form });
        patch({ state: "done", documentId: r.document.id, message: `${r.document.pageCount} page${r.document.pageCount === 1 ? "" : "s"}, ${r.document.chunkCount} passages` });
      } catch (e) {
        const err = e instanceof ApiError ? e : null;
        patch({ state: "error", message: err?.message || "Upload failed.", documentId: err?.extra.documentId as string | undefined });
      }
      await load();
    }
  }

  async function addSamples() {
    setLoadingSamples(true);
    try {
      const r = await api<{ added: string[]; skipped: string[] }>("/api/samples", { method: "POST" });
      toast("ok", r.added.length ? `Added ${r.added.length} sample document${r.added.length === 1 ? "" : "s"}.` : "The sample documents are already in your library.");
      await load();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Could not add the samples.");
    }
    setLoadingSamples(false);
  }

  async function createCollection(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/collections", { method: "POST", json: { name: newCollection } });
      toast("ok", `Collection "${newCollection?.trim()}" created.`);
      setNewCollection(null);
      await load();
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Could not create the collection.");
    }
  }

  async function deleteCollection() {
    if (!removeCollection) return;
    try {
      await api(`/api/collections/${removeCollection.id}`, { method: "DELETE" });
      toast("ok", `Collection "${removeCollection.name}" removed. Its documents are still in your library.`);
      if (collection === removeCollection.id) setCollection(null);
      setRemoveCollection(null);
      await load();
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Could not remove the collection.");
    }
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (docs || []).filter(
      (d) =>
        (!q || d.title.toLowerCase().includes(q) || d.filename.toLowerCase().includes(q) || d.tags.some((t) => t.includes(q))) &&
        (!collection || d.collections.includes(collection)) &&
        (!tag || d.tags.includes(tag)) &&
        (!kind || d.kind === kind),
    );
  }, [docs, filter, collection, tag, kind]);

  const filtering = Boolean(filter || collection || tag || kind);
  const kinds = [...new Set((docs || []).map((d) => d.kind))];

  return (
    <div
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          dragDepth.current += 1;
          setDragging(true);
        }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void uploadFiles([...e.dataTransfer.files]);
      }}
    >
      <PageHeader
        title="Library"
        lede={docs && docs.length > 0 ? `${docs.length} document${docs.length === 1 ? "" : "s"} · ${docs.reduce((n, d) => n + d.wordCount, 0).toLocaleString()} words you can search and ask about.` : undefined}
        actions={
          <>
            <input ref={fileInput} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => (void uploadFiles([...(e.target.files || [])]), (e.target.value = ""))} />
            <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>
              <Upload size={15} aria-hidden /> Add documents
            </button>
          </>
        }
      />

      {error ? <ErrorNote onRetry={() => void load()}>{error}</ErrorNote> : null}

      {uploads.length > 0 ? (
        <section aria-label="Uploads" className="mb-6 sheet divide-y divide-rule">
          <div className="flex items-center justify-between px-4 py-2.5">
            <h2 className="eyebrow">This session&apos;s uploads</h2>
            <button className="btn btn-ghost h-7 text-xs" onClick={() => setUploads((u) => u.filter((x) => x.state === "uploading"))}>
              Clear
            </button>
          </div>
          <ul aria-live="polite">
            {uploads.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                {u.state === "uploading" ? <Spinner /> : u.state === "done" ? <Check size={16} className="text-moss" aria-hidden /> : <AlertTriangle size={16} className="text-clay" aria-hidden />}
                <span className="min-w-0 flex-1 truncate font-medium">{u.name}</span>
                <span className={`text-right ${u.state === "error" ? "text-clay" : "text-ink-2"}`}>
                  {u.state === "uploading" ? "Reading and indexing…" : u.message}
                  {u.documentId ? (
                    <>
                      {" "}
                      <Link href={`/library/${u.documentId}`} className="link">
                        Open
                      </Link>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {docs === null && !error ? (
        <div className="py-20 text-center">
          <Spinner label="Loading your library" />
        </div>
      ) : docs && docs.length === 0 ? (
        <section className="sheet mx-auto mt-4 max-w-2xl px-8 py-12 text-center">
          <FileText size={26} strokeWidth={1.4} className="mx-auto text-ink-3" aria-hidden />
          <h2 className="display mt-4 text-[1.7rem]">Start with a document you know well</h2>
          <p className="mx-auto mt-2 max-w-md text-ink-2">Drop a PDF, text or Markdown file anywhere on this page. Morrow reads it here, keeps the pages intact, and makes every passage searchable.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2.5">
            <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>
              <Upload size={15} aria-hidden /> Choose files
            </button>
            <button className="btn btn-quiet" onClick={addSamples} disabled={loadingSamples}>
              {loadingSamples ? <Spinner /> : "Add fictional sample documents"}
            </button>
          </div>
          <p className="mt-5 text-xs text-ink-3">PDF, TXT or Markdown · up to {me.limits.maxUploadMb} MB each · scanned PDFs without a text layer are not supported yet</p>
        </section>
      ) : docs ? (
        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[190px_1fr]">
          {/* Organisation rail */}
          <aside className="order-2 space-y-7 text-sm lg:order-1">
            <section aria-labelledby="col-h">
              <div className="mb-2 flex items-center justify-between">
                <h2 id="col-h" className="eyebrow">
                  Collections
                </h2>
                <button className="btn btn-ghost h-6 px-1" aria-label="New collection" title="New collection" onClick={() => setNewCollection("")}>
                  <FolderPlus size={15} aria-hidden />
                </button>
              </div>
              <ul className="space-y-0.5">
                <li>
                  <button aria-pressed={!collection} onClick={() => setCollection(null)} className={`flex w-full justify-between rounded px-2 py-1.5 text-left ${!collection ? "bg-sunk font-medium" : "text-ink-2 hover:bg-sunk/60"}`}>
                    All documents <span className="text-ink-3">{docs.length}</span>
                  </button>
                </li>
                {collections.map((c) => (
                  <li key={c.id} className="group flex items-center">
                    <button aria-pressed={collection === c.id} onClick={() => setCollection(collection === c.id ? null : c.id)} className={`flex min-w-0 flex-1 justify-between gap-2 rounded px-2 py-1.5 text-left ${collection === c.id ? "bg-sunk font-medium" : "text-ink-2 hover:bg-sunk/60"}`}>
                      <span className="truncate">{c.name}</span> <span className="text-ink-3">{c.documentCount}</span>
                    </button>
                    <button className="ml-0.5 rounded p-1 text-ink-3 opacity-0 hover:text-clay focus-visible:opacity-100 group-hover:opacity-100" aria-label={`Remove collection ${c.name}`} onClick={() => setRemoveCollection(c)}>
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              {collections.length === 0 ? <p className="mt-2 px-2 text-xs text-ink-3">Group documents by project or theme. Add a document to a collection from its page.</p> : null}
            </section>
            {tags.length > 0 ? (
              <section aria-labelledby="tag-h">
                <h2 id="tag-h" className="eyebrow mb-2">
                  Tags
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <button key={t.tag} aria-pressed={tag === t.tag} onClick={() => setTag(tag === t.tag ? null : t.tag)} className={`rounded-full border px-2.5 py-0.5 text-xs ${tag === t.tag ? "border-ink bg-ink text-surface" : "border-rule-strong text-ink-2 hover:bg-sunk"}`}>
                      {t.tag}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {kinds.length > 1 ? (
              <section aria-labelledby="kind-h">
                <h2 id="kind-h" className="eyebrow mb-2">
                  Type
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {kinds.map((k) => (
                    <button key={k} aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)} className={`rounded-full border px-2.5 py-0.5 text-xs ${kind === k ? "border-ink bg-ink text-surface" : "border-rule-strong text-ink-2 hover:bg-sunk"}`}>
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </aside>

          <section aria-label="Documents" className="order-1 min-w-0 lg:order-2">
            <form
              role="search"
              className="mb-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (filter.trim()) router.push(`/search#q=${encodeURIComponent(filter.trim())}`);
              }}
            >
              <label htmlFor="filter" className="sr-only">
                Filter documents by title or tag
              </label>
              <input id="filter" ref={filterInput} className="field" placeholder="Filter by title or tag — press Enter to search inside documents" value={filter} onChange={(e) => setFilter(e.target.value)} />
              {filtering ? (
                <button type="button" className="btn btn-quiet shrink-0" onClick={() => (setFilter(""), setCollection(null), setTag(null), setKind(null))}>
                  <X size={14} aria-hidden /> Clear
                </button>
              ) : null}
            </form>

            {!me.near.configured ? (
              <div className="mb-4">
                <Note tone="amber">
                  Private AI is not connected, so documents are indexed for keyword search only and nothing leaves this machine. <Link href="/settings" className="link">See how to connect NEAR AI Cloud</Link>.
                </Note>
              </div>
            ) : null}

            {visible.length === 0 ? (
              <div className="sheet px-6 py-12 text-center text-ink-2">
                <p>No documents match these filters.</p>
                {filter.trim() ? (
                  <p className="mt-2">
                    <Link href={`/search#q=${encodeURIComponent(filter.trim())}`} className="link">
                      Search inside documents for “{filter.trim()}”
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : (
              <ul className="sheet divide-y divide-rule">
                {visible.map((d) => (
                  <li key={d.id}>
                    <Link href={`/library/${d.id}`} className="group flex items-start gap-4 px-4 py-4 hover:bg-paper/70 md:px-5">
                      <span aria-hidden className="mt-1 w-9 shrink-0 rounded-sm border border-rule-strong py-1 text-center text-[0.6rem] font-semibold tracking-wide text-ink-3">
                        {d.kind === "pdf" ? "PDF" : d.kind === "markdown" ? "MD" : "TXT"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="display block truncate text-[1.22rem] group-hover:text-moss">{d.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.82rem] text-ink-3">
                          <span>
                            {d.kind === "pdf" ? `${d.pageCount} page${d.pageCount === 1 ? "" : "s"} · ` : ""}
                            {d.wordCount.toLocaleString()} words · {formatBytes(d.sizeBytes)}
                          </span>
                          <span>Added {formatDate(d.createdAt)}</span>
                          <IndexBadge doc={d} />
                        </span>
                        {d.tags.length > 0 ? (
                          <span className="mt-2 flex flex-wrap gap-1.5">
                            {d.tags.map((t) => (
                              <span key={t} className="rounded-full bg-sunk px-2 py-0.5 text-[0.72rem] text-ink-2">
                                {t}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-ink-3">
              <button className="link" onClick={addSamples} disabled={loadingSamples}>
                Add the fictional sample documents
              </button>{" "}
              to try Morrow without your own files.
            </p>
          </section>
        </div>
      ) : null}

      {dragging ? (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-paper/85 backdrop-blur-[2px]">
          <div className="rounded-lg border-2 border-dashed border-moss px-12 py-10 text-center">
            <Plus size={26} className="mx-auto text-moss" />
            <p className="display mt-2 text-2xl">Drop to add to your library</p>
          </div>
        </div>
      ) : null}

      <Modal open={newCollection !== null} onClose={() => setNewCollection(null)} title="New collection">
        <form onSubmit={createCollection}>
          <label htmlFor="col-name" className="mb-1.5 block text-sm text-ink-2">
            Name
          </label>
          <input id="col-name" className="field" maxLength={60} autoFocus value={newCollection ?? ""} onChange={(e) => setNewCollection(e.target.value)} placeholder="e.g. Home, Health, Thesis" />
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn btn-quiet" onClick={() => setNewCollection(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!newCollection?.trim()}>
              Create
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={removeCollection !== null} onClose={() => setRemoveCollection(null)} title="Remove this collection?">
        <p className="text-ink-2">“{removeCollection?.name}” will be removed. The documents in it stay in your library.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-quiet" onClick={() => setRemoveCollection(null)}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={deleteCollection}>
            Remove collection
          </button>
        </div>
      </Modal>
    </div>
  );
}
