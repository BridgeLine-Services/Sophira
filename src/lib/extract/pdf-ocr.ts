/**
 * SCANNED PDF READING (directive 2026-11-15: provider-key optimisation, part 1).
 *
 * WHY THIS EXISTS
 * A scanned PDF has pixels and no text layer. Before this file, Sophira read the file,
 * correctly found no words, and said so ("this looks like a scan"). Honest, but not
 * useful: the student's handout stayed unreadable. The OCR client already existed for
 * IMAGES (`src/lib/extract/ocr.ts`) and talks to the owner's own Tesseract service over
 * the contract in `docs/SELF_HOSTED_OCR_ASR.md`. What was missing was the PDF half:
 * finding WHICH pages have no text layer and asking the service to read exactly those.
 *
 * WHERE THE WORK HAPPENS, AND WHY
 * A Vercel function cannot rasterise a PDF and cannot run Tesseract (no native binary,
 * no unlimited CPU, a size and time budget). So Sophira does not pretend to do it
 * locally in the web deployment: it sends the PDF to the OCR service the owner already
 * runs, which uses poppler + tesseract on that machine. No new vendor, no new key, no
 * per-page fee. When that service is absent or too old to offer the PDF route, the
 * result says exactly that and the file is left untouched.
 *
 * RULES BAKED IN (they are the reason this module is testable without a service)
 *  1. Never OCR a page that already has a text layer. Extraction that works is kept.
 *  2. Never invent a page. A page the service did not return is reported as unread,
 *     never as empty and never as text pulled from a neighbouring page.
 *  3. Page numbers come from the parser's page map, not from the model or the service's
 *     ordering, so a quotation keeps the page it was really printed on.
 *  4. Confidence is the service's own mean confidence banded conservatively; a page with
 *     no mean confidence is "low", never "high".
 *  5. A file that cannot be read is refused, not filled in.
 */
import { postSelfHosted } from "../media/selfhost";
import { extractPdfText, type PdfExtraction } from "./pdf";
import { SCANNED_PAGE_CHARS, type Confidence } from "./provenance";

export interface OcrPageRead {
  page: number;
  text: string;
  confidence: Confidence;
  /** 0..1 when the service reported one, else null (never assumed). */
  meanConfidence: number | null;
}

export interface PdfOcrAttempt {
  /** True when the service was actually asked. */
  attempted: boolean;
  /** False when the service answered but has no PDF route (it needs updating). */
  supported: boolean;
  engine: "tesseract-selfhost" | "none";
  pages: OcrPageRead[];
  /** Page numbers Sophira asked for. */
  requested: number[];
  /** Requested pages the service did not return readable text for. */
  unread: number[];
  /** Scanned pages left for a later pass because this one was bounded. */
  skipped: number[];
  notes: string[];
}

/** A page below this many characters has no usable text layer. */
export const PDF_OCR_MIN_CHARS = SCANNED_PAGE_CHARS;

/** Bounded so one request cannot become a 400-page job with no timeout. */
export const MAX_OCR_PAGES_PER_PASS = 40;

/** The service's file size ceiling for one document. */
export const MAX_PDF_OCR_BYTES = 25 * 1024 * 1024;

type PostFn = typeof postSelfHosted;

function normalizeMean(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const v = raw > 1 ? raw / 100 : raw; // wrappers differ: 0..1 or 0..100
  return Math.max(0, Math.min(1, v));
}

function band(mean: number | null): Confidence {
  if (mean === null) return "low";
  if (mean >= 0.85) return "high";
  if (mean >= 0.65) return "medium";
  if (mean > 0) return "low";
  return "failed";
}

/**
 * Which pages actually need reading. Only pages in the parser's page map can be named
 * with certainty, so a null map returns an empty list instead of a guess.
 */
export function pagesWithoutText(
  pages: { page: number; text: string }[] | null | undefined,
  minChars = PDF_OCR_MIN_CHARS
): number[] {
  if (!pages || pages.length === 0) return [];
  const out: number[] = [];
  for (const p of pages) {
    const text = (p.text ?? "").replace(/\s+/g, " ").trim();
    if (text.length < minChars) out.push(p.page);
  }
  return out;
}

/**
 * Normalises whatever the service returned. Pure, so the contract is tested without a
 * server: only requested pages are accepted, text must be real, duplicates keep the
 * first, and everything requested but not returned is reported unread.
 */
