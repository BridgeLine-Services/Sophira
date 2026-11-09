/**
 * SELF-HOSTED TESSERACT OCR (Phase 3b, 2026-11-09).
 *
 * Reads text from an IMAGE using the owner's own Tesseract service. No vendor,
 * no per-page fee, no new subscription. When the service is absent or unsure,
 * the result says so — Sophira never invents characters, digits or symbols.
 *
 * Confidence mapping is deliberately conservative:
 *   >= 0.85 high · >= 0.65 medium · > 0 low · empty/0 failed
 * "high" means the OCR engine was confident about the TRANSCRIPTION. It is not
 * a claim that the document's contents are correct, and callers must still
 * treat the text as untrusted input.
 */
import { postSelfHosted, readSelfHostedConfig } from "../media/selfhost";

export type OcrConfidence = "high" | "medium" | "low" | "failed";

export interface OcrResult {
  ok: boolean;
  text: string;
  confidence: OcrConfidence;
  engine: "tesseract-selfhost" | "none";
  /** 0..1 when the service reported one, else null */
  meanConfidence: number | null;
  notes: string;
}

export const MAX_OCR_BYTES = 10 * 1024 * 1024;

function normalizeConfidence(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  // Accept both 0..1 and 0..100 scales (Tesseract wrappers differ).
  const v = raw > 1 ? raw / 100 : raw;
  return Math.max(0, Math.min(1, v));
}

function band(mean: number | null): OcrConfidence {
  if (mean === null) return "low";
  if (mean >= 0.85) return "high";
  if (mean >= 0.65) return "medium";
  if (mean > 0) return "low";
  return "failed";
}

export async function ocrImage(
  bytes: Uint8Array,
  mime: string,
  opts: { timeoutMs?: number; env?: Record<string, string | undefined>; language?: string } = {}
): Promise<OcrResult> {
  const cfg = readSelfHostedConfig("ocr", opts.env ?? process.env);
  if (!cfg.configured) {
    return {
      ok: false,
      text: "",
      confidence: "failed",
      engine: "none",
      meanConfidence: null,
      notes: "No self-hosted OCR service is configured.",
    };
  }
  if (bytes.byteLength === 0) {
    return {
      ok: false,
      text: "",
      confidence: "failed",
      engine: "none",
      meanConfidence: null,
      notes: "The image was empty, so there was nothing to read. Your original file was kept.",
    };
  }
  if (bytes.byteLength > MAX_OCR_BYTES) {
    return {
      ok: false,
      text: "",
      confidence: "failed",
      engine: "none",
      meanConfidence: null,
      notes: "This image is larger than the 10 MB limit for reading, so it was not processed. Your original file was kept.",
    };
  }

  const form = new FormData();
  form.append("file", new Blob([Buffer.from(bytes)], { type: mime || "image/png" }), "image");
  form.append("language", opts.language || "eng");

  const res = await postSelfHosted("ocr", "/ocr", form, { timeoutMs: opts.timeoutMs ?? 60000, env: opts.env });
  if (!res.ok) {
    const reason =
      res.reason === "timeout"
        ? "Reading the image took too long, so Sophira stopped instead of guessing. Try a smaller or clearer image."
        : res.reason === "not-configured"
          ? "No self-hosted OCR service is configured."
          : "The self-hosted OCR service could not read this image right now. Your original file was kept.";
    return { ok: false, text: "", confidence: "failed", engine: "none", meanConfidence: null, notes: reason };
  }

  const payload = res.json as { text?: unknown; confidence?: unknown; mean_confidence?: unknown };
  const text = typeof payload?.text === "string" ? payload.text : "";
  const mean = normalizeConfidence(payload?.mean_confidence ?? payload?.confidence);
  const trimmed = text.trim();

  if (!trimmed) {
    return {
      ok: false,
      text: "",
      confidence: "failed",
      engine: "tesseract-selfhost",
      meanConfidence: mean,
      notes: "No readable text was found in this image. It may be a photo of handwriting, a diagram, or too blurry to read. Your original file was kept — you can paste the text instead.",
    };
  }

  const confidence = band(mean);
  const caveat =
    confidence === "high"
      ? "Text was read from the image. Please check that numbers and symbols came through correctly."
      : "Text was read from the image but the reading was uncertain in places. Check it carefully before using it — especially numbers, symbols and names.";
  return { ok: true, text: trimmed, confidence, engine: "tesseract-selfhost", meanConfidence: mean, notes: caveat };
}
