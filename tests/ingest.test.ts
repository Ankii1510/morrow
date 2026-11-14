import { describe, expect, it } from "vitest";
import { extract, safeFilename, sniffKind } from "@/lib/ingest/extract";
import { CHUNK_MAX, chunkPages } from "@/lib/ingest/chunk";
import { sample } from "./helpers";

const enc = (s: string) => new TextEncoder().encode(s);
const code = async (p: Promise<unknown>) => p.then(() => "no error", (e) => e.code);

describe("extraction", () => {
  it("extracts a PDF page by page", async () => {
    const ex = await extract("home-maintenance-log.pdf", sample("home-maintenance-log.pdf"));
    expect(ex.kind).toBe("pdf");
    expect(ex.pages).toHaveLength(3);
    expect(ex.pages[0].text).toContain("last serviced on 8 November 2024");
    expect(ex.pages[1].text).toContain("BRV-88213");
    expect(ex.pages[2].text).toContain("bleed the radiators");
    expect(ex.headings.some((h) => h.page === 2 && /Electrical/.test(h.text))).toBe(true);
  });

  it("extracts markdown headings and title", async () => {
    const ex = await extract("lease-agreement-2025.md", sample("lease-agreement-2025.md"));
    expect(ex.title).toContain("Residential Lease Agreement");
    expect(ex.headings.map((h) => h.text)).toContain("Rent and deposit");
  });

  it("rejects corrupted, empty, mislabelled and unsupported files", async () => {
    expect(await code(extract("broken.pdf", enc("%PDF-1.7\nthis is not a real pdf body")))).toBe("corrupt_pdf");
    expect(await code(extract("fake.pdf", enc("just some text")))).toBe("not_a_pdf");
    expect(await code(extract("empty.txt", enc("   \n\n  ")))).toBe("empty_document");
    expect(await code(extract("binary.txt", new Uint8Array([72, 105, 0, 1, 2, 3])))).toBe("binary_file");
    expect(await code(extract("latin1.txt", new Uint8Array([0xe9, 0xe8, 0xff, 0xfe, 0x41])))).toBe("bad_encoding");
    expect(await code(extract("malware.exe", enc("MZ")))).toBe("unsupported_type");
    expect(await code(extract("page.html", enc("<script>alert(1)</script>")))).toBe("unsupported_type");
    expect(() => sniffKind("notes.txt", enc("%PDF-1.4 hidden pdf"))).toThrow();
  });

  it("sanitises hostile filenames", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename('a<b>:"c".pdf')).not.toMatch(/[<>:"]/);
  });
});

describe("chunking", () => {
  it("produces passages whose offsets point exactly at their source text", async () => {
    for (const name of ["lease-agreement-2025.md", "health-summary-2025.txt", "home-maintenance-log.pdf"]) {
      const ex = await extract(name, sample(name));
      const chunks = chunkPages(ex.pages, ex.headings);
      expect(chunks.length).toBeGreaterThan(1);
      for (const c of chunks) {
        const page = ex.pages.find((p) => p.page === c.page)!;
        expect(page.text.slice(c.charStart, c.charEnd)).toBe(c.text);
        expect(c.text.length).toBeLessThanOrEqual(CHUNK_MAX);
      }
    }
  });

  it("keeps the section heading with each passage", async () => {
    const ex = await extract("lease-agreement-2025.md", sample("lease-agreement-2025.md"));
    const chunks = chunkPages(ex.pages, ex.headings);
    const deposit = chunks.find((c) => c.text.includes("security deposit is 2,200"))!;
    expect(deposit.heading).toBe("Rent and deposit");
  });

  it("splits very long unpunctuated text instead of emitting one giant passage", () => {
    const text = "word ".repeat(3000);
    const chunks = chunkPages([{ page: 1, text }], []);
    expect(chunks.length).toBeGreaterThan(5);
    expect(Math.max(...chunks.map((c) => c.text.length))).toBeLessThanOrEqual(CHUNK_MAX);
  });
});
