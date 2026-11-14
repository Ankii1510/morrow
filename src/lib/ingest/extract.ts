import path from "node:path";
import { config } from "../config";
import { AppError } from "../http";

export type DocKind = "pdf" | "text" | "markdown";
export type Heading = { page: number; offset: number; text: string };
export type ExtractedPage = { page: number; text: string };
export type Extracted = {
  kind: DocKind;
  title: string;
  pages: ExtractedPage[];
  headings: Heading[];
  meta: Record<string, string>;
};

const EXT_KIND: Record<string, DocKind> = {
  ".pdf": "pdf",
  ".txt": "text",
  ".text": "text",
  ".md": "markdown",
  ".markdown": "markdown",
};

export const ACCEPTED_EXTENSIONS = Object.keys(EXT_KIND);

/** Decide the document kind from the extension AND the bytes. The browser-supplied MIME type is ignored. */
export function sniffKind(filename: string, bytes: Uint8Array): DocKind {
  const ext = path.extname(filename).toLowerCase();
  const kind = EXT_KIND[ext];
  if (!kind) {
    throw new AppError(415, "unsupported_type", `Unsupported file type "${ext || "none"}". Morrow accepts PDF, TXT and Markdown.`);
  }
  const isPdfMagic = bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
  if (kind === "pdf") {
    if (!isPdfMagic) throw new AppError(415, "not_a_pdf", "This file has a .pdf extension but is not a PDF.");
    return kind;
  }
  if (isPdfMagic) throw new AppError(415, "mismatched_type", "This file is a PDF but has a text extension.");
  if (bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0)) {
    throw new AppError(415, "binary_file", "This file contains binary data and cannot be read as text.");
  }
  return kind;
}

export function safeFilename(name: string): string {
  const base = path.basename(name).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_").trim();
  return (base || "document").slice(0, 180);
}

function titleFromFilename(filename: string): string {
  return path.basename(filename, path.extname(filename)).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n");
}

export async function extract(filename: string, bytes: Uint8Array): Promise<Extracted> {
  const kind = sniffKind(filename, bytes);
  const out = kind === "pdf" ? await extractPdf(filename, bytes) : extractText(filename, bytes, kind);
  const total = out.pages.reduce((n, p) => n + p.text.trim().length, 0);
  if (total === 0) {
    throw new AppError(
      422,
      "empty_document",
      kind === "pdf"
        ? "No text could be extracted. This PDF may be a scan; Morrow does not run OCR yet."
        : "This file is empty.",
    );
  }
  if (total > config.limits.maxExtractedChars) {
    throw new AppError(413, "too_much_text", "This document contains more text than Morrow can index in one file.");
  }
  return out;
}

function extractText(filename: string, bytes: Uint8Array, kind: DocKind): Extracted {
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AppError(415, "bad_encoding", "This file is not valid UTF-8 text.");
  }
  raw = raw.replace(/^\ufeff/, "");
  // Form feeds are the only real page marker plain text has.
  const pages = raw.split("\f").map((t, i) => ({ page: i + 1, text: normalize(t) }));
  const headings: Heading[] = [];
  let title = titleFromFilename(filename);
  let titleFound = false;
  for (const p of pages) {
    let offset = 0;
    let inFence = false;
    for (const line of p.text.split("\n")) {
      if (kind === "markdown") {
        if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
        const m = !inFence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (m) {
          headings.push({ page: p.page, offset, text: m[2].trim() });
          if (!titleFound && m[1].length === 1) {
            title = m[2].trim().slice(0, 200);
            titleFound = true;
          }
        }
      } else if (isPlainHeading(line)) {
        headings.push({ page: p.page, offset, text: line.trim() });
        // A heading on the very first line of a plain-text file is its title.
        if (!titleFound && p.page === 1 && !p.text.slice(0, offset).trim()) {
          const t = line.trim();
          title = (t === t.toUpperCase() ? t.toLowerCase().replace(/(^[\s-])\p{L}/gu, (c) => c.toUpperCase()) : t).slice(0, 200);
          titleFound = true;
        }
      }
      offset += line.length + 1;
    }
  }
  return { kind, title, pages, headings, meta: {} };
}

/** Conservative plain-text heading heuristic: a short ALL-CAPS line or a "1.2 Title" numbered line. */
function isPlainHeading(line: string): boolean {
  const s = line.trim();
  if (s.length < 3 || s.length > 80 || /[.!?,;:]$/.test(s)) return false;
  if (/^\d+(\.\d+)*\.?\s+[A-Z]/.test(s)) return true;
  const letters = s.replace(/[^A-Za-z]/g, "");
  return letters.length >= 4 && letters === letters.toUpperCase();
}

