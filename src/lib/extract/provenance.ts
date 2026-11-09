/**
 * EXTRACTION PROVENANCE (Phase 3a, 2026-11-09).
 *
 * WHY: Phase 3C requires that an extracted quotation retains its PDF page
 * number, and that missing/unreadable content is reported rather than
 * silently dropped. The existing extractors return flat text plus one
 * overall confidence; this module adds per-page (or per-slide) provenance
 * WITHOUT changing any existing response field, so current consumers keep
 * working.
 *
 * HONESTY RULES baked in here:
 *  - A page with no text layer is reported as scanned/unreadable, never as
 *    an empty page that "was read".
 *  - When a parser cannot report page boundaries (pdf-parse), the provenance
 *    says so (`pageMapCertain: false`) instead of inventing page numbers.
 *  - A high extraction confidence is a statement about READING the file, not
 *    about the document being factually correct.
 *
 * PURE ONLY: no I/O, no network, no parser imports - fully unit-testable.
 */

export type Confidence = "high" | "medium" | "low" | "failed";

export interface PageSpan {
  /** 1-based page/slide number as reported by the parser. */
  page: number;
  chars: number;
  confidence: Confidence;
  /** Plain-English reason when this page is not fully usable. */
  note?: string;
}

export interface Provenance {
  kind: "pdf" | "docx" | "pptx" | "xlsx" | "image" | "text" | "unknown";
  pages: PageSpan[];
  /** 1-based pages that appear to be scans with no text layer. */
  scannedPages: number[];
  confidence: Confidence;
  /** True when part of the document could not be read. */
  incomplete: boolean;
  /** False when the parser cannot report reliable page boundaries. */
  pageMapCertain: boolean;
  notes: string[];
}

/** A page below this many characters is treated as having no text layer. */
export const SCANNED_PAGE_CHARS = 15;

export function pageConfidence(chars: number): Confidence {
  if (chars <= 0) return "failed";
  if (chars < 80) return "low";
  if (chars < 400) return "medium";
  return "high";
}

const RANK: Record<Confidence, number> = { failed: 0, low: 1, medium: 2, high: 3 };

/** Overall confidence = the WORST page, because a partial read is partial. */
export function worstConfidence(levels: Confidence[]): Confidence {
  if (levels.length === 0) return "failed";
  return levels.reduce<Confidence>((worst, c) => (RANK[c] < RANK[worst] ? c : worst), "high");
}

export function buildPdfProvenance(
  pages: { page: number; text: string }[] | null,
  opts: { pageMapCertain?: boolean } = {}
): Provenance {
  const pageMapCertain = opts.pageMapCertain ?? Boolean(pages && pages.length > 0);
  if (!pages || pages.length === 0) {
    return {
      kind: "pdf",
      pages: [],
      scannedPages: [],
      confidence: "low",
      incomplete: true,
      pageMapCertain: false,
      notes: [
        "This PDF was read as one block of text, so page numbers are not reliable. If you quote from it, cite the PDF and the section name rather than an exact page.",
      ],
    };
  }
  const spans: PageSpan[] = pages.map((p) => {
    const chars = p.text.trim().length;
    const confidence = pageConfidence(chars);
    const span: PageSpan = { page: p.page, chars, confidence };
    if (chars < SCANNED_PAGE_CHARS) {
      span.note = "No text found on this page - it is probably a scan or an image. OCR is not available here, so its contents are missing.";
    }
    return span;
  });
  const scannedPages = spans.filter((s) => s.chars < SCANNED_PAGE_CHARS).map((s) => s.page);
  const notes: string[] = [];
  if (scannedPages.length > 0) {
    notes.push(
      `${scannedPages.length} page(s) had no readable text (${scannedPages.slice(0, 8).join(", ")}${scannedPages.length > 8 ? ", …" : ""}). The original file is kept; those pages need a clearer scan or a text version.`
    );
  }
  if (!pageMapCertain) {
    notes.push("Page numbers come from the PDF's page order and may not match printed page numbers.");
  }
  return {
    kind: "pdf",
    pages: spans,
    scannedPages,
    confidence: worstConfidence(spans.map((s) => s.confidence)),
    incomplete: scannedPages.length > 0,
    pageMapCertain,
    notes,
  };
}

/** DOCX / PPTX / XLSX / image / text: one honest span, no invented pages. */
export function buildSingleSpanProvenance(
  kind: Provenance["kind"],
  chars: number,
  notes: string[] = []
): Provenance {
  const confidence = pageConfidence(chars);
  return {
    kind,
    pages: chars > 0 ? [{ page: 1, chars, confidence }] : [],
    scannedPages: [],
    confidence,
    incomplete: chars === 0,
    pageMapCertain: false,
    notes: [
      ...notes,
      ...(kind === "docx" || kind === "pptx" || kind === "xlsx"
        ? ["This file was read as text; page/layout numbering is not available from this format."]
        : []),
    ],
  };
}

/**
 * Maps a character offset in the joined text back to a page number.
 * `pageLengths` must be the SAME lengths used to join the text (separator
 * included by the caller). Returns null when the map is unreliable.
 */
export function offsetToPage(
  prov: Provenance,
  offset: number,
  pageLengths: number[]
): number | null {
  if (!prov.pageMapCertain || pageLengths.length !== prov.pages.length) return null;
  let cursor = 0;
  for (let i = 0; i < pageLengths.length; i++) {
    cursor += pageLengths[i];
    if (offset < cursor) return prov.pages[i].page;
  }
  return prov.pages.length > 0 ? prov.pages[prov.pages.length - 1].page : null;
}

/** Plain-English one-liner for the UI (never claims more than was read). */
export function describeProvenance(prov: Provenance): string {
  if (prov.pages.length === 0) return "Nothing could be read from this file.";
  const label = prov.kind === "pdf" ? "page" : "section";
  const parts: string[] = [
    `Read ${prov.pages.length} ${label}${prov.pages.length === 1 ? "" : "s"} of the file.`,
  ];
  if (prov.scannedPages.length > 0) {
    parts.push(
      `${prov.scannedPages.length} ${label}${prov.scannedPages.length === 1 ? " has" : "s have"} no readable text (probably scans), so their contents are missing.`
    );
  }
  if (!prov.pageMapCertain) parts.push("Exact page numbers could not be confirmed.");
  parts.push("Reading the file correctly does not guarantee its contents are accurate.");
  return parts.join(" ");
}
