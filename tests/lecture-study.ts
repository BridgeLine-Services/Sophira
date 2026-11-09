import { readFileSync } from "fs";
import path from "path";
import {
  buildStudyPrompt,
  coverageNotice,
  formatTimestamp,
  parseTimestamp,
  renderTranscriptForModel,
  sanitizeCitations,
  splitStudySections,
  STUDY_INSTRUCTIONS,
  type StudySegment,
} from "../src/lib/media/study";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

const SEGMENTS: StudySegment[] = [
  { start_sec: 0, end_sec: 12, text: "Today we cover the cell cycle.", speaker: null },
  { start_sec: 754, end_sec: 790, text: "Mitosis has four phases.", speaker: "SPEAKER_00" },
  { start_sec: 1200, end_sec: 1240, text: "Checkpoints prevent damaged cells dividing.", speaker: null },
];

export async function runLectureStudyTests(): Promise<{ passed: number; failed: number }> {
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

  section("lecture study: timestamps");

  assert(formatTimestamp(0) === "0:00", "study: the first second renders as 0:00");
  assert(formatTimestamp(754) === "12:34", "study: 754 seconds renders as 12:34");
  assert(formatTimestamp(3723) === "1:02:03", "study: an hour-plus recording keeps the hours field");
  assert(parseTimestamp("12:34") === 754, "study: a cited timestamp parses back to the same second");
  assert(parseTimestamp("1:02:03") === 3723, "study: an hour-scale citation parses");
  assert(parseTimestamp("34") === 34, "study: a bare number is read as seconds");
  assert(parseTimestamp("12:xx") === null, "study: an unreadable timestamp parses to null, never to a guess");

  section("lecture study: transcript context");

  const rendered = renderTranscriptForModel(SEGMENTS);
  assert(rendered.usedSegments === 3, "study: every segment is offered to the model");
  assert(rendered.text.includes("[12:34]"), "study: each line carries a real timestamp");
  assert(rendered.text.includes("SPEAKER_00: Mitosis"), "study: a speaker label is shown only when the engine named one");
  assert(!rendered.truncated, "study: a short lecture is not reported as truncated");
  const capped = renderTranscriptForModel(SEGMENTS, { maxSegments: 2 });
  assert(capped.truncated && capped.usedSegments === 2,
    "study: a cap is reported as truncated instead of silently dropping material");
  const charCapped = renderTranscriptForModel(SEGMENTS, { maxChars: 40 });
  assert(charCapped.truncated && charCapped.text.length <= 60,
    "study: the character budget is respected and disclosed");

  section("lecture study: prompts state the limits");

  const prompt = buildStudyPrompt({
    task: "notes",
    transcript: rendered.text,
    coverage: 0.35,
    durationSec: 1800,
    truncated: false,
  });
  assert(prompt.includes("35% of the audio transcribed"), "study: the prompt states how much audio was actually transcribed");
  assert(prompt.includes("30 minutes"), "study: the prompt states the real recording length");
  assert(prompt.includes("not covered in the recording"), "study: the model is told to declare gaps rather than fill them");
  assert(prompt.includes("Never invent a timestamp"), "study: the prompt forbids invented timestamps");
  assert(prompt.includes(STUDY_INSTRUCTIONS.notes), "study: the requested task has its own instruction");
  const thinPrompt = buildStudyPrompt({ task: "summary", transcript: "x", coverage: 0.2, durationSec: 60, truncated: true });
  assert(thinPrompt.includes("could not be transcribed"), "study: thin coverage is called out in the prompt itself");
  assert(thinPrompt.includes("opening portion"), "study: a truncated transcript is disclosed to the model");

  section("lecture study: citations are verified, not trusted");

  const good = sanitizeCitations("Mitosis has four phases [12:34].", SEGMENTS);
  assert(good.removed === 0 && good.text.includes("[12:34]"), "study: a real timestamp survives unchanged");
  const rounded = sanitizeCitations("Checkpoints exist [20:02].", SEGMENTS);
  assert(rounded.removed === 0 && rounded.text.includes("[20:00]"),
    "study: a citation within 3 seconds of a real segment is snapped to the real time");
  const invented = sanitizeCitations("Something was said [3:07].", SEGMENTS);
  assert(invented.removed === 1 && invented.text.includes("[timestamp unavailable]"),
    "study: an invented timestamp is marked unavailable instead of being shown as a source");
  const multi = sanitizeCitations("[12:34] and [44:44] and [not a time]", SEGMENTS);
  assert(multi.removed === 1, "study: only the bogus citation is counted as removed");
  assert(!multi.text.includes("[44:44]"), "study: a fabricated citation never survives into the answer");

  section("lecture study: honest notices");

  const notice = coverageNotice(0.3, 2);
  assert(notice.includes("30%") && notice.includes("may leave out"), "study: thin coverage produces a plain warning");
  assert(notice.includes("2 timestamps") && notice.includes("marked as unavailable"),
    "study: removed citations are disclosed with their count");
  assert(coverageNotice(0.95, 0) === "", "study: a clean full transcript adds no warning");
  assert(coverageNotice(null, 1).includes("1 timestamp"), "study: the singular form is used for one removed citation");

  section("lecture study: sections");

  const sections = splitStudySections("## Cell cycle\n- interphase [0:00]\n## Mitosis\n- four phases [12:34]");
  assert(sections.length === 2, "study: headings split the answer into sections");
  assert(sections[1].title === "Mitosis" && sections[1].body.includes("12:34"),
    "study: each section keeps its own body and citations");
  assert(splitStudySections("plain answer with no headings")[0].body.includes("plain answer"),
    "study: an answer without headings is returned whole rather than lost");

  section("lecture study: route honesty pins");

  const src = read("src/app/api/media/[id]/study/route.ts");
  assert(src.includes("requireUser("), "study: the route runs the shared authorization guard");
  assert(src.includes('.eq("id", id)') && src.includes("maybeSingle()"),
    "study: the recording is read through the RLS client so only its owner can use it");
  assert(src.includes("sanitizeCitations("), "study: every generated citation is verified against real segments");
  assert(src.includes("coverageNotice("), "study: thin coverage is disclosed to the member");
  assert(src.includes("aiConfigured()"), "study: an unavailable model is detected before calling it");
  assert(src.includes("nothing to summarize") || src.includes("Nothing was invented"),
    "study: an empty transcript is refused instead of summarized from nothing");
  assert(!src.includes("console.log("), "study: transcript content is never logged");

  return { passed, failed };
}
