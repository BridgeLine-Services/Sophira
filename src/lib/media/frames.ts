/**
 * Frame sampling rules (pure - no network, no database, no DOM).
 *
 * A lecture video is mostly a person talking. The material worth keeping is on
 * the slides, so Sophira samples moments, reads the text in each one, and keeps
 * only what it actually recognised.
 *
 * These rules exist to stop three specific lies:
 *  1. "We captured the diagram" when the frame was a talking head (a frame with
 *     almost no readable text is kept as a scene, never described as a slide).
 *  2. "Here are 40 slides" when the same slide was on screen for eight minutes
 *     (identical recognised text is deduplicated, and the duplicate count is
 *     reported instead of silently inflating the library).
 *  3. "The text says ..." when OCR returned nothing (an unreadable frame stores
 *     an empty text with a plain-English reason, never a guess).
 */
export type FrameKind = "slide" | "diagram" | "chart" | "table" | "scene" | "unknown";
export type FrameConfidence = "high" | "medium" | "low" | "failed";

export const FRAME_LIMITS = {
  /** One sampled still, after the browser scales it down. */
  maxBytes: 4 * 1024 * 1024,
  /** Most frames stored for one recording (matches the planner cap). */
  maxFramesPerAsset: 40,
  /** Shortest gap the planner allows between samples. */
  minGapSec: 5,
} as const;

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface FrameUploadCheck {
  ok: boolean;
  code: "empty" | "too_large" | "not_image" | "bad_time" | "too_many" | null;
  memberNote: string;
}

export function validateFrameUpload(input: {
  mime?: string;
  byteSize?: number;
  atSec?: number;
  existingCount?: number;
}): FrameUploadCheck {
  const mime = (input.mime ?? "").toLowerCase().trim();
  const size = Number(input.byteSize ?? 0);
  const at = Number(input.atSec ?? 0);
  const existing = Number(input.existingCount ?? 0);

  if (!Number.isFinite(at) || at < 0) {
    return { ok: false, code: "bad_time", memberNote: "That frame has no valid position in the recording, so it was not saved." };
  }
  if (size <= 0) {
    return { ok: false, code: "empty", memberNote: "That frame came through empty, so there is nothing to read." };
  }
  if (size > FRAME_LIMITS.maxBytes) {
    return {
      ok: false,
      code: "too_large",
      memberNote: `That frame is ${(size / 1024 / 1024).toFixed(1)} MB. Sampled frames must be under ${FRAME_LIMITS.maxBytes / 1024 / 1024} MB, so Sophira can scale it down and try again.`,
    };
  }
  if (!ALLOWED_IMAGE_MIME.has(mime)) {
    return { ok: false, code: "not_image", memberNote: "Sampled frames must be JPEG, PNG or WebP images." };
  }
  if (existing >= FRAME_LIMITS.maxFramesPerAsset) {
    return {
      ok: false,
      code: "too_many",
      memberNote: `This recording already has ${FRAME_LIMITS.maxFramesPerAsset} sampled frames, which is the limit. Nothing further was stored.`,
    };
  }
  return { ok: true, code: null, memberNote: "" };
}

/** Normalizes recognised text so the same slide counted twice is caught. */
export function textFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classifies what was recognised. Deliberately conservative: a slide needs real
 * text AND reasonable OCR confidence; a chart or table needs the numeric/row
 * shape that distinguishes it; anything else is a scene, and unreadable stays
 * 'unknown' rather than being labelled a slide.
 */
