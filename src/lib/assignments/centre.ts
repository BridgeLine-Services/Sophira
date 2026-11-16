/**
 * THE STUDENT ASSIGNMENT CENTRE (2026-11-16, requirement R17 area 6).
 *
 * "Every assignment, run and draft in one place, built on stored run state, never claiming work
 * that was not verified."
 *
 * Before this, a student had to remember which of their assignments Sophira had prepared: the runs
 * screen at /writing/autonomous listed runs, the assignment workspace showed one assignment at a
 * time, and there was nowhere that answered "what still needs me?".
 *
 * Three rules decide every word on the screen, and they are the reason this is a tested module
 * rather than markup:
 *
 *   1. A draft is only called CHECKED when the stored run says so: `finalVerification.status`
 *      exactly "VERIFIED". A completed run with no verification, or with "NEEDS REVIEW", is never
 *      described as checked. Nothing is inferred from a session's status column, because that
 *      column has said "verified" since before the run had a final check at all.
 *   2. A run that has not finished is never described with a word that sounds finished. While it
 *      is queued, analysing, planning, researching, drafting, auditing or verifying, the screen
 *      says where it is and gives the step it has reached.
 *   3. An unreadable source is not a zero. If a read fails, the counts become "unknown" and the
 *      headline says the picture is incomplete, rather than showing a student an empty list and
 *      letting them believe their work has gone.
 *
 * The module is pure: it takes rows and a clock and returns what to show. Every rule above can be
 * tested without a browser, a database or a model.
 */

export type WorkState =
  | "not-started"
  | "preparing"
  | "draft-checked"
  | "draft-review"
  | "draft-unchecked"
  | "stopped-needs-you"
  | "stopped-failed"
  | "cancelled";

export interface AssignmentLite {
  id: string;
  title: string | null;
  subject?: string | null;
  status?: string | null;
  course_id?: string | null;
  teacher_id?: string | null;
  created_at?: string | null;
}

export interface RunLite {
  id: string;
  assignment_id: string | null;
  state: string | null;
  step_index?: number | null;
  total_steps?: number | null;
  final_verification?: { status?: string | null; note?: string | null } | null;
  findings?: { severity?: string | null; text?: string | null }[] | null;
  last_error?: string | null;
  updated_date?: string | null;
  created_date?: string | null;
}