export function normalizePdfOcrPayload(
  json: unknown,
  requested: number[],
  opts: { minChars?: number } = {}
): { pages: OcrPageRead[]; unread: number[]; rejected: number } {
  const minChars = opts.minChars ?? 1;
  const wanted = new Set(requested);
  const raw = (json ?? {}) as { pages?: unknown };
  const list = Array.isArray(raw.pages) ? (raw.pages as Record<string, unknown>[]) : [];
  const byPage = new Map<number, OcrPageRead>();
  let rejected = 0;

  for (const entry of list) {
    const pageNum = typeof entry?.page === "number" && Number.isFinite(entry.page) ? Math.round(entry.page) : null;
    if (pageNum === null || !wanted.has(pageNum) || byPage.has(pageNum)) {
      rejected++;
      continue;
    }
    const text = typeof entry.text === "string" ? entry.text.trim() : "";
    if (text.length < minChars) continue; // reported unread below, never padded
    const mean = normalizeMean(entry.mean_confidence ?? entry.confidence);
    byPage.set(pageNum, { page: pageNum, text, confidence: band(mean), meanConfidence: mean });
  }

  const pages = [...byPage.values()].sort((a, b) => a.page - b.page);
  const unread = requested.filter((p) => !byPage.has(p)).sort((a, b) => a - b);
  return { pages, unread, rejected };
}

function emptyAttempt(notes: string[], supported: boolean): PdfOcrAttempt {
  return { attempted: false, supported, engine: "none", pages: [], requested: [], unread: [], skipped: [], notes };
}

/**
 * Asks the owner's OCR service to read the given pages of a PDF.
 * Never throws: every failure is a sentence a person can act on.
 */
export async function ocrPdfPages(
  bytes: Uint8Array,
  pages: number[],
  opts: {
    timeoutMs?: number;
    env?: Record<string, string | undefined>;
    language?: string;
    post?: PostFn;
    maxPages?: number;
  } = {}
): Promise<PdfOcrAttempt> {
  const post = opts.post ?? postSelfHosted;
  const requested = [...new Set(pages.filter((p) => Number.isFinite(p) && p > 0))].sort((a, b) => a - b);
  if (requested.length === 0) return emptyAttempt(["No page of this file needed reading; its own text was kept."], true);
  if (bytes.byteLength === 0) {
    return { ...emptyAttempt(["The file was empty, so there was nothing to read."], true), requested };
  }
  if (bytes.byteLength > MAX_PDF_OCR_BYTES) {
    return {
      ...emptyAttempt(
        [`This file is larger than the ${Math.round(MAX_PDF_OCR_BYTES / 1024 / 1024)} MB limit for reading a scan, so it was not processed. Your original file was kept.`],
        true
      ),
      requested,
    };
  }

  const cap = opts.maxPages ?? MAX_OCR_PAGES_PER_PASS;
  const batch = requested.slice(0, cap);
  const skipped = requested.slice(cap);

  const form = new FormData();
  form.append("file", new Blob([Buffer.from(bytes)], { type: "application/pdf" }), "document.pdf");
  form.append("pages", batch.join(","));
  form.append("language", opts.language || "eng");

  const res = await post("ocr", "/ocr/pdf", form, { timeoutMs: opts.timeoutMs ?? 120000, env: opts.env });

  if (!res.ok) {
    const notOffered = /^status-(404|405|501)$/.test(res.reason);
    if (res.reason === "not-configured") {
      return { ...emptyAttempt(["No reading service is configured, so this scan was left unread. Your original file was kept."], false), requested, skipped };
    }
    if (notOffered) {
      return {
        ...emptyAttempt(
          ["The reading service is running but cannot read PDF pages yet, so this scan was left unread. Your original file was kept. The service needs its PDF step added before scans can be read."],
          false
        ),
        requested,
        skipped,
      };
    }
    const reason =
      res.reason === "timeout"
        ? "Reading these pages took too long and was stopped, so nothing was invented. Try a smaller file or fewer pages."
        : "The reading service could not process this PDF right now. Your original file was kept.";
    return { ...emptyAttempt([reason], true), requested, skipped };
  }

  const normalized = normalizePdfOcrPayload(res.json, batch);
  const notes: string[] = [];
  if (normalized.pages.length === 0) {
    notes.push("No readable text was found on the scanned pages. They may be handwriting, diagrams, or too faint to read.");
  } else {
    const weak = normalized.pages.filter((p) => p.confidence === "low" || p.confidence === "failed").map((p) => p.page);
    notes.push(
      weak.length
        ? `Read ${normalized.pages.length} scanned page${normalized.pages.length === 1 ? "" : "s"}; page${weak.length === 1 ? "" : "s"} ${weak.join(", ")} came through uncertain, so check names, numbers and symbols there.`
        : `Read ${normalized.pages.length} scanned page${normalized.pages.length === 1 ? "" : "s"} from the scan. Check numbers and symbols before quoting.`
    );
  }
  if (normalized.unread.length) {
    notes.push(`Page${normalized.unread.length === 1 ? "" : "s"} ${normalized.unread.join(", ")} could not be read and are left blank rather than guessed.`);
  }
  if (normalized.rejected) notes.push("Some pages the service returned were not requested, so they were ignored.");
  if (skipped.length) {
    notes.push(`${skipped.length} more scanned page${skipped.length === 1 ? "" : "s"} were not read in this pass, because Sophira reads up to ${cap} scanned pages at a time.`);
  }

  return {
    attempted: true,
    supported: true,
    engine: "tesseract-selfhost",
    pages: normalized.pages,
    requested,
    unread: normalized.unread,
    skipped,
    notes,
  };
}

