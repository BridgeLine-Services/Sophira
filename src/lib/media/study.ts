/**
 * Lecture study layer (pure - no network, no database).
 *
 * Turns a stored, timestamped transcript into study material WITHOUT letting
 * the model invent anything:
 *  - the context handed to the model is only text that exists in the
 *    transcript, each line prefixed with its real timestamp,
 *  - the coverage of the recording is stated in the prompt so a summary can
 *    never claim to cover material that was never transcribed,
 *  - citations are checked AFTER generation: any timestamp the model produced
 *    that is not a real segment start is stripped, and the count is reported,
 *  - when coverage is thin the answer is prefixed with a plain-English warning.
 */

export interface StudySegment {
  start_sec: number;
  end_sec: number;
  text: string;
  speaker?: string | null;
}

/** "12:34" for under an hour, "1:02:03" above it. Never "0:05" for the first minutes? No - always m:ss. */
export function formatTimestamp(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Parses "1:02:03" / "12:34" / "34" into seconds; null when unreadable. */
export function parseTimestamp(text: string): number | null {
  const parts = text.trim().split(":").map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/** The transcript rendered for the model: one timestamped line per segment. */
export function renderTranscriptForModel(
  segments: StudySegment[],
  opts: { maxChars?: number; maxSegments?: number } = {}
): { text: string; usedSegments: number; truncated: boolean } {
  const maxChars = opts.maxChars ?? 24000;
  const maxSegments = opts.maxSegments ?? 400;
  const lines: string[] = [];
  let chars = 0;
  let truncated = false;
  const ordered = [...segments].sort((a, b) => a.start_sec - b.start_sec);
  for (const s of ordered) {
    if (lines.length >= maxSegments) {
      truncated = true;
      break;
    }
    const speaker = s.speaker ? `${s.speaker}: ` : "";
    const line = `[${formatTimestamp(s.start_sec)}] ${speaker}${s.text}`;
    if (chars + line.length + 1 > maxChars) {
      truncated = true;
      break;
    }
    lines.push(line);
    chars += line.length + 1;
  }
  return { text: lines.join("\n"), usedSegments: lines.length, truncated };
}

export type StudyTask = "summary" | "notes" | "questions";

export const STUDY_INSTRUCTIONS: Record<StudyTask, string> = {
  summary:
    "Summarize the lecture in 4-8 sentences, in the order the topics were taught. Put a real timestamp in square brackets after each claim, taken from the transcript lines.",
  notes:
    "Write study notes as short headed sections. Under each heading, 2-4 bullets with a real timestamp in square brackets for each bullet. Use only what the transcript says.",
  questions:
    "Write 6-10 exam-style questions a student should be able to answer after this lecture, plus a one-line answer for each with a real timestamp in square brackets.",
};

export function buildStudyPrompt(input: {
  task: StudyTask;
  transcript: string;
  coverage: number | null;
  durationSec: number | null;
  truncated: boolean;
  courseName?: string | null;
}): string {
  const pct = input.coverage === null ? null : Math.round(input.coverage * 100);
  const mins = input.durationSec ? Math.round(input.durationSec / 60) : null;
  const lines = [
    "You are helping a student study a recorded lecture. The transcript below is the ONLY source you may use.",
    "",
    `Recording: ${mins === null ? "length unknown" : `${mins} minutes`}${pct === null ? "" : `, ${pct}% of the audio transcribed`}.`,
    input.truncated
      ? "The transcript was too long to send in full, so only its opening portion is included. Say so if a topic seems to start mid-way."
      : "The full transcript is included.",
    pct !== null && pct < 60
      ? "Parts of the audio could not be transcribed. Never imply the lecture covered something that is not in the transcript."
      : "",
    input.courseName ? `Course: ${input.courseName}.` : "",
    "",
    "Rules:",
    "1. Use only the transcript. If something is not there, write 'not covered in the recording'.",
    "2. Every claim needs a real timestamp in [m:ss] form taken from a transcript line. Never invent a timestamp.",
    "3. Do not add outside facts, definitions or examples that are not in the transcript.",
    "",
    STUDY_INSTRUCTIONS[input.task],
    "",
    "TRANSCRIPT:",
    input.transcript,
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/**
 * Removes citations that do not correspond to a real segment start, so a
 * plausible-looking timestamp can never be presented as a source.
 */
export function sanitizeCitations(
  answer: string,
  segments: StudySegment[]
): { text: string; removed: number } {
  const realStarts = new Set(segments.map((s) => Math.floor(s.start_sec)));
  let removed = 0;
  const text = answer.replace(/\[(\d{1,2}(?::\d{1,2}){0,2})\]/g, (match, stamp: string) => {
    const sec = parseTimestamp(stamp);
    if (sec === null) {
      removed += 1;
      return "[timestamp unavailable]";
    }
    // Accept a citation within 3 seconds of a real segment start (models round).
    for (const start of realStarts) {
      if (Math.abs(start - sec) <= 3) return `[${formatTimestamp(start)}]`;
    }
    removed += 1;
    return "[timestamp unavailable]";
  });
  return { text, removed };
}

/** Honest prefix when the transcript itself is thin. */
export function coverageNotice(coverage: number | null, removedCitations: number): string {
  const parts: string[] = [];
  if (coverage !== null && coverage < 0.6) {
    parts.push(
      `Only about ${Math.round(coverage * 100)}% of this recording could be transcribed, so these notes may leave out parts of the lecture.`
    );
  }
  if (removedCitations > 0) {
    parts.push(
      `${removedCitations} timestamp${removedCitations === 1 ? "" : "s"} in the draft did not match the transcript and ${removedCitations === 1 ? "was" : "were"} marked as unavailable rather than shown as a source.`
    );
  }
  return parts.join(" ");
}

/** Splits "notes"/"questions" output into sections for display. */
export function splitStudySections(answer: string): { title: string; body: string }[] {
  const lines = answer.split("\n");
  const out: { title: string; body: string }[] = [];
  let current: { title: string; body: string } | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^#{1,4}\s+(.*)$/) ?? line.match(/^\*\*(.+?)\*\*$/) ?? line.match(/^([A-Z][^.!?]{2,60}):$/);
    if (heading) {
      if (current && current.body.trim()) out.push(current);
      current = { title: heading[1].trim(), body: "" };
      continue;
    }
    if (!current) current = { title: "", body: "" };
    current.body += (current.body ? "\n" : "") + line;
  }
  if (current && (current.title || current.body.trim())) out.push(current);
  return out.length > 0 ? out : [{ title: "", body: answer }];
}
