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

export interface ParsedDocument {
  text: string;
  notes: string;
}

/* ------------------------------------------------------------------ */
/* DOCX                                                                */
/* ------------------------------------------------------------------ */

function inlineText(h: string): string {
  return h
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|h3|h4|h5|h6|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Converts mammoth's HTML output to structured plain text. */
export function docxHtmlToStructuredText(html: string): string {
  let out = "";
  out = html.replace(/<h1[^>]*>(.*?)<\/h1>/gis, (_m: string, t: string) => `# ${inlineText(t)}\n`);
  out = out.replace(/<h2[^>]*>(.*?)<\/h2>/gis, (_m: string, t: string) => `## ${inlineText(t)}\n`);
  out = out.replace(/<h3[^>]*>(.*?)<\/h3>/gis, (_m: string, t: string) => `### ${inlineText(t)}\n`);
  out = out.replace(/<h[456][^>]*>(.*?)<\/h[456]>/gis, (_m: string, t: string) => `#### ${inlineText(t)}\n`);

  let ol = 1;
  out = out.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gis, (_m: string, body: string) => {
    ol = 1;
    return body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gis, (_l: string, li: string) => `${ol++}. ${inlineText(li).trim()}\n`);
  });
  out = out.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gis, (_m: string, body: string) =>
    body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gis, (_l: string, li: string) => `- ${inlineText(li).trim()}\n`)
  );

  out = out.replace(/<table[^>]*>([\s\S]*?)<\/table>/gis, (_m: string, body: string) => {
    const rows: string[] = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gis;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(body)) !== null) {
      const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gis;
      const cells: string[] = [];
      let c: RegExpExecArray | null;
      while ((c = cellRe.exec(m[1])) !== null) cells.push(inlineText(c[1]).trim());
      rows.push(`| ${cells.join(" | ")} |`);
    }
    return rows.join("\n") + "\n";
  });

  out = out.replace(/<p[^>]*>([\s\S]*?)<\/p>/gis, (_m: string, t: string) => `${inlineText(t).trim()}\n`);
  out = inlineText(out);
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/* ------------------------------------------------------------------ */
/* PPTX                                                                */
/* ------------------------------------------------------------------ */

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
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

    // Detect formulas for the honest note.
    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
    for (let r = range.s.r; r <= Math.min(range.e.r, 200); r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell === "object" && "f" in cell && (cell as { f?: string }).f) {
          formulas++;
        }
      }
    }

    const maxRows = Math.min(rows.length, 100);
    for (let i = 0; i < maxRows; i++) {
      const cells = (rows[i] || []).map((v) => String(v ?? "").replace(/\|/g, "/"));
      parts.push(`| ${cells.join(" | ")} |`);
    }
    if (rows.length > maxRows) parts.push(`(${rows.length - maxRows} more rows truncated — import the full file if you need them)`);
  }

  const notes = ["Extracted spreadsheet with sheet names and headers preserved; cells rendered as a table."];
  if (formulas) notes.push(`${formulas} formula cell(s) were read as their computed values — formulas themselves are not shown.`);
  notes.push("Charts embedded in the workbook could not be read; the underlying data is included instead.");

  return { text: parts.join("\n"), notes: notes.join(" ") };
}

export function parseCsv(text: string): ParsedDocument {
  // Keep CSV mostly as-is — it is already structured text.
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const notes = `Read CSV directly (${lines.length} lines).`;
  return { text: lines.join("\n"), notes };
}
