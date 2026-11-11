/**
 * Structured document extraction library (upgrade spec §3, §5).
 *
 * Each parser returns structured plain text that PRESERVES document structure
 * (headings, numbered questions, tables, sheets, slides) instead of a wall of
 * text, plus honest notes about anything that could not be read.
 *
 * DOCX: mammoth HTML → structured text (headings/lists/tables).
 * PPTX: JSZip → per-slide text + speaker notes + tables.
 * XLSX/CSV: SheetJS → sheets with headers and rows (formulas included as text).
 * All functions are pure (Buffer in → { text, notes } out) and unit-testable.
 */

import { decodeHtmlEntities } from "../text/entities";
import { htmlToStructuredText } from "../text/html-blocks";

export interface ParsedDocument {
  text: string;
  notes: string;
}

/* ------------------------------------------------------------------ */
/* DOCX                                                                */
/* ------------------------------------------------------------------ */

/**
 * DOCX HTML -> structured text.
 *
 * 2026-11-09: the previous implementation was a chain of regex replacements, which
 * both let crafted tags through (CodeQL #19/#18/#17) and decoded entities twice
 * (#15/#14). It now goes through the tree parser in src/lib/text/html-blocks.ts:
 * headings, ordered and unordered lists, tables and paragraphs survive, and every
 * character of content arrives as text, never as markup.
 */
export function docxHtmlToStructuredText(html: string): string {
  return htmlToStructuredText(html);
}

/* ------------------------------------------------------------------ */
/* PPTX                                                                */
/* ------------------------------------------------------------------ */

/**
 * Slide XML entities, decoded exactly once by the shared decoder so a nested
 * reference (`&amp;lt;`) stays literal instead of becoming a tag character.
 */
function decodeXmlEntities(s: string): string {
  return decodeHtmlEntities(s);
}

/** Extracts <a:t> runs from a slide/notes XML string, grouped by paragraph. */
function pptxTextFromXml(xml: string): string[] {
  const paragraphs: string[] = [];
  const paraRe = /<a:p>([\s\S]*?)<\/a:p>/g;
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(xml)) !== null) {
    const runs = Array.from(m[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map((r) => decodeXmlEntities(r[1]));
    const line = runs.join("").trim();
    if (line) paragraphs.push(line);
  }
  if (paragraphs.length === 0) {
    // Fallback: raw <a:t> runs even outside paragraphs.
    const runs = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map((r) => decodeXmlEntities(r[1]).trim());
    return runs.filter(Boolean);
  }
  return paragraphs;
}

export async function parsePptx(bytes: Buffer): Promise<ParsedDocument> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const slidePaths = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)/)![1]);
      const nb = Number(b.match(/(\d+)/)![1]);
      return na - nb;
    });

  if (slidePaths.length === 0) {
    throw new Error("No slides found — this may not be a PowerPoint file.");
  }

  const parts: string[] = [];
  let imageCount = 0;
  for (const path of slidePaths) {
    const n = Number(path.match(/(\d+)/)![1]);
    const xml = await zip.files[path].async("string");
    const lines = pptxTextFromXml(xml);
    const mediaRefs = (xml.match(/r:embed="/g) || []).length;
    imageCount += mediaRefs;
    const header = lines.shift() ?? "";
    parts.push(`## Slide ${n}: ${header || "(no title)"}`);
    if (lines.length) parts.push(lines.join("\n"));
    if (mediaRefs) parts.push(`[${mediaRefs} embedded image${mediaRefs > 1 ? "s" : ""} — image content could not be read]`);

    // Speaker notes when present.
    const notesPath = `ppt/notesSlides/notesSlide${n}.xml`;
    if (zip.files[notesPath]) {
      const notesXml = await zip.files[notesPath].async("string");
      const notes = pptxTextFromXml(notesXml).filter((l) => l && !/^\d+$/.test(l));
      if (notes.length) parts.push(`Speaker notes: ${notes.join(" ")}`);
    }
  }

  const notes: string[] = ["Extracted from PowerPoint with slide titles, text, and speaker notes preserved."];
  if (imageCount) notes.push(`${imageCount} embedded image(s) could not be read — describe or photograph any important diagrams separately.`);

  return { text: parts.join("\n"), notes: notes.join(" ") };
}

/* ------------------------------------------------------------------ */
/* XLSX / CSV                                                          */
/* ------------------------------------------------------------------ */

export async function parseSpreadsheet(bytes: Buffer): Promise<ParsedDocument> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "buffer", cellFormula: true, cellText: true });
  const parts: string[] = [];
  let formulas = 0;

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });

    parts.push(`## Sheet: ${name} (${rows.length} row${rows.length === 1 ? "" : "s"})`);
    if (rows.length === 0) {
      parts.push("(empty)");
      continue;
    }

    // Formulas are kept, not discarded: a formula IS the student's method in a
    // finance or physics sheet, and showing only the computed cell would hide
    // the very reasoning they are asked to quote.
    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
    const formulaAt = new Map<string, { f: string; v: unknown }>();
    for (let r = range.s.r; r <= Math.min(range.e.r, 200); r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })] as
          | { f?: string; v?: unknown; w?: string }
          | undefined;
        if (cell && typeof cell === "object" && cell.f) {
          formulas++;
          formulaAt.set(`${r}:${c}`, { f: cell.f, v: cell.w ?? cell.v ?? "" });
        }
      }
    }

    const maxRows = Math.min(rows.length, 100);
    for (let i = 0; i < maxRows; i++) {
      // sheet_to_json indexes from the used range, so absolute cell addresses
      // need the range's origin added back before looking a formula up.
      const cells = (rows[i] || []).map((v, colIndex) => {
        const formula = formulaAt.get(`${range.s.r + i}:${range.s.c + colIndex}`);
        const rendered = String(v ?? "").replace(/\|/g, "/");
        if (!formula) return rendered;
        // "=B2*C2 → 120": the formula first, the computed value after it.
        const value = String(formula.v ?? "").replace(/\|/g, "/");
        return value ? `=${formula.f} → ${value}` : `=${formula.f}`;
      });
      parts.push(`| ${cells.join(" | ")} |`);
    }
    if (rows.length > maxRows) parts.push(`(${rows.length - maxRows} more rows truncated — import the full file if you need them)`);
  }

  const notes = ["Extracted spreadsheet with sheet names and headers preserved; cells rendered as a table."];
  if (formulas) {
    notes.push(
      `${formulas} formula cell(s) are shown as "=formula → computed value", so both the method and the result are preserved.`,
    );
  } else {
    notes.push("No formulas were found in the workbook, so cells are shown as their computed values.");
  }
  notes.push("Charts embedded in the workbook could not be read; the underlying data is included instead.");

  return { text: parts.join("\n"), notes: notes.join(" ") };
}

export function parseCsv(text: string): ParsedDocument {
  // Keep CSV mostly as-is — it is already structured text.
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const notes = `Read CSV directly (${lines.length} lines).`;
  return { text: lines.join("\n"), notes };
}
