/**
 * READING AN UPLOADED FILE (directive 2026-11-15).
 *
 * WHY THIS MOVED OUT OF THE ROUTE
 * The directive asks for a model pass over a student's own document that reuses the same
 * provider, the same extraction and the same honesty rules. That is impossible while the
 * extraction lives inside one route's private function: a second route would have to copy
 * it, and two copies drift. So the function is now here, byte-for-byte the behaviour it
 * had, with two additions:
 *
 *  1. A scanned PDF is read from its pages (part 1). A PDF whose own text layer is fine
 *     never touches the OCR service, so ordinary documents cost exactly what they did.
 *  2. Provenance is returned with the text, including what OCR did per page, so a caller
 *     can keep page numbers instead of flattening a document into anonymous prose.
 *
 * Everything else - the honest failure messages, the "very little text" warnings, the
 * unsupported-format sentence - is unchanged, because those sentences are what a student
 * sees when reading fails.
 */
import { docxHtmlToStructuredText, parsePptx, parseSpreadsheet, parseCsv } from "./documents";
import { buildPdfProvenance } from "./provenance";
import { describePdfOcr, extractPdfWithOcr, type PdfReadResult } from "./pdf-ocr";
import type { PdfExtraction } from "./pdf";
import { aiChat, aiConfigured, parseJsonLoose } from "@/lib/ai/client";

export interface Extraction {
  text: string;
  confidence: "high" | "medium" | "low" | "failed";
  /** Additive: page-level provenance (PDF today), including any scan reading. */
  provenance?: unknown;
  notes: string;
}

const RANK: Record<Extraction["confidence"], number> = { failed: 0, low: 1, medium: 2, high: 3 };

function worse(a: Extraction["confidence"], b: Extraction["confidence"]): Extraction["confidence"] {
  return RANK[b] < RANK[a] ? b : a;
}

/** Provenance for a PDF, with the scan-read outcome attached when there was one. */
export function pdfProvenance(result: PdfReadResult) {
  const base = buildPdfProvenance(result.pages ?? null);
  if (!result.ocr) return base;
  return {
    ...base,
    // Additive block. Existing consumers read pages/confidence/notes exactly as before.
    ocr: {
      applied: result.ocr.applied,
      engine: result.ocr.engine,
      pagesRead: result.ocr.pagesRead,
      stillUnread: result.ocr.stillUnread,
      skipped: result.ocr.skipped,
      confidence: result.ocr.confidence,
      supported: result.ocr.supported,
    },
  };
}

