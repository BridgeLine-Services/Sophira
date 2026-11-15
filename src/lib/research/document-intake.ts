/**
 * DOCUMENT INTAKE FOR RESEARCH (directive 2026-11-15).
 *
 * Part 9 already let a student add a file, and reported a scan honestly as "this needs
 * OCR, which is not switched on". Now that the installation can read scans, that report
 * becomes a real read - but only when it actually worked.
 *
 * The rules, unchanged from Part 9:
 *  - A file Sophira cannot read is still reported, never guessed at.
 *  - A scan is only turned into a source when words were really read from it, and the
 *    result says the text came from a machine reading page images, so a student can weigh
 *    it against text that was genuinely in the file.
 *  - Nothing about the file is trusted as instruction; text inside it stays data.
 *
 * The OCR and PDF readers are injectable so the whole contract is tested without running
 * Tesseract anywhere.
 */
import {
  extractDocument,
  normalizeExtractedText,
  type DocumentExtraction,
} from "./documents";
import { ocrImage, type OcrResult } from "../extract/ocr";
import { extractPdfWithOcr, type PdfReadResult } from "../extract/pdf-ocr";
import { fileCapabilities, type CapabilityState } from "../capabilities/file-capabilities";

export interface ScanReadReport {
  attempted: boolean;
  applied: boolean;
  confidence: "high" | "medium" | "low" | "failed" | null;
  pagesRead: number[];
  stillUnread: number[];
  notes: string[];
  /** The capability state at the moment of the attempt, for honest reporting. */
  capabilityState: CapabilityState;
}

export interface DocumentIntakeResult {
  extraction: DocumentExtraction;
  /** Present only when the file was a scan or a picture and reading was attempted. */
  scan: ScanReadReport | null;
}

export interface IntakeDeps {
  env?: Record<string, string | undefined>;
  maxChars?: number;
  /** Injected by tests. */
  classify?: (bytes: Uint8Array, opts: { filename: string; maxChars: number }) => DocumentExtraction;
  readImage?: (bytes: Buffer, mime: string, env?: Record<string, string | undefined>) => Promise<OcrResult>;
  readPdf?: (bytes: Buffer, opts: { env?: Record<string, string | undefined> }) => Promise<PdfReadResult>;
}

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
};

export function imageMimeFor(filename: string): string {
  const ext = (filename.toLowerCase().match(/\.([a-z0-9]{2,5})$/) || [])[1] || "";
  return IMAGE_MIME[ext] || "image/png";
}

/** Rebuilds an extraction as "read", from words a machine actually recovered. */
export function extractionFromScan(
  base: DocumentExtraction,
  text: string,
  notes: string[],
  maxChars: number
): DocumentExtraction {
  const normalized = normalizeExtractedText(text);
  const clipped = normalized.length > maxChars ? normalized.slice(0, maxChars) : normalized;
  const allNotes = [...notes];
  if (normalized.length > maxChars) {
    allNotes.push(`Only the first ${maxChars.toLocaleString()} characters were kept; the file is longer.`);
  }
  return {
    ...base,
    status: "extracted",
    text: clipped,
    charCount: clipped.length,
    quotable: clipped.length > 0,
    notes: allNotes,
  };
}

export async function intakeDocument(
  bytes: Uint8Array,
  opts: IntakeDeps & { filename?: string } = {}
): Promise<DocumentIntakeResult> {
  const filename = opts.filename ?? "uploaded file";
  const maxChars = opts.maxChars ?? 200_000;
  const classify = opts.classify ?? extractDocument;
  const base = classify(bytes, { filename, maxChars });

  if (base.status !== "needs_ocr") return { extraction: base, scan: null };

  const env = opts.env ?? process.env;
  const readImage = opts.readImage ?? ((b: Buffer, mime: string, e?: Record<string, string | undefined>) => ocrImage(b, mime, { env: e }));
  const readPdf = opts.readPdf ?? ((b: Buffer, o: { env?: Record<string, string | undefined> }) => extractPdfWithOcr(b, o));

  const buffered = Buffer.from(bytes);

  if (base.kind === "image") {
    const cap = fileCapabilities(env).find((c) => c.id === "image_ocr");
    const result = await readImage(buffered, imageMimeFor(filename), env);
    const notes = result.ok
      ? [
          `Read from the words in this picture by the installation's own page reader (no outside service). The text was recovered from an image, so check names, numbers and symbols before quoting it.`,
          result.notes,
        ]
      : [`Sophira could not read this picture: ${result.notes}`];

    if (!result.ok) {
      return {
        extraction: { ...base, notes: [...base.notes, ...notes] },
        scan: {
          attempted: true,
          applied: false,
          confidence: null,
          pagesRead: [],
          stillUnread: [],
          notes,
          capabilityState: cap?.state ?? "requires_installation",
        },
      };
    }
    return {
      extraction: extractionFromScan(base, result.text, notes, maxChars),
      scan: {
        attempted: true,
        applied: true,
        confidence: result.confidence,
        pagesRead: [],
        stillUnread: [],
        notes,
        capabilityState: cap?.state ?? "available",
      },
    };
  }

  if (base.kind === "pdf") {
    const cap = fileCapabilities(env).find((c) => c.id === "scanned_pdf_ocr");
    const read = await readPdf(buffered, { env });
    const applied = Boolean(read.ocr?.applied) && read.text.trim().length > 0;
    const notes = applied
      ? [
          `Read from the page images of this PDF by the installation's own page reader (no outside service). ${read.ocr?.notes[0] ?? ""}`.trim(),
          // Always stated, even when the engine was confident: a machine reading is not the
          // printed page, and a wrong digit in a quotation is the student's problem later.
          "The text was recovered from page images, so check names, numbers and symbols before quoting it.",
          ...(read.ocr?.notes.slice(1) ?? []),
        ]
      : [
          read.ocr?.supported === false
            ? "This PDF is a scan, and the page reader cannot read PDF pages yet, so it was left unread rather than guessed at."
            : "This PDF is a scan that could not be read this time, so it was left unread rather than guessed at.",
          ...(read.ocr?.notes ?? []),
        ];

    if (!applied) {
      return {
        extraction: { ...base, notes: [...base.notes, ...notes] },
        scan: {
          attempted: Boolean(read.ocr),
          applied: false,
          confidence: null,
          pagesRead: [],
          stillUnread: read.ocr?.stillUnread ?? [],
          notes,
          capabilityState: cap?.state ?? "requires_installation",
        },
      };
    }

    return {
      extraction: extractionFromScan(base, read.text, notes, maxChars),
      scan: {
        attempted: true,
        applied: true,
        confidence: read.ocr?.confidence ?? null,
        pagesRead: read.ocr?.pagesRead ?? [],
        stillUnread: read.ocr?.stillUnread ?? [],
        notes,
        capabilityState: cap?.state ?? "available",
      },
    };
  }

  return { extraction: base, scan: null };
}