export function classifyFrame(input: {
  text: string;
  meanConfidence: number | null;
  ok: boolean;
}): FrameKind {
  if (!input.ok) return "unknown";
  const text = input.text.trim();
  if (text.length < 12) return "scene";

  const lines = text.split(/\n+/).filter((l) => l.trim().length > 0);
  const digits = (text.match(/\d/g) ?? []).length;
  const words = text.split(/\s+/).filter(Boolean);
  const numericRatio = words.length === 0 ? 0 : digits / Math.max(text.length, 1);
  const hasPercentOrCurrency = /[%$€£]\s?\d|\d\s?%/.test(text);
  const columnarLines = lines.filter((l) => /\s{2,}/.test(l)).length;

  if (lines.length >= 4 && columnarLines >= Math.max(2, Math.floor(lines.length / 2))) return "table";
  if (numericRatio > 0.12 || hasPercentOrCurrency) return "chart";
  if (input.meanConfidence !== null && input.meanConfidence < 0.35) return "unknown";
  if (text.length >= 40 && lines.length >= 2) return "slide";
  return "diagram";
}

/** Confidence word for a frame, in the same four words the rest of Sophira uses. */
export function frameConfidence(input: { ok: boolean; text: string; meanConfidence: number | null }): FrameConfidence {
  if (!input.ok || input.text.trim().length === 0) return "failed";
  const length = input.text.trim().length;
  // A handful of characters is never more than 'low', however sure the engine
  // sounds: there is not enough text to be confident ABOUT.
  if (length < 20) return "low";
  if (input.meanConfidence === null) return length >= 40 ? "medium" : "low";
  if (input.meanConfidence >= 0.7 && length >= 40) return "high";
  if (input.meanConfidence >= 0.45) return "medium";
  return "low";
}

/** Plain-English note for the member. */
export function frameNote(kind: FrameKind, confidence: FrameConfidence, textLength: number): string {
  if (confidence === "failed") {
    return "Sophira sampled this moment but could not read any text in it, so nothing was written down. The still was kept so you can check it yourself.";
  }
  if (kind === "scene") return "This moment looks like a person or a room rather than a slide, so no text was expected.";
  if (kind === "unknown") return "Text was found here but Sophira is not confident it read it correctly, so treat the extracted text as partial.";
  if (textLength < 40) return "Only a few words were readable in this moment.";
  return `Read ${textLength} characters from this ${kind}.`;
}

export interface FrameRowInput {
  assetId: string;
  userId: string;
  atSec: number;
  storagePath: string;
  text: string;
  kind: FrameKind;
  confidence: FrameConfidence;
  memberNote: string;
}

export function frameRowFor(input: FrameRowInput) {
  return {
    asset_id: input.assetId,
    user_id: input.userId,
    at_sec: Math.round(Math.max(0, input.atSec) * 10) / 10,
    storage_path: input.storagePath,
    recognised_text: input.text.slice(0, 8000),
    frame_kind: input.kind,
    confidence: input.confidence,
    member_note: input.memberNote,
  };
}

/**
 * Decides whether a new frame adds anything. Returns the duplicate marker and
 * the plain-English reason, so a thin lecture does not pretend to be rich.
 */
export function dedupeFrame(
  candidate: { fingerprint: string },
  existing: { fingerprint: string; atSec: number }[]
): { duplicate: boolean; duplicateOfAtSec: number | null } {
  if (!candidate.fingerprint) return { duplicate: false, duplicateOfAtSec: null };
  const hit = existing.find((e) => e.fingerprint === candidate.fingerprint);
  return hit ? { duplicate: true, duplicateOfAtSec: hit.atSec } : { duplicate: false, duplicateOfAtSec: null };
}

/** Summary sentence for a finished sampling run. */
export function samplingSummary(counts: { stored: number; duplicates: number; unreadable: number }): string {
  if (counts.stored === 0 && counts.duplicates === 0) {
    return "No slides could be read from this recording. Nothing was invented.";
  }
  const parts = [`Saved ${counts.stored} slide${counts.stored === 1 ? "" : "s"} with readable text`];
  if (counts.duplicates > 0) parts.push(`skipped ${counts.duplicates} repeat frame${counts.duplicates === 1 ? "" : "s"} of the same slide`);
  if (counts.unreadable > 0) parts.push(`${counts.unreadable} frame${counts.unreadable === 1 ? "" : "s"} had no readable text`);
  return parts.join(", ") + ".";
}
