// Generates samples/home-maintenance-log.pdf: a small, valid, multi-page text PDF
// with fictional content, so judges can test PDF ingestion and page-level citations.
import fs from "node:fs";
import path from "node:path";

const pages = [
  {
    title: "Home Maintenance Log - 14 Alder Court, Flat 3",
    lines: [
      "Fictional sample document for Morrow. All names, dates and amounts are invented.",
      "",
      "Boiler",
      "The boiler is a Calder 24i combination unit installed in October 2019.",
      "It was last serviced on 8 November 2024 by Fenwick Heating.",
      "The next annual service is due in November 2025.",
      "The service cost 95 dollars and was paid by the landlord.",
      "",
      "Water",
      "The main water shut-off valve is under the kitchen sink, behind the left panel.",
      "A slow leak under the bathroom basin was reported on 3 February 2025",
      "and repaired on 5 February 2025 by replacing the trap seal.",
    ],
  },
  {
    title: "Electrical and Safety",
    lines: [
      "The consumer unit is in the hallway cupboard. Circuit 4 controls the kitchen sockets.",
      "Smoke alarm batteries were replaced on 14 January 2025.",
      "The carbon monoxide alarm expires in June 2028.",
      "",
      "Appliances",
      "The washing machine is a Brevik W7, purchased on 22 May 2023 for 430 dollars.",
      "Its warranty runs for three years and ends on 22 May 2026.",
      "The warranty reference is BRV-88213.",
      "",
      "The refrigerator belongs to the landlord and is covered by the lease.",
    ],
  },
  {
    title: "Seasonal Checklist",
    lines: [
      "Spring: clean the extractor fan filter and check window seals.",
      "Summer: descale the kettle and shower head.",
      "Autumn: bleed the radiators before the heating season starts.",
      "Winter: keep the heating at 12 degrees or above when away, to protect the pipes.",
      "",
      "Contacts",
      "Building emergency line: 555-0142.",
      "Fenwick Heating: 555-0119.",
      "Northlight Mutual claims line: 555-0177.",
    ],
  },
];

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const objects = [];
const add = (body) => (objects.push(body), objects.length);

const catalogId = add("");
const pagesId = add("");
const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
const boldId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
const kids = [];
for (const p of pages) {
  let y = 740;
  let s = `BT /F2 18 Tf 72 ${y} Td (${esc(p.title)}) Tj ET\n`;
  y -= 34;
  for (const line of p.lines) {
    if (line) {
      const heading = line.length < 22 && !/[.:]$/.test(line);
      s += `BT /${heading ? "F2" : "F1"} ${heading ? 13 : 11} Tf 72 ${y} Td (${esc(line)}) Tj ET\n`;
    }
    y -= line ? 18 : 10;
  }
  const contentId = add(`<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}endstream`);
  kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldId} 0 R >> >> /Contents ${contentId} 0 R >>`));
}
objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

let out = "%PDF-1.4\n";
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(out));
  out += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xref = Buffer.byteLength(out);
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info << /Title (Home Maintenance Log) /Author (Morrow sample) >> >>\nstartxref\n${xref}\n%%EOF\n`;

const target = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "samples", "home-maintenance-log.pdf");
fs.writeFileSync(target, out, "latin1");
console.log("wrote", target, Buffer.byteLength(out), "bytes");
