/**
 * PDF TEXT EXTRACTION (2026-10-29) - primary parser, modern fallback.
 *
 * Why this exists: the primary parser (pdf-parse 1.1.1 -> pdf.js v1.10.100,
 * ~2016) rejects PDFs produced by modern tools - "Unknown compression method"
 * on object streams and an intermittent "bad XRef entry" that varied between
 * attempts on one byte-identical file. Students hit that as "could not be read".
 *
 * Policy: the existing parser stays FIRST (never replaced, so behaviour that
 * already works is unchanged). A current pdf.js is tried only when the primary
 * throws or returns almost nothing. The result says which path produced the
 * text, so nothing is reported that was not actually extracted.
 */
export interface PdfExtraction {
  text: string;
  via: "pdf-parse" | "pdfjs" | "none";
  primaryError: string | null;
  /** Phase 3a: per-page text when the parser can report page boundaries.
   *  null means "page numbers are not reliable for this file" - never faked. */
  pages?: { page: number; text: string }[] | null;
}

type ParseImpl = (b: Buffer) => Promise<string>;

async function primaryParse(bytes: Buffer): Promise<string> {
  const mod = (await import("pdf-parse/lib/pdf-parse.js")) as unknown as {
    default: (b: Buffer) => Promise<{ text?: string }>;
  };
  const { text } = await mod.default(bytes);
  return (text || "").trim();
}

async function fallbackParse(bytes: Buffer): Promise<string> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
    getDocument: (o: Record<string, unknown>) => { promise: Promise<PdfDoc> };
  };
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((it) => (typeof it.str === "string" ? it.str : "")).join(" ");
    parts.push(line.trim());
  }
  await doc.cleanup();
  return parts.join("\n\n").trim();
}

async function fallbackParsePages(bytes: Buffer): Promise<{ page: number; text: string }[]> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
    getDocument: (o: Record<string, unknown>) => { promise: Promise<PdfDoc> };
  };
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  const pages: { page: number; text: string }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((it) => (typeof it.str === "string" ? it.str : "")).join(" ");
    pages.push({ page: i, text: line.trim() });
  }
  await doc.cleanup();
  return pages;
}

interface PdfDoc {
  numPages: number;
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }>;
  cleanup: () => Promise<void>;
}

const MIN_USEFUL = 80;

/**
 * Extract text, preferring the existing parser. The fallback runs only when the
 * primary failed outright or produced almost nothing - and its output is used
 * only when it is actually longer, so a working extraction is never downgraded.
 */
export async function extractPdfText(
  bytes: Buffer,
  opts: { primary?: ParseImpl; fallback?: ParseImpl; pages?: (b: Buffer) => Promise<{ page: number; text: string }[]> } = {}
): Promise<PdfExtraction> {
  const runPrimary = opts.primary ?? primaryParse;
  const runFallback = opts.fallback ?? fallbackParse;

  let primaryText = "";
  let primaryError: string | null = null;
  try {
    primaryText = (await runPrimary(bytes)) || "";
  } catch (e) {
    primaryError = e instanceof Error ? e.message : String(e);
  }

  if (primaryText.trim().length >= MIN_USEFUL) {
    // pdf-parse cannot report page boundaries: null is the honest answer.
    return { text: primaryText.trim(), via: "pdf-parse", primaryError, pages: null };
  }

  try {
    let pages: { page: number; text: string }[] | null = null;
    try {
      pages = opts.pages ? await opts.pages(bytes) : await fallbackParsePages(bytes);
    } catch {
      pages = null; // page map unavailable - reported honestly below
    }
    const fallbackText = ((await runFallback(bytes)) || "").trim();
    // Accept the fallback only when it adds real text, so promotion of noise
    // (an empty primary plus a few stray glyphs) cannot fake a successful read.
    if (fallbackText.length > primaryText.trim().length + 20) {
      return { text: fallbackText, via: "pdfjs", primaryError, pages };
    }
  } catch {
    // Both paths failed: report honestly, never a fabricated empty success.
  }

  return {
    text: primaryText.trim(),
    via: primaryText.trim() ? "pdf-parse" : "none",
    primaryError,
    // pdf-parse cannot report page boundaries: say so instead of inventing them.
    pages: null,
  };
}
