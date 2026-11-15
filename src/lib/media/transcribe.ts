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
 *
 * 2026-11-15 (directive: provider-key optimisation, part 2). Three additions, all
 * additive - no existing field or behaviour changed:
 *  - A format gate. A recording whose container the engine cannot decode (WMA, AMR,
 *    MIDI) is refused BEFORE anything is uploaded, in one sentence, instead of being
 *    posted and failing with a vendor error. Unknown extensions are still tried, so a
 *    readable file is never blocked by an over-eager whitelist.
 *  - Engine-reported certainty. faster-whisper style servers return `avg_logprob` and
 *    `no_speech_prob` per segment; when they do, the confidence band uses them. When
 *    they do not, the band stays exactly what it was (coverage based) and the result
 *    says the engine reported nothing, rather than inventing a number.
 *  - The format that was actually read is reported, so provenance says what was heard.
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
  /** Container that was read, e.g. "mp3". Empty when it could not be determined. */
  format?: string;
  /** Certainty the ENGINE reported (avg_logprob / no_speech_prob), null when it reported none. */
  engineConfidence?: TranscriptConfidence | null;
  /** Segments the engine itself flagged as probably-not-speech or low certainty. */
  uncertainSegments?: number;
  notes: string;
}

export const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

/**
 * Containers a Whisper server decodes without a separate conversion step.
 * Kept deliberately small and honest: anything else is either refused with a reason or
 * attempted with a note - never silently relabelled as a format it is not.
 */
export const SUPPORTED_AUDIO_EXTENSIONS = [
  "wav", "mp3", "m4a", "mp4", "webm", "ogg", "oga", "opus", "flac", "aac", "mpga", "mpeg", "weba",
] as const;

/** Known-unreadable by a Whisper server without conversion. Named so the refusal is specific. */
export const UNSUPPORTED_AUDIO_EXTENSIONS = ["wma", "amr", "mid", "midi", "aiff", "aif", "caf", "ape"] as const;

export interface AudioFormatCheck {
  supported: boolean;
  /** Extension actually used for the decision, lower case, no dot; empty when unknown. */
  format: string;
  /** True when the extension is not on either list, so the engine is simply asked. */
  unknown: boolean;
  /** Plain sentence when refused; null when it is fine to try. */
  reason: string | null;
}