type PdfTextItem = { str: string; transform: number[]; height: number; hasEOL?: boolean };

async function extractPdf(filename: string, bytes: Uint8Array): Promise<Extracted> {
  // The legacy build runs in Node without a DOM. The PDF is parsed for text only:
  // it is never rendered, and embedded JavaScript, XFA forms and remote resources are not used.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), // pdf.js takes ownership of the buffer
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => {});
    const name = (e as Error)?.name;
    if (name === "PasswordException") throw new AppError(422, "encrypted_pdf", "This PDF is password-protected. Remove the password and upload it again.");
    throw new AppError(422, "corrupt_pdf", "This PDF could not be opened. The file may be damaged.");
  }
  try {
    if (doc.numPages > config.limits.maxPdfPages) {
      throw new AppError(413, "too_many_pages", `This PDF has ${doc.numPages} pages; the limit is ${config.limits.maxPdfPages}.`);
    }
    const pages: ExtractedPage[] = [];
    const headings: Heading[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = (content.items as unknown as PdfTextItem[]).filter((it) => typeof it.str === "string");
      const { text, lines } = layoutPage(items);
      const clean = normalize(text);
      pages.push({ page: n, text: clean });
      // A line set noticeably larger than the page's body size is treated as a heading.
      const heights = lines.map((l) => l.height).filter((h) => h > 0).sort((a, b) => a - b);
      const median = heights[Math.floor(heights.length / 2)] || 0;
      let cursor = 0;
      for (const l of lines) {
        const s = l.text.trim();
        const at = s ? clean.indexOf(s, cursor) : -1;
        if (at >= 0) {
          if (median > 0 && l.height >= median * 1.18 && s.length >= 3 && s.length <= 120) {
            headings.push({ page: n, offset: at, text: s });
          }
          cursor = at + s.length;
        }
      }
      page.cleanup();
    }
    const meta: Record<string, string> = {};
    let title = "";
    try {
      const m = await doc.getMetadata();
      const info = (m?.info || {}) as Record<string, unknown>;
      for (const k of ["Title", "Author", "Subject", "Creator", "CreationDate"]) {
        const v = info[k];
        if (typeof v === "string" && v.trim()) meta[k.toLowerCase()] = v.trim().slice(0, 300);
      }
      if (meta.title && meta.title.length > 2 && !/^untitled|\.(docx?|pdf|tex)$/i.test(meta.title)) title = meta.title;
    } catch {
      /* metadata is optional */
    }
    if (!title) title = headings.find((h) => h.page === 1)?.text || titleFromFilename(filename);
    return { kind: "pdf", title: title.slice(0, 200), pages, headings, meta };
  } finally {
    await task.destroy().catch(() => {});
  }
}

/** Rebuild reading-order lines from positioned text runs; a large vertical gap becomes a paragraph break. */
function layoutPage(items: PdfTextItem[]): { text: string; lines: { text: string; height: number }[] } {
  const lines: { text: string; height: number; y: number }[] = [];
  let cur: { text: string; height: number; y: number } | null = null;
  for (const it of items) {
    const y = it.transform?.[5] ?? 0;
    const h = it.height || Math.abs(it.transform?.[3] ?? 0);
    if (!cur || Math.abs(cur.y - y) > Math.max(2, (cur.height || h) * 0.5)) {
      if (cur) lines.push(cur);
      cur = { text: it.str, height: h, y };
    } else {
      const needsSpace = cur.text && !cur.text.endsWith(" ") && it.str && !it.str.startsWith(" ");
      cur.text += (needsSpace && it.str.trim() ? " " : "") + it.str;
      cur.height = Math.max(cur.height, h);
    }
    if (it.hasEOL && cur) {
      lines.push(cur);
      cur = null;
    }
  }
  if (cur) lines.push(cur);
  let text = "";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const prev = lines[i - 1];
    if (prev) {
      const gap = Math.abs(prev.y - l.y);
      text += gap > Math.max(prev.height, l.height) * 1.9 ? "\n\n" : "\n";
    }
    text += l.text.replace(/\s+/g, " ").trim();
  }
  return { text, lines: lines.map(({ text: t, height }) => ({ text: t, height })) };
}