export interface SessionLite {
  id: string;
  assignment_id: string | null;
  title?: string | null;
  status?: string | null;
  final_verification?: { status?: string | null; note?: string | null } | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface CentreEntry {
  assignment: AssignmentLite;
  state: WorkState;
  /** Short plain-words state, the chip on the row. */
  label: string;
  /** One sentence: what happened, or what the student should do next. */
  detail: string;
  run: RunLite | null;
  runCount: number;
  session: SessionLite | null;
  /** True ONLY when a stored final verification says VERIFIED. */
  checked: boolean;
  /** Recorded limitations worth seeing before submitting. */
  limitations: string[];
  /** Where an unfinished run has reached, when it reports it. */
  step: { index: number; total: number } | null;
  /** Most recent recorded activity, or null when the assignment has never been touched. */
  updated: string | null;
}

export interface CentreSummary {
  total: number;
  preparing: number;
  ready: number;
  checked: number;
  needsYou: number;
  stopped: number;
  notStarted: number;
  /** True when at least one of the three reads failed, so no count may be trusted. */
  incomplete: boolean;
}

export interface CentreData {
  entries: CentreEntry[];
  summary: CentreSummary;
  headline: string;
  /** Entries that need the student, worst first: stopped runs, then drafts awaiting review. */
  needsYou: CentreEntry[];
  /** Entries with a finished draft, most useful first: checked, then needs review, then unchecked. */
  readyToOpen: CentreEntry[];
  /** Entries with nothing yet, or only a run that was cancelled. */
  untouched: CentreEntry[];
  /** Entries whose run is still going. */
  preparing: CentreEntry[];
}

/** The states a run occupies while it is still doing something. */
const IN_FLIGHT = ["queued", "analyzing", "planning", "researching", "drafting", "auditing", "verifying"];

const IN_FLIGHT_WORDS: Record<string, string> = {
  queued: "waiting to start",
  analyzing: "reading the assignment",
  planning: "working out the plan",
  researching: "gathering sources",
  drafting: "writing the draft",
  auditing: "checking the draft against the brief",
  verifying: "doing the final check",
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A stored verification is only "VERIFIED" when it says so exactly. */
export function isVerified(verification: { status?: string | null } | null | undefined): boolean {
  return text(verification?.status).toUpperCase() === "VERIFIED";
}

export function isNeedsReview(verification: { status?: string | null } | null | undefined): boolean {
  return text(verification?.status).toUpperCase() === "NEEDS REVIEW";
}

/** Milliseconds for sorting, or 0 for anything a clock cannot read, so bad data sorts last. */
function stamp(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function latest<T>(rows: T[], when: (row: T) => number): T | null {
  let best: T | null = null;
  let bestAt = -1;
  for (const row of rows) {
    const at = when(row);
    if (at >= bestAt) {
      best = row;
      bestAt = at;
    }
  }
  return best;
}

function limitationsOf(run: RunLite | null, session: SessionLite | null): string[] {
  const out: string[] = [];
  for (const finding of run?.findings ?? []) {
    if (text(finding?.severity).toLowerCase() === "limitation") {
      const line = text(finding?.text);
      if (line) out.push(line);
    }
  }
  const note = text(run?.final_verification?.note) || text(session?.final_verification?.note);
  if (note && out.length === 0) out.push(note);
  return out.slice(0, 3);
}

/** What one assignment's stored work adds up to. */
export function describeAssignment(
  assignment: AssignmentLite,
  runs: RunLite[],
  sessions: SessionLite[],
): CentreEntry {
  const mine = runs.filter((r) => r.assignment_id === assignment.id);
  const drafts = sessions.filter((s) => s.assignment_id === assignment.id);
  const run = latest(mine, (r) => stamp(r.updated_date ?? r.created_date));
  const session = latest(drafts, (s) => stamp(s.updated_at ?? s.created_at));
  const updatedAt = Math.max(
    ...[...(run ? [stamp(run.updated_date ?? run.created_date)] : []), ...(session ? [stamp(session.updated_at ?? session.created_at)] : []), 0],
  );
  const updated = updatedAt > 0 ? new Date(updatedAt).toISOString() : null;
  const state = text(run?.state).toLowerCase();

  const base = {
    assignment,
    run,
    runCount: mine.length,
    session,
    limitations: limitationsOf(run, session),
    updated,
    step:
      run && Number(run.total_steps) > 0 && Number(run.step_index) >= 0
        ? { index: Number(run.step_index), total: Number(run.total_steps) }
        : null,
  };

  // A stored run is the strongest evidence there is, so it decides when it exists.
  if (run) {
    if (IN_FLIGHT.includes(state)) {
      const words = IN_FLIGHT_WORDS[state] ?? "working on it";
      return {
        ...base,
        state: "preparing",
        label: "Being prepared",
        detail: base.step
          ? `Sophira is ${words}, step ${base.step.index + 1} of ${base.step.total}. Nothing is finished yet.`
          : `Sophira is ${words}. Nothing is finished yet.`,
        checked: false,
      };
    }
    if (state === "completed") {
      if (isVerified(run.final_verification)) {
        return {
          ...base,
          state: "draft-checked",
          label: "Draft checked",
          detail: "The draft is finished and passed its final check. Read it before you submit it.",
          checked: true,
        };
      }
      if (isNeedsReview(run.final_verification)) {
        return {
          ...base,
          state: "draft-review",
          label: "Needs your review",
          detail: "The draft is finished but did not pass its final check. Read the note before using it.",
          checked: false,
        };
      }
      return {
        ...base,
        state: "draft-unchecked",
        label: "Draft, not checked",
        detail: "The draft is finished but no final check was recorded, so this is unchecked work.",
        checked: false,
      };
    }
    if (state === "blocked") {
      const reason = text(run.last_error);
      return {
        ...base,
        state: "stopped-needs-you",
        label: "Stopped, needs you",
        detail: reason
          ? `Sophira stopped and needs something from you: ${reason}`
          : "Sophira stopped and needs something from you before it can carry on.",
        checked: false,
      };
    }
    if (state === "failed") {
      const reason = text(run.last_error);
      return {
        ...base,
        state: "stopped-failed",
        label: "Did not finish",
        detail: reason ? `The run could not finish: ${reason}` : "The run could not finish. You can start it again.",
        checked: false,
      };
    }
    if (state === "cancelled") {
      return {
        ...base,
        state: "cancelled",
        label: "Cancelled",
        detail: "You cancelled this run. Nothing from it is used.",
        checked: false,
      };
    }
    return {
      ...base,
      state: "stopped-failed",
      label: "Unclear",
      detail: "The run recorded a state this screen does not recognise, so nothing is claimed about it.",
      checked: false,
    };
  }

  // No run: an older draft session may still exist, and it is described by what it records.
  if (session) {
    const verified = isVerified(session.final_verification);
    return {
      ...base,
      state: verified ? "draft-checked" : "draft-unchecked",
      label: verified ? "Draft checked" : "Draft, not checked",
      detail: verified
        ? "An earlier draft for this assignment passed its final check. Read it before you submit it."
        : "An earlier draft exists but no final check was recorded, so this is unchecked work.",
      checked: verified,
    };
  }

  return {
    ...base,
    state: "not-started",
    label: "Not started",
    detail: "Nothing has been prepared for this assignment yet.",
    checked: false,
  };
}

const ORDER_WITHIN: Record<WorkState, number> = {
  "stopped-needs-you": 0,
  "stopped-failed": 1,
  "draft-review": 2,
  "draft-checked": 3,
  "draft-unchecked": 4,
  preparing: 5,
  cancelled: 6,
  "not-started": 7,
};

export interface CentreInput {
  /** null means the read failed, which is different from an empty list. */
  assignments: AssignmentLite[] | null;
  runs: RunLite[] | null;
  sessions: SessionLite[] | null;
}

export function buildCentre(input: CentreInput): CentreData {
  const incomplete = input.assignments === null;
  const assignments = input.assignments ?? [];
  const runs = input.runs;
  const sessions = input.sessions;

  const entries = assignments.map((assignment) =>
    describeAssignment(assignment, runs ?? [], sessions ?? []),
  );

  /*
   * With no runs read, every assignment would look untouched. That is a claim, not a fact, so the
   * entry keeps what its drafts say but the summary refuses to count.
   */
  const runsUnreadable = runs === null;
  const sessionsUnreadable = sessions === null;

  const count = (predicate: (entry: CentreEntry) => boolean) => entries.filter(predicate).length;
  const summary: CentreSummary = {
    total: incomplete ? 0 : entries.length,
    preparing: runsUnreadable ? 0 : count((e) => e.state === "preparing"),
    ready: runsUnreadable && sessionsUnreadable ? 0 : count((e) => e.checked || e.state === "draft-review" || e.state === "draft-unchecked"),
    checked: runsUnreadable && sessionsUnreadable ? 0 : count((e) => e.checked),
    needsYou: runsUnreadable ? 0 : count((e) => e.state === "stopped-needs-you" || e.state === "draft-review"),
    stopped: runsUnreadable ? 0 : count((e) => e.state === "stopped-failed"),
    // "Not started" is a claim that nothing was prepared. It needs BOTH sources: with runs or
    // drafts unread, the absence of work is not something this screen can assert.
    notStarted: runsUnreadable || sessionsUnreadable ? 0 : count((e) => e.state === "not-started"),
    incomplete: incomplete || runsUnreadable || sessionsUnreadable,
  };

  return {
    entries: [...entries].sort((a, b) => {
      const byNeed = ORDER_WITHIN[a.state] - ORDER_WITHIN[b.state];
      if (byNeed !== 0) return byNeed;
      return stamp(b.updated) - stamp(a.updated) || text(a.assignment.title).localeCompare(text(b.assignment.title));
    }),
    summary,
    headline: headlineFor(summary),
    needsYou: entries
      .filter((e) => e.state === "stopped-needs-you" || e.state === "draft-review")
      .sort((a, b) => ORDER_WITHIN[a.state] - ORDER_WITHIN[b.state] || stamp(b.updated) - stamp(a.updated)),
    readyToOpen: entries
      .filter((e) => e.state === "draft-checked" || e.state === "draft-unchecked")
      .sort((a, b) => ORDER_WITHIN[a.state] - ORDER_WITHIN[b.state] || stamp(b.updated) - stamp(a.updated)),
    preparing: entries.filter((e) => e.state === "preparing"),
    untouched: entries.filter((e) => e.state === "not-started" || e.state === "cancelled" || e.state === "stopped-failed"),
  };
}

function headlineFor(summary: CentreSummary): string {
  if (summary.incomplete) {
    return "Part of your work could not be read just now, so these numbers are incomplete. Nothing has been deleted.";
  }
  if (summary.total === 0) {
    return "You have no assignments yet. When you add one, everything done for it will live here.";
  }
  const parts: string[] = [];
  if (summary.needsYou > 0) parts.push(`${summary.needsYou} need${summary.needsYou === 1 ? "s" : ""} you`);
  if (summary.checked > 0) parts.push(`${summary.checked} checked against the brief`);
  const uncheckedDrafts = summary.ready - summary.checked;
  if (uncheckedDrafts > 0) parts.push(`${uncheckedDrafts} draft${uncheckedDrafts === 1 ? "" : "s"} not checked`);
  if (summary.preparing > 0) parts.push(`${summary.preparing} being prepared`);
  if (summary.notStarted > 0) parts.push(`${summary.notStarted} not started`);
  if (parts.length === 0) return `All ${summary.total} of your assignments are in.`;
  return `Across ${summary.total} assignment${summary.total === 1 ? "" : "s"}: ${parts.join(", ")}.`;
}

/** The chip tone for a state, kept here so the page cannot invent a friendlier colour. */
export function stateTone(state: WorkState): "neutral" | "accent" | "success" | "warn" | "danger" {
  switch (state) {
    case "draft-checked":
      return "success";
    case "draft-review":
    case "stopped-needs-you":
      return "warn";
    case "stopped-failed":
      return "danger";
    case "preparing":
      return "accent";
    default:
      return "neutral";
  }
}