export function audioFormatSupport(filename: string, mime = ""): AudioFormatCheck {
  const name = (filename || "").toLowerCase();
  const extFromName = (name.match(/\.([a-z0-9]{1,5})$/) || [])[1] || "";
  const extFromMime = (mime || "").toLowerCase().startsWith("audio/") || (mime || "").toLowerCase().startsWith("video/")
    ? ((mime || "").toLowerCase().split("/")[1] || "").split(";")[0].replace("x-", "")
    : "";
  const format = extFromName || extFromMime;
  if (!format) {
    return { supported: true, format: "", unknown: true, reason: null };
  }
  if ((SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(format)) {
    return { supported: true, format, unknown: false, reason: null };
  }
  if ((UNSUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(format)) {
    return {
      supported: false,
      format,
      unknown: false,
      reason: `This recording is in a format Sophira's transcriber cannot read (${format.toUpperCase()}). Convert it to MP3, M4A or WAV and add it again. Your original file is kept.`,
    };
  }
  // Unknown container: try it. A refusal here would block a file that might work.
  return { supported: true, format, unknown: true, reason: null };
}

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
  /** Bands from the engine's own per-segment certainty, null when it reported none. */
  engineConfidence: TranscriptConfidence | null;
  uncertainSegments: number;
} {
  const p = (json ?? {}) as Record<string, unknown>;
  const rawSegments = Array.isArray(p.segments) ? (p.segments as Record<string, unknown>[]) : [];
  const segments: TranscriptSegment[] = [];
  const engineBands: TranscriptConfidence[] = [];
  let uncertainSegments = 0;
  for (const s of rawSegments) {
    const text = typeof s.text === "string" ? s.text.trim() : "";
    const start = num(s.start);
    const end = num(s.end);
    // A segment without both timings is dropped rather than given invented ones.
    if (!text || start === null || end === null) continue;
    const speaker = typeof s.speaker === "string" && s.speaker.trim() ? s.speaker.trim() : null;
    segments.push({ startSec: Math.max(0, start), endSec: Math.max(Math.max(0, start), end), text, speaker });

    // Engine certainty, ONLY when the server actually reported it.
    const logprob = num(s.avg_logprob);
    const noSpeech = num(s.no_speech_prob);
    if (logprob !== null || noSpeech !== null) {
      const byLogprob: TranscriptConfidence =
        logprob === null ? "medium" : logprob >= -0.35 ? "high" : logprob >= -0.6 ? "medium" : "low";
      const probablyNotSpeech = noSpeech !== null && noSpeech >= 0.6;
      const band: TranscriptConfidence = probablyNotSpeech ? "low" : byLogprob;
      engineBands.push(band);
      if (band !== "high") uncertainSegments++;
    }
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

  const RANK: Record<TranscriptConfidence, number> = { failed: 0, low: 1, medium: 2, high: 3 };
  const engineConfidence: TranscriptConfidence | null = engineBands.length
    ? engineBands.reduce<TranscriptConfidence>((worst, b) => (RANK[b] < RANK[worst] ? b : worst), "high")
    : null;

  return {
    segments,
    language: typeof p.language === "string" ? p.language : null,
    durationSec: duration,
    model: typeof p.model === "string" ? p.model : null,
    speakers,
    engineConfidence,
    uncertainSegments,
  };
}

/**
 * The size a Whisper-compatible server will actually accept in one request.
 * 25 MB is the common ceiling (`whisper.cpp`, `faster-whisper`, and the hosted
 * APIs all agree on it). Refusing above it BEFORE the upload keeps a two-hour
 * lecture from failing halfway with an opaque 413.
 */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

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
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    return empty(
      "This recording is larger than 25 MB, which is more than the transcriber accepts in one request. Split it into shorter parts and add them one at a time; the recording you added is untouched."
    );
  }
  const formatCheck = audioFormatSupport(filename, mime);
  if (!formatCheck.supported) {
    return empty(formatCheck.reason || "This recording is in a format Sophira's transcriber cannot read. Convert it and add it again.");
  }
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
  const byCoverage: TranscriptConfidence =
    coverage === null ? "medium" : coverage >= 0.5 ? "high" : coverage >= 0.2 ? "medium" : "low";

  // Conservative: the worse of what the audio covered and what the engine was sure of.
  // A confident engine on a thin transcript is still a thin transcript.
  const RANK: Record<TranscriptConfidence, number> = { failed: 0, low: 1, medium: 2, high: 3 };
  const confidence: TranscriptConfidence =
    normalized.engineConfidence && RANK[normalized.engineConfidence] < RANK[byCoverage]
      ? normalized.engineConfidence
      : byCoverage;

  const certaintyNote =
    normalized.engineConfidence === null
      ? "The engine did not report how sure it was, so Sophira does not claim more than the amount of speech it found."
      : normalized.uncertainSegments > 0
        ? `${normalized.uncertainSegments} part${normalized.uncertainSegments === 1 ? "" : "s"} of the transcript were marked uncertain by the engine - check those passages against the recording before quoting them.`
        : "The engine reported high certainty for this recording.";

  const notes = [
    normalized.speakers.length
      ? `Transcribed with timestamps. Speakers were identified by the engine (${normalized.speakers.length} found). Check names before relying on them.`
      : "Transcribed with timestamps. Speaker separation is not available from this engine, so Sophira does not claim to know who spoke when.",
    certaintyNote,
  ].join(" ");

  return {
    ok: true,
    engine: "whisper-selfhost",
    language: normalized.language,
    durationSec: normalized.durationSec,
    segments: normalized.segments,
    speakers: normalized.speakers,
    confidence,
    model: normalized.model,
    format: formatCheck.format,
    engineConfidence: normalized.engineConfidence,
    uncertainSegments: normalized.uncertainSegments,
    notes,
  };
}
