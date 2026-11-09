/**
 * Media pipeline rules (pure - no network, no database).
 *
 * These functions are the ONLY place that decides:
 *   - what may be uploaded (type, size, honest refusal wording),
 *   - where an uploaded recording lives (a path the CLIENT can never choose),
 *   - which transcript segments become rows (text is never invented, an
 *     untimed segment is dropped rather than given a made-up timestamp),
 *   - how much of the recording was actually covered, and how confident
 *     Sophira is allowed to sound about it,
 *   - which moments are worth sampling for slides.
 *
 * Every decision is testable without a Supabase instance or an ASR server.
 */
import type { TranscriptSegment, TranscriptionResult } from "./transcribe";

/** Hard limits. Chosen so a normal lecture fits and a mistake does not fill storage. */
export const MEDIA_LIMITS = {
  /** 500 MB: a 2-hour video lecture, not a feature film. */
  maxBytes: 500 * 1024 * 1024,
  /** Synchronous transcription budget: 20 minutes of audio. Longer recordings
   *  need the desktop app's local processing, and the member is told so. */
  maxSyncDurationSec: 20 * 60,
  /** Most segments persisted from one transcription. */
  maxSegments: 5000,
  /** Most frames sampled from one recording. */
  maxFrames: 40,
} as const;

const ALLOWED_PREFIXES = ["video/", "audio/"] as const;
/** Containers browsers report that we cannot read reliably. */
const REFUSED_MIME = new Set([
  "video/x-msvideo",
  "video/quicktime",
  "audio/x-m4a",
]);

export type UploadRefusal =
  | "empty"
  | "too_large"
  | "not_media"
  | "unreadable_container";

export interface UploadCheck {
  ok: boolean;
  code: UploadRefusal | null;
  memberNote: string;
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * Validates a recording BEFORE anything is created. The refusal wording is
 * the member-facing text, so it names the actual problem and the real limit.
 */
export function validateMediaUpload(input: {
  filename?: string;
  mime?: string;
  byteSize?: number;
}): UploadCheck {
  const mime = (input.mime ?? "").toLowerCase().trim();
  const size = typeof input.byteSize === "number" && Number.isFinite(input.byteSize) ? input.byteSize : 0;

  if (size <= 0) {
    return {
      ok: false,
      code: "empty",
      memberNote: "That file looks empty (0 bytes), so there is nothing to transcribe.",
    };
  }
  if (size > MEDIA_LIMITS.maxBytes) {
    return {
      ok: false,
      code: "too_large",
      memberNote: `That recording is ${mb(size)} MB. The limit is ${mb(MEDIA_LIMITS.maxBytes)} MB (about two hours of video). Try exporting a smaller version.`,
    };
  }
  const isMedia = ALLOWED_PREFIXES.some((p) => mime.startsWith(p));
  if (!mime || !isMedia) {
    return {
      ok: false,
      code: "not_media",
      memberNote: "Sophira can transcribe audio and video recordings only. That file is not an audio or video file.",
    };
  }
  if (REFUSED_MIME.has(mime)) {
    return {
      ok: false,
      code: "unreadable_container",
      memberNote: "That file uses a video format Sophira cannot read reliably. Re-export it as MP4 (H.264) or M4A/Mp3 audio.",
    };
  }
  return { ok: true, code: null, memberNote: "" };
}

/** Sanitized extension (never a path fragment). */
export function mediaExtension(filename: string, mime: string): string {
  const fromName = filename.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? "";
  if (fromName) return `.${fromName}`;
  const map: Record<string, string> = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
  };
  return map[mime.toLowerCase()] ?? ".bin";
}

/**
 * The ONLY path builder. The member id comes from the verified session and the
 * asset id from the database, so a client cannot aim an upload at someone
 * else's folder or at a classic "../" traversal.
 */
export function memberMediaPath(userId: string, assetId: string, filename: string, mime: string): string {
  const safeId = (v: string) => v.replace(/[^a-zA-Z0-9-]/g, "");
  return `${safeId(userId)}/media/${safeId(assetId)}/original${mediaExtension(filename, mime)}`;
}

export interface SegmentRow {
  start_sec: number;
  end_sec: number;
  text: string;
  speaker: string | null;
}

/**
 * Maps engine output to database rows. Rules:
 *  - text is trimmed and kept verbatim (never rewritten, never padded),
 *  - a segment with no text is dropped,
 *  - a segment with no usable timing is DROPPED, because a citation needs a
 *    real timestamp (the count of dropped ones is reported separately),
 *  - end is never before start.
 */
