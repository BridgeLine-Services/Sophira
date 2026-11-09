import { readFileSync } from "fs";
import path from "path";
import {
  FRAME_LIMITS,
  classifyFrame,
  dedupeFrame,
  frameConfidence,
  frameNote,
  frameRowFor,
  samplingSummary,
  textFingerprint,
  validateFrameUpload,
} from "../src/lib/media/frames";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

export async function runFrameOcrTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, name: string) => {
    if (cond) {
      passed++;
      console.log("  ✓ " + name);
    } else {
      failed++;
      console.log("  ✗ " + name);
    }
  };
  const section = (name: string) => console.log("\n" + name);

  section("frame OCR: upload validation");

  assert(validateFrameUpload({ mime: "image/jpeg", byteSize: 200_000, atSec: 30 }).ok,
    "frames: an ordinary sampled JPEG is accepted");
  assert(validateFrameUpload({ mime: "image/png", byteSize: 1000, atSec: 0 }).ok,
    "frames: the very first second is a valid position");
  assert(validateFrameUpload({ mime: "image/jpeg", byteSize: 10, atSec: Number.NaN }).code === "bad_time",
    "frames: a frame without a position is refused instead of stored at zero");
  assert(validateFrameUpload({ mime: "image/jpeg", byteSize: 10, atSec: -5 }).code === "bad_time",
    "frames: a negative position is refused");
  assert(validateFrameUpload({ mime: "image/jpeg", byteSize: 0, atSec: 10 }).code === "empty",
    "frames: an empty image is refused");
  const big = validateFrameUpload({ mime: "image/jpeg", byteSize: FRAME_LIMITS.maxBytes + 1, atSec: 10 });
  assert(!big.ok && big.code === "too_large" && big.memberNote.includes("MB"),
    "frames: an oversized frame is refused with the real limit in the message");
  assert(validateFrameUpload({ mime: "image/gif", byteSize: 100, atSec: 10 }).code === "not_image",
    "frames: an unsupported image type is refused");
  const full = validateFrameUpload({ mime: "image/jpeg", byteSize: 100, atSec: 10, existingCount: FRAME_LIMITS.maxFramesPerAsset });
  assert(!full.ok && full.code === "too_many" && full.memberNote.includes(String(FRAME_LIMITS.maxFramesPerAsset)),
    "frames: the per-recording limit is enforced with its real number");

  section("frame OCR: classification is conservative");

  assert(classifyFrame({ text: "", meanConfidence: null, ok: false }) === "unknown",
    "frames: an unreadable frame stays 'unknown', never 'slide'");
  assert(classifyFrame({ text: "hi", meanConfidence: 0.9, ok: true }) === "scene",
    "frames: a nearly empty frame is a 'scene', not a slide");
  const slide = classifyFrame({
    text: "The Cell Cycle\nInterphase: growth and DNA replication\nMitosis: nuclear division\nCytokinesis: cell splits",
    meanConfidence: 0.9,
    ok: true,
  });
  assert(slide === "slide", "frames: dense multi-line text is classified as a slide");
  const chart = classifyFrame({
    text: "Growth rate 12% 24% 38% 51% 66% 78% 91%",
    meanConfidence: 0.8,
    ok: true,
  });
  assert(chart === "chart", "frames: a percentage series is classified as a chart");
  const table = classifyFrame({
    text: "Phase    Duration    Checkpoint\nG1       10h         G1/S\nS        8h          -\nG2       4h          G2/M\nM        1h          spindle",
    meanConfidence: 0.85,
    ok: true,
  });
  assert(table === "table", "frames: aligned columns are classified as a table");
  assert(classifyFrame({ text: "a longer line of readable text here for sure", meanConfidence: 0.2, ok: true }) === "unknown",
    "frames: low-confidence text is 'unknown' rather than being trusted as a slide");

  section("frame OCR: confidence words");

  assert(frameConfidence({ ok: false, text: "", meanConfidence: null }) === "failed",
    "frames: a failed read is 'failed', never 'low'");
  assert(frameConfidence({ ok: true, text: "", meanConfidence: 0.9 }) === "failed",
    "frames: an empty read is 'failed' even when the engine said ok");
  assert(frameConfidence({ ok: true, text: "x".repeat(60), meanConfidence: 0.9 }) === "high",
    "frames: strong, substantial text is 'high'");
  assert(frameConfidence({ ok: true, text: "x".repeat(60), meanConfidence: 0.5 }) === "medium",
    "frames: middling OCR is 'medium'");
  assert(frameConfidence({ ok: true, text: "x".repeat(10), meanConfidence: 0.5 }) === "low",
    "frames: a few recognised characters is 'low'");

  section("frame OCR: nothing is invented");

  const failedNote = frameNote("unknown", "failed", 0);
  assert(failedNote.includes("could not read") && failedNote.includes("nothing was written down"),
    "frames: an unreadable frame says so plainly");
  const row = frameRowFor({
    assetId: "a",
    userId: "u",
    atSec: 74.48,
    storagePath: "x/y.jpg",
    text: "",
    kind: "unknown",
    confidence: "failed",
    memberNote: failedNote,
  });
  assert(row.recognised_text === "", "frames: an unreadable frame stores EMPTY text, never a guess");
  assert(row.at_sec === 74.5, "frames: the stored position is rounded, not truncated");
  assert(row.frame_kind === "unknown", "frames: an unreadable frame is not labelled a slide");
  assert(frameRowFor({ assetId: "a", userId: "u", atSec: -3, storagePath: "", text: "t", kind: "slide", confidence: "high", memberNote: "n" }).at_sec === 0,
    "frames: a negative position can never reach the database");
  const longText = frameRowFor({ assetId: "a", userId: "u", atSec: 1, storagePath: "", text: "x".repeat(20000), kind: "slide", confidence: "high", memberNote: "n" });
  assert(longText.recognised_text.length === 8000, "frames: recognised text is capped rather than stored unbounded");

  section("frame OCR: duplicate slides are caught, not multiplied");

  assert(textFingerprint("The  Cell CYCLE!\n\n") === "the cell cycle",
    "frames: the fingerprint ignores case, punctuation and whitespace");
  const prior = [{ atSec: 120, fingerprint: textFingerprint("The Cell Cycle") }];
  const dup = dedupeFrame({ fingerprint: textFingerprint("the cell cycle.") }, prior);
  assert(dup.duplicate && dup.duplicateOfAtSec === 120,
    "frames: a repeated slide is recognised as the same frame and located");
  assert(!dedupeFrame({ fingerprint: textFingerprint("Something else entirely") }, prior).duplicate,
    "frames: different slides are not merged");
  assert(!dedupeFrame({ fingerprint: "" }, prior).duplicate,
    "frames: an unreadable frame is never treated as a duplicate of anything");

  section("frame OCR: honest run summary");

  const summary = samplingSummary({ stored: 5, duplicates: 3, unreadable: 1 });
  assert(summary.includes("5 slides") && summary.includes("3 repeat frames") && summary.includes("1 frame"),
    "frames: the summary reports stored, repeated and unreadable counts separately");
  assert(samplingSummary({ stored: 0, duplicates: 0, unreadable: 0 }).includes("Nothing was invented"),
    "frames: an empty run says so instead of pretending slides were found");
  assert(samplingSummary({ stored: 1, duplicates: 0, unreadable: 0 }).includes("1 slide with"),
    "frames: the singular form is used for one slide");

  section("frame OCR: route pins");

  const src = read("src/app/api/media/[id]/frames/route.ts");
  assert(src.includes("requireUser("), "frames: the route runs the shared authorization guard");
  assert(src.includes(".eq(\"id\", id)") && src.includes("maybeSingle()"),
    "frames: the recording is read through the RLS client, so only its owner can add frames");
  assert(src.includes("ocrImage("), "frames: reading uses the member's own OCR service, not a cloud vendor");
  assert(src.includes("dedupeFrame("), "frames: identical slides are deduplicated before insert");
  assert(src.includes("validateFrameUpload("), "frames: every frame is validated before anything is stored");
  assert(src.includes("recognised_text"), "frames: only recognised text is written, under its own column");
  assert(!src.includes("console.log("), "frames: recognised text is never logged");
  assert(src.includes("export async function GET"), "frames: the member can list what was already read");

  return { passed, failed };
}
