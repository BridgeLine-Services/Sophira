/**
 * SELF-HOSTED WHISPER TRANSCRIPTION (Phase 3b, 2026-11-09).
 *
 * Talks to an OPEN-SOURCE Whisper server the owner runs themselves
 * (whisper.cpp `server`, faster-whisper-server, or any OpenAI-compatible
 * `/v1/audio/transcriptions` implementation). No vendor, no per-minute fee.
 *
 * What this module guarantees:
 *  - Timestamps are preserved exactly as the engine reported them (sorted,
 *    clamped, never invented). A segment with no timing is NOT given one.
 *  - Speaker labels are passed through ONLY when the engine actually supplied
 *    them; otherwise `speaker` stays null and Sophira says diarization is off.
 *  - An empty transcript is a failure, not a success: Sophira never pretends
 *    audio was understood when nothing was returned.
 *  - The engine name is recorded so provenance is honest.
 */
import { postSelfHosted, readSelfHostedConfig } from "../media/selfhost";

export type TranscriptConfidence = "high" | "medium" | "low" | "failed";

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
  speaker: string | null;
}

export interface TranscriptionResult {
  ok: boolean;
  engine: "whisper-selfhost" | "none";
  language: string | null;
  durationSec: number | null;
  segments: TranscriptSegment[];
  speakers: string[];
  confidence: TranscriptConfidence;
  model: string | null;
  notes: string;
}

export const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Normalizes an OpenAI-compatible verbose_json payload into ordered segments.
 * Pure so it can be tested without a server.
 */
export function normalizeTranscription(json: unknown): {
  segments: TranscriptSegment[];
  language: string | null;
  durationSec: number | null;
  model: string | null;
  speakers: string[];
} {
  const p = (json ?? {}) as Record<string, unknown>;
  const rawSegments = Array.isArray(p.segments) ? (p.segments as Record<string, unknown>[]) : [];
  const segments: TranscriptSegment[] = [];
  for (const s of rawSegments) {
    const text = typeof s.text === "string" ? s.text.trim() : "";
    const start = num(s.start);
    const end = num(s.end);
    // A segment without both timings is dropped rather than given invented ones.
    if (!text || start === null || end === null) continue;
    const speaker = typeof s.speaker === "string" && s.speaker.trim() ? s.speaker.trim() : null;
    segments.push({ startSec: Math.max(0, start), endSec: Math.max(Math.max(0, start), end), text, speaker });
  }
  segments.sort((a, b) => a.startSec - b.startSec);

  // Whole-file text with no segments: one honest segment spanning the file.
  const whole = typeof p.text === "string" ? p.text.trim() : "";
  const duration = num(p.duration);
  if (segments.length === 0 && whole) {
    segments.push({ startSec: 0, endSec: duration && duration > 0 ? duration : 0, text: whole, speaker: null });
  }

  const speakers = Array.from(
    new Set(segments.map((s) => s.speaker).filter((s): s is string => Boolean(s)))
  ).sort();

  return {
    segments,
    language: typeof p.language === "string" ? p.language : null,
    durationSec: duration,
    model: typeof p.model === "string" ? p.model : null,
    speakers,
  };
}

export async function transcribeMedia(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  opts: { timeoutMs?: number; env?: Record<string, string | undefined>; model?: string; diarize?: boolean } = {}
): Promise<TranscriptionResult> {
  const empty = (notes: string, engine: TranscriptionResult["engine"] = "none"): TranscriptionResult => ({
    ok: false,
    engine,
    language: null,
    durationSec: null,
    segments: [],
    speakers: [],
    confidence: "failed",
    model: null,
    notes,
  });

  const cfg = readSelfHostedConfig("asr", opts.env ?? process.env);
  if (!cfg.configured) {
    return empty("No self-hosted transcription service is configured, so Sophira does not claim to transcribe audio or video.");
  }
  if (bytes.byteLength === 0) return empty("The file was empty, so there was nothing to transcribe. Your original file was kept.");
  if (bytes.byteLength > MAX_MEDIA_BYTES) {
    return empty("This recording is larger than the 200 MB limit, so it was not processed. Your original file was kept.");
  }

  const form = new FormData();
  form.append("file", new Blob([Buffer.from(bytes)], { type: mime || "application/octet-stream" }), filename || "media");
  form.append("model", opts.model || "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  if (opts.diarize) form.append("diarize", "true");

  const res = await postSelfHosted("asr", "/v1/audio/transcriptions", form, {
    timeoutMs: opts.timeoutMs ?? 10 * 60 * 1000,
    env: opts.env,
  });
  if (!res.ok) {
    const notes =
      res.reason === "timeout"
        ? "Transcription took too long and was stopped. The original recording was kept; try a shorter section."
        : res.reason === "not-configured"
          ? "No self-hosted transcription service is configured."
          : "The self-hosted transcription service could not process this recording right now. Your original file was kept.";
    return empty(notes);
  }

  const normalized = normalizeTranscription(res.json);
  if (normalized.segments.length === 0) {
    return empty(
      "No speech was found in this recording, so there is nothing to quote or summarize. The original file was kept.",
      "whisper-selfhost"
    );
  }

  const speechSeconds = normalized.segments.reduce((sum, s) => sum + Math.max(0, s.endSec - s.startSec), 0);
  const coverage = normalized.durationSec && normalized.durationSec > 0 ? speechSeconds / normalized.durationSec : null;
  const confidence: TranscriptConfidence =
    coverage === null ? "medium" : coverage >= 0.5 ? "high" : coverage >= 0.2 ? "medium" : "low";

  const notes = normalized.speakers.length
    ? `Transcribed with timestamps. Speakers were identified by the engine (${normalized.speakers.length} found). Check names before relying on them.`
    : "Transcribed with timestamps. Speaker separation is not available from this engine, so Sophira does not claim to know who spoke when.";

  return {
    ok: true,
    engine: "whisper-selfhost",
    language: normalized.language,
    durationSec: normalized.durationSec,
    segments: normalized.segments,
    speakers: normalized.speakers,
    confidence,
    model: normalized.model,
    notes,
  };
}