export function segmentsToRows(
  segments: TranscriptSegment[],
  opts: { maxSegments?: number } = {}
): { rows: SegmentRow[]; dropped: number } {
  const cap = Math.max(0, Math.min(opts.maxSegments ?? MEDIA_LIMITS.maxSegments, MEDIA_LIMITS.maxSegments));
  const rows: SegmentRow[] = [];
  let dropped = 0;
  for (const s of segments) {
    const text = String(s.text ?? "").trim();
    const start = typeof s.startSec === "number" && Number.isFinite(s.startSec) ? s.startSec : null;
    const end = typeof s.endSec === "number" && Number.isFinite(s.endSec) ? s.endSec : null;
    if (!text || start === null || start < 0) {
      dropped += 1;
      continue;
    }
    if (rows.length >= cap) {
      dropped += 1;
      continue;
    }
    const safeEnd = end === null || end < start ? start : end;
    rows.push({
      start_sec: Math.round(start * 100) / 100,
      end_sec: Math.round(safeEnd * 100) / 100,
      text,
      speaker: s.speaker && String(s.speaker).trim() ? String(s.speaker).trim().slice(0, 64) : null,
    });
  }
  return { rows, dropped };
}

/** Share of the recording that returned actual speech (0..1), or null when the duration is unknown. */
export function coverageOf(rows: Pick<SegmentRow, "start_sec" | "end_sec">[], durationSec: number | null): number | null {
  if (durationSec === null || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  let covered = 0;
  let cursor = 0;
  for (const r of [...rows].sort((a, b) => a.start_sec - b.start_sec)) {
    const start = Math.max(r.start_sec, cursor);
    const end = Math.min(r.end_sec, durationSec);
    if (end > start) covered += end - start;
    cursor = Math.max(cursor, r.end_sec);
  }
  const ratio = covered / durationSec;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 1000;
}

/**
 * Confidence words, matching the rest of Sophira. A short recording with dense
 * speech is not automatically "high" - the engine has to have produced text.
 */
export function confidenceFor(coverage: number | null, segmentCount: number): "high" | "medium" | "low" | "failed" {
  if (segmentCount === 0) return "failed";
  if (coverage === null) return segmentCount >= 5 ? "medium" : "low";
  if (coverage >= 0.6) return "high";
  if (coverage >= 0.25) return "medium";
  return "low";
}

/** Plain-English note for the member. Never claims more than happened. */
export function memberNoteFor(state: {
  status: "ready" | "partial" | "failed";
  durationSec: number | null;
  coverage: number | null;
  segmentCount: number;
  dropped: number;
  engine: string;
}): string {
  const mins = state.durationSec ? Math.round(state.durationSec / 60) : null;
  const length = mins === null ? "this recording" : `this ${mins}-minute recording`;
  if (state.status === "failed") {
    return "Sophira could not read any speech in this recording. The file is still saved and nothing was invented. You can try a clearer copy, or upload the lecture slides as a PDF.";
  }
  const pct = state.coverage === null ? null : Math.round(state.coverage * 100);
  if (state.status === "partial") {
    return `Transcribed ${state.segmentCount} passages from ${length}, covering about ${pct ?? "part of"}% of the audio. Some of it could not be read (background noise or silence), so treat gaps as gaps.`;
  }
  return `Transcribed ${state.segmentCount} timed passages from ${length}${pct === null ? "" : `, covering about ${pct}% of the audio`}. Every quote is timestamped so you can check it against the recording.`;
}

/**
 * Moments worth sampling for slides/diagrams. Evenly spaced, capped, and the
 * first few seconds are skipped so a title card is not the only frame.
 */
export function planFrames(durationSec: number | null, maxFrames = 12): number[] {
  if (durationSec === null || !Number.isFinite(durationSec) || durationSec <= 0) return [];
  const cap = Math.max(1, Math.min(maxFrames, MEDIA_LIMITS.maxFrames));
  const start = Math.min(5, durationSec * 0.05);
  const usable = durationSec - start;
  const count = Math.max(1, Math.min(cap, Math.floor(durationSec / 30)));
  const step = usable / count;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(Math.round((start + step * i) * 10) / 10);
  return out;
}

/** Converts a finished transcription into the rows the database expects. */
export function transcriptRowFor(result: TranscriptionResult, ids: { assetId: string; userId: string }) {
  const { rows, dropped } = segmentsToRows(result.segments);
  const coverage = coverageOf(rows, result.durationSec);
  const confidence = confidenceFor(coverage, rows.length);
  const status: "ready" | "partial" | "failed" =
    rows.length === 0 ? "failed" : confidence === "low" || dropped > 0 ? "partial" : "ready";
  return {
    status,
    dropped,
    coverage,
    confidence,
    rows: rows.map((r) => ({ ...r, asset_id: ids.assetId, user_id: ids.userId })),
    memberNote: memberNoteFor({
      status,
      durationSec: result.durationSec,
      coverage,
      segmentCount: rows.length,
      dropped,
      engine: result.engine,
    }),
  };
}

/** True when the recording is short enough to transcribe inside one request. */
export function withinSyncBudget(durationSec: number | null): boolean {
  if (durationSec === null) return true;
  return durationSec <= MEDIA_LIMITS.maxSyncDurationSec;
}
