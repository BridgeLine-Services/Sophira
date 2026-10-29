#!/usr/bin/env node
/**
 * DOCUMENT EXTRACTION BENCHMARK (Prompt 3, Steps 1-2) - measurement only.
 *
 * Synthesises documents in memory (no fixtures on disk, no student data) and
 * runs them through SOPHIRA'S CURRENT PARSERS, reporting what is actually
 * preserved. It never changes parsing behaviour and asserts nothing about
 * quality; it records a baseline so any future parser swap can be compared
 * against numbers instead of opinion.
 *
 * PDF is NOT synthesised: the repo has no PDF writer, and adding one to
 * benchmark would be a dependency change this phase forbids. Recorded BLOCKED.
 */
import { createRequire } from "node:module";
import JSZip from "jszip";
import * as XLSX from "xlsx";

const require = createRequire(import.meta.url);
const D = require("../tests-dist/src/lib/extract/documents.js");

const norm = (s) => s.replace(/\s+/g, " ").trim();
const recall = (text, tokens) => {
  const t = norm(text).toLowerCase();
  const hit = tokens.filter((k) => t.includes(k.toLowerCase()));
  return { hit: hit.length, total: tokens.length, missing: tokens.filter((k) => !t.includes(k.toLowerCase())) };
};

async function docx() {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
    + `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter 2 Photosynthesis</w:t></w:r></w:p>`
    + `<w:p><w:r><w:t>Chlorophyll absorbs light energy.</w:t></w:r></w:p>`
    + `<w:p><w:r><w:t>Mitochondria release energy.</w:t></w:r></w:p>`
    + `</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function pptx() {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Cell Division</a:t></a:r></a:p><a:p><a:r><a:t>Mitosis has four phases.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

const out = [];
function record(name, r) {
  out.push({ name, ...r });
}

// DOCX via mammoth -> structured text (the real production path)
try {
  const buf = await docx();
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.convertToHtml({ buffer: buf });
  const text = D.docxHtmlToStructuredText(value);
  record("DOCX (headings + paragraphs)", { chars: text.length, ...recall(text, ["Photosynthesis", "Chlorophyll", "Mitochondria"]), order: text.indexOf("Photosynthesis") < text.indexOf("Mitochondria") });
} catch (e) { record("DOCX", { error: String(e).slice(0, 80) }); }

// PPTX
try {
  const buf = await pptx();
  const p = await D.parsePptx(buf);
  record("PPTX (slide title + body)", { chars: (p.text || "").length, ...recall(p.text || "", ["Cell Division", "Mitosis"]), sections: (p.sections || []).length });
} catch (e) { record("PPTX", { error: String(e).slice(0, 80) }); }

// XLSX multi-sheet
try {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Term", "Value"], ["Mass", 12], ["Velocity", 3]]), "Physics");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Author", "Year"], ["Hardy", 1873]]), "Sources");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const p = await D.parseSpreadsheet(buf);
  record("XLSX (2 sheets, numbers)", { chars: (p.text || "").length, ...recall(p.text || "", ["Physics", "Sources", "Mass", "Hardy"]) });
} catch (e) { record("XLSX", { error: String(e).slice(0, 80) }); }

// CSV with quoted commas + embedded newline
try {
  const csv = 'topic,note\n"Cells, organelles","line one\nline two"\n';
  const p = D.parseCsv(csv);
  record("CSV (quoted comma + newline)", { chars: (p.text || "").length, ...recall(p.text || "", ["Cells, organelles", "topic"]) });
} catch (e) { record("CSV", { error: String(e).slice(0, 80) }); }

record("PDF (text, scanned, tables, columns, equations)", { status: "BLOCKED", why: "no PDF writer in the repo; synthesising one would add a dependency this phase forbids" });

console.log("format | chars | key tokens found | notes");
for (const r of out) {
  if (r.error) { console.log(`${r.name} | ERROR | - | ${r.error}`); continue; }
  if (r.status) { console.log(`${r.name} | - | - | ${r.status}: ${r.why}`); continue; }
  console.log(`${r.name} | ${r.chars} | ${r.hit}/${r.total}${r.missing?.length ? " missing: " + r.missing.join(", ") : ""} | order=${r.order ?? "n/a"} sections=${r.sections ?? "n/a"}`);
}
