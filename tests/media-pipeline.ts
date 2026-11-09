import { readFileSync } from "fs";
import path from "path";
import {
  MEDIA_LIMITS,
  memberMediaPath,
  mediaExtension,
  planFrames,
  segmentsToRows,
  coverageOf,
  confidenceFor,
  memberNoteFor,
  transcriptRowFor,
  validateMediaUpload,
  withinSyncBudget,
} from "../src/lib/media/pipeline";
import type { TranscriptionResult } from "../src/lib/media/transcribe";


const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

function result(over: Partial<TranscriptionResult> = {}): TranscriptionResult {
  return {
    ok: true,
    engine: "whisper-selfhost",
    language: "en",
    durationSec: 600,
    segments: [
      { startSec: 0, endSec: 12, text: " Welcome to lecture four. ", speaker: null },
      { startSec: 12, endSec: 30, text: "Today we cover the cell cycle.", speaker: "SPEAKER_00" },
    ],
    speakers: ["SPEAKER_00"],
    confidence: "high",
    model: "whisper-large-v3",
    notes: "",
    ...over,
  };
}

export async function runMediaPipelineTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, name: string) => {
    if (cond) {
      passed++;
      console.log("  \u2713 " + name);
    } else {
      failed++;
      console.log("  \u2717 " + name);
    }
  };
  const section = (name: string) => console.log("\n" + name);

  assert(validateMediaUpload({ filename: "a.mp4", mime: "video/mp4", byteSize: 5_000_000 }).ok,
    "media: an ordinary MP4 is accepted");
  assert(!validateMediaUpload({ filename: "a.mp4", mime: "video/mp4", byteSize: 0 }).ok,
    "media: a zero-byte file is refused rather than creating an empty asset");
  const tooBig = validateMediaUpload({ filename: "a.mp4", mime: "video/mp4", byteSize: MEDIA_LIMITS.maxBytes + 1 });
  assert(!tooBig.ok && tooBig.code === "too_large", "media: a file over the limit is refused");
  assert(tooBig.memberNote.includes("MB") && tooBig.memberNote.includes("limit"),
    "media: the refusal names the real limit instead of saying 'error'");
  const pdf = validateMediaUpload({ filename: "syllabus.pdf", mime: "application/pdf", byteSize: 100 });
  assert(!pdf.ok && pdf.code === "not_media", "media: a PDF is refused here (it belongs to the document path)");
  assert(validateMediaUpload({ filename: "x", mime: "", byteSize: 10 }).code === "not_media",
    "media: a missing MIME type is refused instead of guessed");
  assert(validateMediaUpload({ filename: "a.mov", mime: "video/quicktime", byteSize: 10 }).code === "unreadable_container",
    "media: a container that cannot be read reliably is refused with a re-export suggestion");

  section("media pipeline: storage path is server-derived");

  const p = memberMediaPath("11111111-2222-3333-4444-555555555555", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "../../etc/passwd", "video/mp4");
  assert(p.startsWith("11111111-2222-3333-4444-555555555555/media/"),
    "media: the object path starts with the verified member id");
  assert(!p.includes(".."), "media: path traversal characters never survive path building");
  assert(p.includes("/original"), "media: the object is stored as 'original' plus a sanitized extension");
  assert(mediaExtension("lecture.MP4", "") === ".mp4", "media: the extension comes from the filename, lowercased");
  assert(mediaExtension("noext", "audio/mpeg") === ".mp3", "media: a mime map fills in a missing extension");
  assert(mediaExtension("noext", "application/zip") === ".bin", "media: an unknown type gets a neutral extension, never a guess");

  section("media pipeline: segments are never invented");

  const mixed = segmentsToRows([
    { startSec: 0, endSec: 5, text: "  real speech  ", speaker: null },
    { startSec: 5, endSec: 6, text: "   ", speaker: null },
    { startSec: Number.NaN, endSec: 9, text: "untimed", speaker: null },
    { startSec: 9, endSec: 4, text: "backwards", speaker: null },
  ]);
  assert(mixed.rows.length === 2, "media: empty and untimed segments are dropped, real and backwards-timed ones kept");
  assert(mixed.dropped === 2, "media: the dropped count is reported, not hidden");
  assert(mixed.rows[0].text === "real speech", "media: segment text is trimmed and otherwise left verbatim");
  assert(mixed.rows[1].end_sec === 9 && mixed.rows[1].start_sec === 9,
    "media: an end before its start collapses to the start instead of storing a negative span");
  assert(mixed.rows.every((r) => r.speaker === null), "media: a speaker is only stored when the engine named one");
  const capped = segmentsToRows(
    Array.from({ length: 50 }, (_, i) => ({ startSec: i, endSec: i + 1, text: `s${i}`, speaker: null })),
    { maxSegments: 10 }
  );
  assert(capped.rows.length === 10 && capped.dropped === 40, "media: the segment cap trims and counts what it trimmed");

  section("media pipeline: coverage and confidence");

  assert(coverageOf([{ start_sec: 0, end_sec: 300 }], 600) === 0.5,
    "media: coverage is the share of the recording that returned speech");
  assert(coverageOf([], 600) === 0, "media: no segments means zero coverage, not an assumed full transcript");
  assert(coverageOf([{ start_sec: 0, end_sec: 5 }], null) === null,
    "media: an unknown duration yields null coverage rather than a fabricated number");
  assert(coverageOf([{ start_sec: 0, end_sec: 400 }, { start_sec: 100, end_sec: 500 }], 400) === 1,
    "media: overlapping segments are not double-counted past the recording length");

  assert(confidenceFor(null, 0) === "failed", "media: no text at all is 'failed', never 'low'");
  assert(confidenceFor(0.8, 20) === "high", "media: dense coverage is 'high'");
  assert(confidenceFor(0.3, 20) === "medium", "media: partial coverage is 'medium'");
  assert(confidenceFor(0.05, 3) === "low", "media: thin coverage is 'low'");
  assert(confidenceFor(null, 6) === "medium", "media: unknown duration with real text is not claimed as high");

  section("media pipeline: status and member-facing wording");

  const thin = transcriptRowFor(
    result({ durationSec: 600, segments: [{ startSec: 0, endSec: 30, text: "only a little speech", speaker: null }] }),
    { assetId: "a", userId: "u" }
  );
  assert(thin.status === "partial", "media: a thin transcript is stored as 'partial', never 'ready'");
  assert(thin.memberNote.includes("gaps"), "media: the member is told that gaps are gaps");
  const empty = transcriptRowFor(result({ segments: [] }), { assetId: "a", userId: "u" });
  assert(empty.status === "failed" && empty.rows.length === 0,
    "media: an empty transcription stores no segments and reports failure");
  assert(empty.memberNote.includes("still saved"), "media: a failure says the original is still kept");
  const full = transcriptRowFor(result({ durationSec: 30 }), { assetId: "a", userId: "u" });
  assert(full.status === "ready", "media: a complete, dense transcription is 'ready'");
  assert(full.rows.every((r) => r.asset_id === "a" && r.user_id === "u"),
    "media: every row carries the owning asset and member");
  assert(memberNoteFor({ status: "ready", durationSec: 600, coverage: 0.9, segmentCount: 12, dropped: 0, engine: "whisper-selfhost" }).includes("timestamped"),
    "media: the success note explains that quotes are checkable by timestamp");

  section("media pipeline: duration budget");

  assert(withinSyncBudget(600), "media: a 10-minute recording fits the synchronous budget");
  assert(!withinSyncBudget(MEDIA_LIMITS.maxSyncDurationSec + 1), "media: a longer recording is refused honestly");
  assert(withinSyncBudget(null), "media: an unknown duration is allowed to try");

  section("media pipeline: frame sampling plan");

  const frames = planFrames(1800, 12);
  assert(frames.length > 0 && frames.length <= 12, "media: frame sampling is capped");
  assert(frames[0] >= 5, "media: the first sampled moment skips a title card");
  assert(frames.every((f, i) => i === 0 || f > frames[i - 1]), "media: sampled moments are strictly increasing");
  assert(frames.every((f) => f < 1800), "media: no frame is planned past the end of the recording");
  assert(planFrames(null).length === 0, "media: no duration means no frames, not guessed frames");
  assert(planFrames(20).length === 1, "media: a very short clip yields one frame");

  section("media routes: security and honesty pins");

  const uploadSrc = read("src/app/api/media/upload-url/route.ts");
  assert(uploadSrc.includes("requireUser("), "media: the upload route runs the shared authorization guard");
  assert(uploadSrc.includes("memberMediaPath("), "media: the upload path is built by the pipeline helper, not the client");
  assert(!/body\.path|body\.storage_path/.test(uploadSrc),
    "media: the route never accepts a client-supplied object path");
  assert(uploadSrc.includes("validateMediaUpload("), "media: uploads are validated before any row or URL is created");
  assert(uploadSrc.includes('createSignedUploadUrl('), "media: the browser uploads with a short-lived signed URL");
  assert(uploadSrc.includes('.delete().eq("id", asset.id)'),
    "media: a failed signed URL rolls the placeholder row back");
  assert(!uploadSrc.includes("SERVICE_ROLE_KEY") && !uploadSrc.includes("process.env"),
    "media: the upload route never touches secrets directly");

  const trSrc = read("src/app/api/media/[id]/transcribe/route.ts");
  assert(trSrc.includes("requireUser("), "media: the transcribe route runs the shared authorization guard");
  assert(trSrc.includes('.eq("id", id)') && trSrc.includes("maybeSingle()"),
    "media: the asset is read through the RLS client, so only the owner can load it");
  assert(trSrc.includes("asr_not_configured"),
    "media: an unconfigured Whisper server is reported honestly instead of failing silently");
  assert(trSrc.includes("transcriptRowFor("), "media: stored rows come from the tested pipeline mapper");
  assert(trSrc.includes('status: "transcribing"'), "media: the member sees a real in-progress state");
  assert(trSrc.includes('error_code: mapped.dropped > 0 ? "segments_dropped" : null'),
    "media: dropped segments are recorded as a machine-readable code");
  assert(trSrc.includes("maxDuration = 300"), "media: the route declares the long-running duration it needs");
  assert(trSrc.includes("withinSyncBudget("), "media: the synchronous budget is enforced before storing anything");
  assert(!trSrc.includes("console.log("), "media: transcription content is never logged");

  return { passed, failed };
}
