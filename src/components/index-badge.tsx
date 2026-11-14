import type { Doc } from "@/lib/client/api";

/** Honest index status: what kind of search actually works for this document right now. */
export function IndexBadge({ doc }: { doc: Doc }) {
  if (doc.semantic === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 text-moss" title="Searchable by keyword and by meaning. Embeddings were computed inside a verified TEE.">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-moss-2" /> Indexed
      </span>
    );
  }
  if (doc.semantic === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-2" title="Keyword search already works. The meaning index is being built in a TEE.">
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#c9a227]" /> Indexing meaning
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-3" title={doc.semantic === "failed" ? doc.error || "Embedding failed." : "NEAR AI Cloud is not configured, so only the local keyword index exists."}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ink-3" /> Keyword only{doc.semantic === "failed" ? " · retry needed" : ""}
    </span>
  );
}

