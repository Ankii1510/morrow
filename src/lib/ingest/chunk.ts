import type { ExtractedPage, Heading } from "./extract";

export type Chunk = {
  ordinal: number;
  page: number;
  heading: string | null;
  /** Offsets into the page text, so a citation can be highlighted exactly where it came from. */
  charStart: number;
  charEnd: number;
  text: string;
};

export const CHUNK_TARGET = 900;
export const CHUNK_MAX = 1400;
const CHUNK_MIN = 160;

type Unit = { start: number; end: number; paraStart: boolean };

/** Split a page into sentence-sized units, remembering which ones begin a paragraph. */
function units(text: string): Unit[] {
  const out: Unit[] = [];
  const paraRe = /\n\s*\n/g;
  let pStart = 0;
  const paras: [number, number][] = [];
  for (let m = paraRe.exec(text); m; m = paraRe.exec(text)) {
    paras.push([pStart, m.index]);
    pStart = m.index + m[0].length;
  }
  paras.push([pStart, text.length]);
  for (const [ps, pe] of paras) {
    if (!text.slice(ps, pe).trim()) continue;
    let first = true;
    let s = ps;
    const sentRe = /[.!?]["')\]]?\s+(?=[A-Z0-9"'(\[#*-])|\n(?=\s*(?:[-*+]|\d+[.)])\s)|\n(?=#{1,6}\s)/g;
    sentRe.lastIndex = ps;
    for (let m = sentRe.exec(text); m && m.index < pe; m = sentRe.exec(text)) {
      const e = Math.min(m.index + m[0].length, pe);
      if (e - s >= 1) {
        pushUnit(out, text, s, e, first);
        first = false;
        s = e;
      }
    }
    if (s < pe) pushUnit(out, text, s, pe, first);
  }
  return out;
}

/** Units longer than CHUNK_MAX (tables, unpunctuated text) are hard-split at whitespace. */
function pushUnit(out: Unit[], text: string, start: number, end: number, paraStart: boolean): void {
  let s = start;
  let first = paraStart;
  while (end - s > CHUNK_MAX) {
    let cut = text.lastIndexOf(" ", s + CHUNK_MAX);
    const nl = text.lastIndexOf("\n", s + CHUNK_MAX);
    cut = Math.max(cut, nl);
    if (cut <= s + CHUNK_MAX / 2) cut = s + CHUNK_MAX;
    out.push({ start: s, end: cut, paraStart: first });
    first = false;
    s = cut;
  }
  if (end > s) out.push({ start: s, end, paraStart: first });
}

export function chunkPages(pages: ExtractedPage[], headings: Heading[]): Chunk[] {
  const chunks: Chunk[] = [];
  let lastHeading: string | null = null;
  for (const page of pages) {
    const pageHeadings = headings.filter((h) => h.page === page.page).sort((a, b) => a.offset - b.offset);
    const us = units(page.text);
    let i = 0;
    while (i < us.length) {
      const start = us[i].start;
      let end = us[i].end;
      let j = i + 1;
      while (j < us.length) {
        const next = us[j];
        const len = end - start;
        const withNext = next.end - start;
        if (withNext > CHUNK_MAX) break;
        // Prefer to end on a paragraph boundary once the chunk is reasonably full.
        if (len >= CHUNK_TARGET) break;
        if (len >= CHUNK_TARGET * 0.6 && next.paraStart) break;
        // A heading starts a new chunk unless the current one is little more than a heading itself.
        if (len >= 80 && pageHeadings.some((h) => h.offset >= next.start && h.offset < next.end)) break;
        end = next.end;
        j++;
      }
      // Never leave a tiny tail on its own: fold it into this chunk if it fits.
      if (j === us.length - 1 && us[j].end - us[j].start < CHUNK_MIN && us[j].end - start <= CHUNK_MAX) {
        end = us[j].end;
        j++;
      }
      const slice = page.text.slice(start, end);
      const lead = slice.length - slice.trimStart().length;
      const text = slice.trim();
      if (text) {
        const charStart = start + lead;
        const at = [...pageHeadings].reverse().find((h) => h.offset <= charStart + 2);
        if (at) lastHeading = at.text;
        chunks.push({
          ordinal: chunks.length,
          page: page.page,
          heading: lastHeading,
          charStart,
          charEnd: charStart + text.length,
          text,
        });
      }
      i = j;
    }
    // Carry the last heading on this page forward to the next page.
    const tail = pageHeadings[pageHeadings.length - 1];
    if (tail) lastHeading = tail.text;
  }
  return chunks;
}

/** Text sent to the embedding model: the passage plus the context a reader would have. */
export function embeddingInput(title: string, chunk: Pick<Chunk, "heading" | "text">): string {
  const ctx = chunk.heading && chunk.heading !== title ? `${title} — ${chunk.heading}` : title;
  return `${ctx}\n\n${chunk.text}`;
}

export function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}