export async function readUploadedFile(
  bytes: Buffer,
  opts: {
    mime: string;
    name: string;
    /** Injected only by tests, so the scan-read contract is exercised without a server. */
    ocrPost?: NonNullable<NonNullable<Parameters<typeof extractPdfWithOcr>[1]>["post"]>;
    /** Injected only by tests, to supply a page map without a real PDF on disk. */
    extractPdf?: (b: Buffer) => Promise<PdfExtraction>;
    env?: Record<string, string | undefined>;
  }
): Promise<Extraction> {
  const mime = opts.mime || "";
  const name = opts.name || "";
  const lower = name.toLowerCase();

  if (mime.startsWith("text/") || /\.(txt|md|csv|tex|json)$/.test(lower)) {
    const text = bytes.toString("utf8");
    return { text, confidence: "high", notes: "Plain text file read directly." };
  }

  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    const pdf = await extractPdfWithOcr(bytes, { post: opts.ocrPost, extract: opts.extractPdf, env: opts.env });
    const clean = (pdf.text || "").trim();
    if (pdf.via === "none") {
      return {
        text: "",
        confidence: "failed",
        notes: "This PDF could not be read (it may be corrupted or password-protected). Try a different export or paste the text.",
      };
    }

    const scanNote = describePdfOcr(pdf);
    const provenance = pdfProvenance(pdf);
    const ocrConfidence = pdf.ocr?.applied ? pdf.ocr.confidence : "high";

    if (clean.length < 80) {
      return {
        text: clean,
        // Text recovered from a scan is never better than the reading that recovered it.
        confidence: worse("low", ocrConfidence),
        notes: [
          clean.length > 0
            ? "Only a little text could be read from this PDF."
            : "This PDF contained no readable text. It may be a scanned image (no embedded text).",
          scanNote,
          "Try exporting it as a text-based PDF, take a clear photo of the page, or paste the text.",
        ]
          .filter(Boolean)
          .join(" "),
        provenance,
      };
    }

    return {
      text: clean,
      confidence: worse("high", ocrConfidence),
      notes: [
        pdf.ocr?.applied
          ? "Some pages were scans and were read from the page images; check names, numbers and symbols on those pages before quoting them. Layout and tables may be imperfect."
          : "Text extracted from PDF. Layout, tables, and math formatting may be imperfect - please review.",
        scanNote,
      ]
        .filter(Boolean)
        .join(" "),
      provenance,
    };
  }

  if (mime.startsWith("image/")) {
    // The OWNER'S self-hosted Tesseract first: free, local, no vendor.
    {
      const { ocrImage } = await import("./ocr");
      const ocr = await ocrImage(bytes, mime, { env: opts.env });
      if (ocr.ok) {
        return {
          text: ocr.text,
          confidence: ocr.confidence,
          notes: ocr.notes,
          provenance: {
            kind: "image",
            engine: ocr.engine,
            meanConfidence: ocr.meanConfidence,
          },
        };
      }
      // A configured service that returned nothing is a real signal (handwriting, a
      // diagram): report it honestly instead of asking a cloud model to guess.
      if (ocr.engine === "tesseract-selfhost") {
        return { text: "", confidence: "failed", notes: ocr.notes };
      }
    }
    if (!aiConfigured()) {
      const { fileCapabilities } = await import("@/lib/capabilities/file-capabilities");
      const cap = fileCapabilities(opts.env ?? process.env).find((c) => c.id === "image_ocr");
      throw new Error(
        cap?.studentMessage ||
          "Reading text from pictures is not set up on this installation yet. Please type or paste the question instead."
      );
    }
    const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
    const raw = await aiChat(
      [
        { role: "system", content: "You transcribe academic documents and handwritten work from photos. Extract ALL visible text, questions, equations, and instructions EXACTLY as shown, including handwritten mathematics (use plain text math notation: x^2, sqrt(x), a/b, integral notation as INT[f(x)]dx). If the image is handwritten, say so in notes. HONESTY: if any part is blurry, cut off, or unreadable, list it in 'unreadable' — NEVER guess or fabricate missing text, exponents, or digits. Respond only with JSON: {\"text\": \"...\", \"confidence\": \"high|medium|low\", \"notes\": \"...\", \"is_handwriting\": true|false, \"unreadable\": [\"...\"]}" },
        { role: "user", content: "Extract the text from this image." },
      ],
      { temperature: 0, maxTokens: 3000, jsonMode: true, images: [dataUrl] }
    );
    const parsed = parseJsonLoose<{ text?: string; confidence?: string; notes?: string; is_handwriting?: boolean; unreadable?: string[] }>(raw);
    if (!parsed || typeof parsed.text !== "string" || !parsed.text.trim()) {
      return { text: "", confidence: "failed", notes: "I could not read this image reliably. Please take a clearer photo (more light, no blur, text filling the frame) or type the question." };
    }
    const unread = (parsed.unreadable || []).filter(Boolean);
    const conf = (["high", "medium", "low"] as const).includes(parsed.confidence as "high") ? (parsed.confidence as "high" | "medium" | "low") : "low";
    const notes = [
      parsed.notes,
      parsed.is_handwriting ? "Handwriting detected — please review the interpretation carefully before solving." : null,
      unread.length ? `Unreadable parts: ${unread.join("; ")}` : null,
    ].filter(Boolean).join(" ") || "Transcribed from image.";
    return { text: parsed.text, confidence: unread.length ? (conf === "high" ? "medium" : conf) : conf, notes };
  }

  if (mime.includes("wordprocessingml") || lower.endsWith(".docx")) {
    // DOCX support (spec §11): mammoth converts to HTML, then we preserve
    // document structure (headings, lists, tables) as lightweight Markdown-ish
    // text instead of a wall of prose.
    try {
      const mammoth = await import("mammoth");
      const { value: html } = await mammoth.convertToHtml({ buffer: bytes });
      const text = docxHtmlToStructuredText(html);
      const clean = text.trim();
      if (clean.length < 80) {
        return { text: clean, confidence: "low", notes: "This Word document contained very little text (it may be mostly images). Try a PDF export, a photo of the page, or paste the text." };
      }
      return {
        text: clean,
        confidence: "high",
        notes: "Text extracted from the Word document with headings, lists, and tables preserved where possible. Equations embedded as images could not be read — check any math carefully.",
      };
    } catch {
      return { text: "", confidence: "failed", notes: "This Word document could not be read (it may be corrupted, or an older .doc format — only .docx is supported). Export it as PDF or paste the text." };
    }
  }

  if (mime.includes("presentationml") || lower.endsWith(".pptx")) {
    try {
      const { text, notes } = await parsePptx(bytes);
      const clean = text.trim();
      if (clean.length < 40) {
        return { text: clean, confidence: "low", notes: "This presentation contains almost no readable text (it may be all images). Try exporting as PDF or photograph the important slides." };
      }
      return { text: clean, confidence: "high", notes };
    } catch {
      return { text: "", confidence: "failed", notes: "This PowerPoint could not be read (only .pptx is supported — not .ppt or .pptm). Export it as PDF or paste the text." };
    }
  }

  if (mime.includes("spreadsheetml") || /\.xlsx$/.test(lower)) {
    try {
      const { text, notes } = await parseSpreadsheet(bytes);
      return { text: text.trim(), confidence: "high", notes };
    } catch {
      return { text: "", confidence: "failed", notes: "This Excel workbook could not be read (only .xlsx is supported — not legacy .xls). Export it as CSV or paste the data." };
    }
  }

  if (mime === "text/csv" || lower.endsWith(".csv")) {
    const text = bytes.toString("utf8");
    if (!text.trim()) return { text: "", confidence: "failed", notes: "This CSV file is empty." };
    return { text: parseCsv(text).text, confidence: "high", notes: parseCsv(text).notes };
  }

  return { text: "", confidence: "failed", notes: `Unsupported file type${mime ? ` (${mime})` : ""}. I can read PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), CSV, plain text/Markdown, and images. You can always paste the text instead.` };
}