export interface MergedScannedRead {
  pages: { page: number; text: string }[];
  text: string;
  /** Pages whose text came from the scan. */
  ocrPages: number[];
  /** Pages that still have no words after this pass. */
  stillUnread: number[];
  confidence: Confidence;
  notes: string[];
}

/**
 * Puts the read pages back where they belong. A page that already had text keeps it
 * verbatim; only a page with no text layer is filled. Pure and deterministic.
 */
export function mergeOcrIntoPages(
  pages: { page: number; text: string }[],
  attempt: PdfOcrAttempt,
  opts: { minChars?: number } = {}
): MergedScannedRead {
  const minChars = opts.minChars ?? PDF_OCR_MIN_CHARS;
  const readings = new Map(attempt.pages.map((p) => [p.page, p]));
  const ocrPages: number[] = [];
  const stillUnread: number[] = [];
  const out = pages.map((p) => {
    const own = (p.text ?? "").trim();
    if (own.replace(/\s+/g, " ").length >= minChars) return { page: p.page, text: p.text };
    const read = readings.get(p.page);
    if (read) {
      ocrPages.push(p.page);
      return { page: p.page, text: read.text };
    }
    stillUnread.push(p.page);
    return { page: p.page, text: "" };
  });

  const text = out
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join("\n\n");

  const readConfidences = attempt.pages.map((p) => p.confidence);
  const weakest: Confidence = readConfidences.length === 0
    ? "failed"
    : readConfidences.reduce<Confidence>((worst, c) => {
        const rank: Record<Confidence, number> = { failed: 0, low: 1, medium: 2, high: 3 };
        return rank[c] < rank[worst] ? c : worst;
      }, "high");

  return {
    pages: out,
    text,
    ocrPages: [...ocrPages].sort((a, b) => a - b),
    stillUnread: [...stillUnread].sort((a, b) => a - b),
    confidence: text ? weakest : "failed",
    notes: attempt.notes,
  };
}

export interface PdfReadResult {
  text: string;
  via: PdfExtraction["via"];
  pages: { page: number; text: string }[] | null;
  primaryError: string | null;
  /** Empty unless the scan-read attempt ran, so callers can report it truthfully. */
  ocr: {
    applied: boolean;
    supported: boolean;
    engine: PdfOcrAttempt["engine"];
    pagesRead: number[];
    stillUnread: number[];
    skipped: number[];
    confidence: Confidence;
    notes: string[];
  } | null;
}

/**
 * Read a PDF, and read its scanned pages with OCR ONLY when they have no text.
 * A normal text PDF costs exactly what it cost before: no service call at all.
 */
export async function extractPdfWithOcr(
  bytes: Buffer,
  opts: {
    env?: Record<string, string | undefined>;
    post?: PostFn;
    maxPages?: number;
    extract?: (b: Buffer) => Promise<PdfExtraction>;
  } = {}
): Promise<PdfReadResult> {
  const pdf = opts.extract ? await opts.extract(bytes) : await extractPdfText(bytes);
  const base: PdfReadResult = { text: pdf.text, via: pdf.via, pages: pdf.pages ?? null, primaryError: pdf.primaryError, ocr: null };

  // No reliable page map means OCR could not keep page numbers honest, so it is not
  // attempted; the caller reports the file as read but without page numbers.
  const measured = pagesWithoutText(pdf.pages ?? null);
  if (!pdf.pages || pdf.pages.length === 0 || measured.length === 0) return base;

  const attempt = await ocrPdfPages(bytes, measured, { env: opts.env, post: opts.post, maxPages: opts.maxPages });
  const merged = mergeOcrIntoPages(pdf.pages, attempt);

  const ocr = {
    applied: attempt.attempted && attempt.pages.length > 0,
    supported: attempt.supported,
    engine: attempt.engine,
    pagesRead: merged.ocrPages,
    stillUnread: merged.stillUnread,
    skipped: attempt.skipped,
    confidence: merged.confidence,
    notes: merged.notes,
  };

  // A failed attempt never overwrites text that was already extracted.
  if (!ocr.applied) return { ...base, ocr };

  return { ...base, text: merged.text, pages: merged.pages, ocr };
}

/** Plain sentence for a member, describing what happened to a scanned PDF. */
export function describePdfOcr(result: PdfReadResult): string | null {
  if (!result.ocr) return null;
  if (!result.ocr.applied) {
    if (!result.ocr.supported) {
      return "This PDF is a scan, and Sophira's reading service cannot read PDF pages yet. The file was kept and nothing was guessed; paste the text if you need to quote it.";
    }
    return "This PDF is a scan and could not be read this time. The file was kept; try a clearer copy or paste the text you need.";
  }
  return [result.ocr.notes[0], result.ocr.notes.slice(1).join(" ")].filter(Boolean).join(" ").trim() || null;
}
