// Gradual insertion (Stage 4, 2026-11-02).
//
// PURPOSE: let a student WATCH a long insertion happen and stay in control of it.
//
// This is NOT a simulation of human authorship. There are no deliberate typos, no
// invented keystrokes, no manufactured revision trail, and no artificial delay
// designed to look human. Each chunk is a real Google Docs insertText call, the
// document really changes at that moment, and the resulting revision is Google's
// own. The only thing "gradual" about it is that a large insertion is split into
// smaller confirmed writes so the student can pause, stop or cancel between them.
//
// Everything in this file is pure: no network, no database, no timers. That is so
// the pause/resume/stop rules are testable rather than assumed.

export type GradualStatus =
  | "pending" // nothing written yet
  | "inserting" // writing, may continue
  | "paused" // stopped between chunks by the student
  | "stopped" // ended early, content written so far stays
  | "cancelled" // ended early before any write
  | "completed" // every chunk confirmed by Google
  | "conflicted" // the document changed underneath us; we stopped
  | "failed"; // a write failed for another reason

export type GradualAction =
  | "start"
  | "progress"
  | "pause"
  | "resume"
  | "stop"
  | "cancel"
  | "complete"
  | "conflict"
  | "fail";

export interface GradualState {
  status: GradualStatus;
  /** Characters CONFIRMED written by the provider. Never estimated. */
  insertedChars: number;
  totalChars: number;
  chunksDone: number;
  chunkCount: number;
  /** Plain-language description; safe to show a non-technical student. */
  message: string;
}

/** Terminal states cannot be revived by a late or duplicated action. */
export function isTerminal(status: GradualStatus): boolean {
  return status === "completed" || status === "stopped" || status === "cancelled" ||
    status === "conflicted" || status === "failed";
}

export function insertionProgressLabel(state: GradualState): string {
  const pct = state.totalChars > 0 ? Math.floor((state.insertedChars / state.totalChars) * 100) : 0;
  switch (state.status) {
    case "pending": return "Ready to insert. Nothing has been written yet.";
    case "inserting": return `Inserting… ${pct}% done (${state.chunksDone} of ${state.chunkCount} parts).`;
    case "paused": return `Paused at ${pct}%. What was written so far is already saved in the document.`;
    case "stopped": return `Stopped at ${pct}%. The part already inserted stays in the document.`;
    case "cancelled": return "Cancelled. Nothing was written.";
    case "completed": return "Finished. Google confirmed every part of the insertion.";
    case "conflicted": return "Stopped because the document changed while inserting. Nothing further was written.";
    case "failed": return `Stopped after an error at ${pct}%. What was written so far stays in the document.`;
  }
}

export function canResume(status: GradualStatus): boolean {
  return status === "paused";
}

/** What the student is told when a partial insertion leaves text behind. */
export function recoveryNote(remainingChars: number): string {
  return remainingChars > 0
    ? `The rest of your text (${remainingChars.toLocaleString()} characters) is kept as a recovery copy, so nothing is lost.`
    : "There was nothing left to keep.";
}

/**
 * Split text for gradual insertion, preferring paragraph boundaries so a chunk
 * never ends mid-word and the document never shows a half-written sentence
 * between writes. Returns [] for empty input (nothing to insert).
 */
export function planInsertionChunks(text: string, maxChars = 1200): string[] {
  const clean = text.replace(/\r\n/g, "\n");
  if (!clean.trim()) return [];
  const limit = Math.max(80, Math.floor(maxChars));
  const chunks: string[] = [];
  let rest = clean;

  while (rest.length > limit) {
    // Prefer a blank line, then a newline, then a sentence end, then a space.
    const window = rest.slice(0, limit);
    const candidates = [
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! ")) + 1,
      window.lastIndexOf(" "),
    ].filter((i) => i > Math.floor(limit * 0.4));
    const cut = candidates.length ? Math.max(...candidates) : limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}

export function initialGradualState(text: string, maxChars = 1200): GradualState {
  const chunks = planInsertionChunks(text, maxChars);
  return {
    status: "pending",
    insertedChars: 0,
    totalChars: text.replace(/\r\n/g, "\n").length,
    chunksDone: 0,
    chunkCount: chunks.length,
    message: insertionProgressLabel({
      status: "pending", insertedChars: 0, totalChars: text.length,
      chunksDone: 0, chunkCount: chunks.length, message: "",
    }),
  };
}

export interface TransitionResult {
  ok: boolean;
  state: GradualState;
  /** Set only when the action is not allowed in the current state. */
  error: string | null;
}

/**
 * The state machine. Terminal states ignore further actions rather than
 * pretending to resume; a duplicated "complete" cannot un-stop a stopped run.
 */
export function transitionGradual(
  state: GradualState,
  action: GradualAction,
  chunkChars = 0,
): TransitionResult {
  const next: GradualState = { ...state };
  const reject = (why: string): TransitionResult => ({ ok: false, state, error: why });

  if (isTerminal(state.status) && action !== "progress") {
    return reject(
      state.status === "completed"
        ? "This insertion already finished."
        : "This insertion has ended. Start a new one to insert the rest.",
    );
  }

  switch (action) {
    case "start":
      if (state.status !== "pending") return reject("This insertion has already started.");
      next.status = "inserting";
      next.chunksDone = 0;
      next.insertedChars = 0;
      break;

    case "progress": {
      if (state.status !== "inserting") return reject("Progress was reported for an insertion that is not running.");
      if (chunkChars <= 0) return reject("Progress must report a positive number of characters.");
      next.insertedChars = Math.min(state.totalChars, state.insertedChars + chunkChars);
      next.chunksDone = Math.min(state.chunkCount, state.chunksDone + 1);
      break;
    }

    case "pause":
      if (state.status !== "inserting") return reject("Only a running insertion can be paused.");
      next.status = "paused";
      break;

    case "resume":
      if (state.status !== "paused") return reject("Only a paused insertion can be resumed.");
      next.status = "inserting";
      break;

    case "stop":
      if (state.status !== "inserting" && state.status !== "paused") {
        return reject("Only a running or paused insertion can be stopped.");
      }
      next.status = "stopped";
      break;

    case "cancel":
      if (state.status !== "pending" && state.status !== "paused") {
        return reject("Insertion can only be cancelled before it starts or while paused.");
      }
      next.status = "cancelled";
      break;

    case "complete":
      if (state.status !== "inserting") return reject("Only a running insertion can complete.");
      next.status = "completed";
      next.insertedChars = state.totalChars;
      next.chunksDone = state.chunkCount;
      break;

    case "conflict":
      if (state.status !== "inserting" && state.status !== "paused") {
        return reject("A conflict was reported for an insertion that is not running.");
      }
      next.status = "conflicted";
      break;

    case "fail":
      if (state.status !== "inserting") return reject("A failure was reported for an insertion that is not running.");
      next.status = "failed";
      break;
  }

  next.message = insertionProgressLabel(next);
  return { ok: true, state: next, error: null };
}

/** The text still to be written, given how much the provider confirmed. */
export function remainingText(text: string, insertedChars: number): string {
  const clean = text.replace(/\r\n/g, "\n");
  return clean.slice(Math.max(0, Math.min(clean.length, insertedChars)));
}

/**
 * Honest statement of what a gradual insertion does and does not prove. Shown in
 * the UI next to the control so nobody mistakes pacing for authenticity evidence.
 */
export const GRADUAL_DISCLAIMER =
  "Sophira inserts the text you approved in a few confirmed steps so you can follow along. Every step is a real change confirmed by the provider. Sophira does not imitate typing, does not add mistakes on purpose, and this record is not evidence of who wrote anything.";
