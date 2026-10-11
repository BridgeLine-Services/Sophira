import JSZip from "jszip";
import { createHash } from "crypto";

/**
 * DOCUMENT EXPORT (document workflow stage 3, 2026-10-11): deterministic
 * DOCX and PDF builders for stored notebook artifacts.
 *
 * VERIFICATION AT EVERY STAGE of the document workflow:
 *   import  — sources are extracted to structured text with provenance
 *              (lib/extract/documents.ts, notebook ingest, fetchAndVerify)
 *   edit    — notes/evidence edits persist to the stored rows (RLS)
 *   export  — bytes are built FROM THE STORED ARTIFACT ROW, never
 *              regenerated, and carry a SHA-256 digest so the exported
 *              file can be checked against the stored artifact. The
 *              provenance block is always included — exports can never
 *              silently drop their sources.
 * Same stored artifact → identical bytes → identical digest (deterministic
 * builders: no timestamps, no random IDs inside the file).
 */

export interface ExportSection {
  heading: string;
  items: string[];
  sources: string[];
}

export interface ExportArtifact {
  title: string;
  artifactType: string;
  sections: ExportSection[];
  provenance: { sourceLabel: string; title: string; locator: string }[];
  honestNote?: string;
  artifactId: string;
  notebookId: string;
  createdAt: string;
}

export function digestOf(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Plain-text rendering of the artifact (also used for PDF layout). */
export function textOf(a: ExportArtifact): string {
  const lines: string[] = [a.title, ""];
  for (const s of a.sections) {
    lines.push(s.heading);
    for (const it of s.items) lines.push(`- ${it}`);
    if (s.sources.length) lines.push(`(sources: ${s.sources.join(", ")})`);
    lines.push("");
  }
  if (a.provenance.length) {
    lines.push("Source provenance");
    for (const p of a.provenance) lines.push(`- ${p.sourceLabel} — ${p.title} (${p.locator})`);
    lines.push("");
  }
  if (a.honestNote) lines.push(a.honestNote, "");
  lines.push(`Exported from Sophira — notebook ${a.notebookId}, artifact ${a.artifactId}, created ${a.createdAt}.`);
  return lines.join("\n");
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const docxParagraph = (text: string, bold = false) =>
  `  <w:p><w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;

/**
 * Minimal, valid DOCX (Office Open XML): [Content_Types].xml, _rels/.rels,
 * word/document.xml — opens in Word/Google Docs/LibreOffice.
 */
export async function buildDocx(a: ExportArtifact): Promise<Buffer> {
  const paragraphs: string[] = [];
  paragraphs.push(docxParagraph(a.title, true));
  for (const s of a.sections) {
    paragraphs.push(docxParagraph(s.heading, true));
    for (const it of s.items) paragraphs.push(docxParagraph(`- ${it}`));
    if (s.sources.length) paragraphs.push(docxParagraph(`(sources: ${s.sources.join(", ")})`));
  }
  if (a.provenance.length) {
    paragraphs.push(docxParagraph("Source provenance", true));
    for (const p of a.provenance) paragraphs.push(docxParagraph(`- ${p.sourceLabel} — ${p.title} (${p.locator})`));
  }
  if (a.honestNote) paragraphs.push(docxParagraph(a.honestNote));
  paragraphs.push(docxParagraph(
    `Exported from Sophira — notebook ${a.notebookId}, artifact ${a.artifactId}, created ${a.createdAt}.`,
  ));

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${paragraphs.join("\n")}
</w:body>
</w:document>`,
  );
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return out as Buffer;
}

/* ------------------------- minimal PDF writer ------------------------- */

/** WinAnsi-safe text (Helvetica): outside Latin-1 becomes '?', never mojibake. */
const pdfSanitize = (s: string) =>
  s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
   .replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...")
   .split("").map((ch) => (ch.charCodeAt(0) <= 255 ? ch : "?")).join("");

const pdfEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function wrapLines(text: string, width = 92): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (!raw) { out.push(""); continue; }
    let line = "";
    for (const word of raw.split(/\s+/)) {
      if (!line) line = word;
      else if ((line + " " + word).length <= width) line += " " + word;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * Minimal, valid PDF 1.4 (Helvetica, Letter, 54 lines/page, deterministic).
 */
export function buildPdf(a: ExportArtifact): Buffer {
  const lines = wrapLines(pdfSanitize(textOf(a)));
  const perPage = 54;
  const pageCount = Math.max(1, Math.ceil(lines.length / perPage));
  const objects: string[] = [];
  // Object 1: catalog, 2: pages tree, 3: font; then 2 objects per page.
  const firstPageObj = 4;
  const kids = Array.from({ length: pageCount }, (_, i) => `${firstPageObj + i * 2} 0 R`).join(" ");
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  for (let p = 0; p < pageCount; p++) {
    const pageObj = firstPageObj + p * 2;
    const contentObj = pageObj + 1;
    const pageLines = lines.slice(p * perPage, (p + 1) * perPage);
    let stream = "BT /F1 11 Tf 12 TL 72 740 Td\n";
    for (const l of pageLines) stream += `(${pdfEscape(l)}) Tj T*\n`;
    stream += "ET";
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, "latin1");
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  const count = objects.length; // objects.length - 1 objects + free entry
  pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/** Filesystem-safe export filename from the stored artifact title. */
export function exportFilename(a: ExportArtifact, ext: string): string {
  const base = a.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "artifact";
  return `${base}.${ext}`;
}
