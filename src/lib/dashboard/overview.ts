/**
 * THE MEMBER DASHBOARD'S DECISIONS, IN ONE PURE MODULE (2026-11-12).
 *
 * The dashboard used to make every judgement inline in the page: `?? 0` for a count that
 * failed (so an unreadable table looked like "nothing to do"), one "resume" list built from
 * whatever happened to be fetched, and no advice at all. None of that could be tested, and
 * a failed read was indistinguishable from an empty one.
 *
 * Everything here is PURE: rows in, decisions out. No Supabase, no React, no clock of its
 * own (the caller passes `now`), no AI, no network. That makes the honesty rules testable:
 *
 *   - a failed read is REPORTED, never rendered as zero;
 *   - an empty result is only "empty" when the read genuinely succeeded;
 *   - a recommendation exists only when a real row justifies it, and it always says why;
 *   - nothing here invents a percentage, a deadline, a weakness or a learning pattern.
 */
import type { Role } from "../roles";

/* ------------------------------------------------------------------ *
 * Reading honestly
 * ------------------------------------------------------------------ */

/** `unavailable` means "could not be read". It is never the same as "empty". */
export type ReadState = "ready" | "unavailable";

export interface CountRead {
  state: ReadState;
  value: number | null;
}

export interface ListRead<T> {
  state: ReadState;
  rows: T[];
  /** True when the query was deliberately capped, so the number is a minimum. */
  capped?: boolean;
}

/**
 * Turns a Supabase result into a read we can trust. A row array with an error is
 * `unavailable` - not an empty list - because "we could not ask" and "the answer is none"
 * are different things to a student looking at their own progress.
 */
export function readList<T>(result: { data: T[] | null; error: unknown }): ListRead<T> {
  if (result.error || result.data === null) return { state: "unavailable", rows: [] };
  return { state: "ready", rows: result.data };
}

/** Same rule for a `count: "exact", head: true` read. */
export function readCount(result: { count: number | null; error: unknown }): CountRead {
  if (result.error || result.count === null) return { state: "unavailable", value: null };
  return { state: "ready", value: result.count };
}

/** And for a list query where the LENGTH is the number we want. */
export function countRows(result: { data: unknown[] | null; error: unknown }): CountRead {
  if (result.error || result.data === null) return { state: "unavailable", value: null };
  return { state: "ready", value: result.data.length };
}

/** The number of calendar days between two instants (UTC), which may be negative. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Overdue by 3 days" / "Due today" / "Due tomorrow" / "Due in 5 days". */
export function describeDue(dueAt: string | null | undefined, now: Date): string | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const days = daysBetween(now, due);
  if (days < 0) return `Overdue by ${plural(Math.abs(days), "day")}`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${plural(days, "day")}`;
}

/* ------------------------------------------------------------------ *
 * My progress
 * ------------------------------------------------------------------ */

export interface GoalRow {
  id: string;
  title: string | null;
  status: string | null;
  progress: number | null;
  target_date?: string | null;
  updated_at?: string | null;
}

export interface ProgressMetric {
  key: string;
  label: string;
  /** The big number, or an em dash for a read that failed. */
  value: string;
  note: string;
  state: ReadState;
}

export interface ProgressInput {
  completed: CountRead;
  active: CountRead;
  courses: CountRead;
  teachers: CountRead;
  notebooks: ListRead<{ id: string }>;
  goals: ListRead<GoalRow>;
}

const COULD_NOT_READ = "We couldn't read this just now. Nothing has been lost - try again in a moment.";

/** Average progress of the goals still being worked on, or null when there is nothing to average. */
export function averageGoalProgress(goals: GoalRow[]): number | null {
  const open = goals.filter((g) => g.status !== "achieved");
  if (!open.length) return null;
  const total = open.reduce((sum, g) => sum + Math.max(0, Math.min(100, Number(g.progress ?? 0))), 0);
  return Math.round(total / open.length);
}

/**
 * The "how am I doing" tiles. Each one distinguishes three situations in plain words: read
 * and non-zero, read and genuinely zero, and could not be read.
 */
export function buildProgress(input: ProgressInput): ProgressMetric[] {
  const { completed, active, courses, teachers, notebooks, goals } = input;

  const metrics: ProgressMetric[] = [];

  metrics.push({
    key: "completed",
    label: "Completed",
    state: completed.state,
    value: completed.state === "ready" ? String(completed.value ?? 0) : "—",
    note:
      completed.state === "ready"
        ? (completed.value ?? 0) === 0
          ? "None yet. Finish an assignment and it will count here."
          : "assignments finished"
        : COULD_NOT_READ,
  });

  metrics.push({
    key: "active",
    label: "In progress",
    state: active.state,
    value: active.state === "ready" ? String(active.value ?? 0) : "—",
    note:
      active.state === "ready"
        ? (active.value ?? 0) === 0
          ? "Nothing open right now."
          : "assignments still open"
        : COULD_NOT_READ,
  });

  const notebookNote =
    notebooks.state === "ready"
      ? notebooks.rows.length === 0
        ? " - no notebooks yet"
        : ` - ${notebooks.rows.length}${notebooks.capped && notebooks.rows.length >= 3 ? "+" : ""} notebook${notebooks.rows.length === 1 && !notebooks.capped ? "" : "s"}`
      : "";

  metrics.push({
    key: "courses",
    label: "Courses",
    state: courses.state,
    value: courses.state === "ready" ? String(courses.value ?? 0) : "—",
    note:
      courses.state === "ready"
        ? (courses.value ?? 0) === 0
          ? "Add a course so Sophira knows the subject and level."
          : teachers.state === "ready"
            ? `with ${plural(teachers.value ?? 0, "teacher")} on file${notebookNote}`
            : `teacher profiles couldn't be counted just now${notebookNote}`
        : COULD_NOT_READ,
  });

  metrics.push({
    key: "goals",
    label: "Learning goals",
    state: goals.state,
    value:
      goals.state === "ready"
        ? String(goals.rows.filter((g) => g.status !== "achieved").length)
        : "—",
    note:
      goals.state === "ready"
        ? goals.rows.length === 0
          ? "Set a goal and Sophira can track it with you."
          : (() => {
              const openGoals = goals.rows.filter((g) => g.status !== "achieved");
              const achieved = goals.rows.length - openGoals.length;
              if (!openGoals.length) return `${plural(achieved, "goal")} achieved so far`;
              const average = averageGoalProgress(goals.rows) ?? 0;
              return `${average}% average progress${achieved ? `, ${plural(achieved, "goal")} achieved` : ""}`;
            })()
        : COULD_NOT_READ,
  });

  return metrics;
}

/* ------------------------------------------------------------------ *
 * This week, as bars
 * ------------------------------------------------------------------ */

export interface DayBar {
  /** YYYY-MM-DD in UTC, so the same rows always bucket the same way. */
  key: string;
  /** Single-letter weekday, for a narrow chart. */
  label: string;
  count: number;
  isToday: boolean;
}

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * The last seven days of real activity, oldest first. It counts the events the activity feed
 * already derived from rows, so the chart cannot show a day with nothing behind it. Days with
 * no events are drawn as zero-height bars rather than skipped, because a gap is information.
 */
export function weekActivity(events: Array<{ at: string }>, now: Date, days = 7): DayBar[] {
  const span = Math.max(1, Math.min(14, Math.floor(days)));
  const buckets: DayBar[] = [];
  const index = new Map<string, DayBar>();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (span - 1) * 86_400_000;
  for (let i = 0; i < span; i += 1) {
    const at = new Date(start + i * 86_400_000);
    const key = at.toISOString().slice(0, 10);
    const bar: DayBar = { key, label: WEEKDAY_INITIALS[at.getUTCDay()], count: 0, isToday: i === span - 1 };
    buckets.push(bar);
    index.set(key, bar);
  }
  for (const event of events) {
    const at = new Date(event.at);
    if (Number.isNaN(at.getTime())) continue;
    const bucket = index.get(at.toISOString().slice(0, 10));
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

/* ------------------------------------------------------------------ *
 * The fuller series: sign-ups and study activity, one bar per day
 * ------------------------------------------------------------------ */

/** One row of public.network_activity_daily() - counts only, never member data. */
export interface ActivityDayRow {
  /** YYYY-MM-DD in UTC. */
  day: string;
  signups: number;
  study_sessions: number;
  answers: number;
}

/** Which count a chart is drawing, named so a label can never drift from the numbers. */
export type ActivityMetric = "signups" | "study_sessions" | "answers";

export const ACTIVITY_METRIC_LABEL: Record<ActivityMetric, string> = {
  signups: "accounts created",
  study_sessions: "study sessions",
  answers: "answers submitted",
};

/**
 * Turn the database's per-day rows into chart bars.
 *
 * The database already emits one row per day in the window (a generate_series left-joined to
 * the counts), and this repeats that guarantee on the client: every day in the window becomes a
 * bar, so a quiet day is a real zero and never a gap. A row outside the window, an unparseable
 * day, or a negative count is dropped rather than drawn - a chart that invents a day is worse
 * than one that shows fewer.
 */
export function dailySeries(
  rows: ActivityDayRow[],
  metric: ActivityMetric,
  now: Date,
  days = 14,
): DayBar[] {
  const span = Math.max(1, Math.min(90, Math.floor(days)));
  const buckets: DayBar[] = [];
  const index = new Map<string, DayBar>();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (span - 1) * 86_400_000;
  for (let i = 0; i < span; i += 1) {
    const at = new Date(start + i * 86_400_000);
    const key = at.toISOString().slice(0, 10);
    const bar: DayBar = { key, label: WEEKDAY_INITIALS[at.getUTCDay()], count: 0, isToday: i === span - 1 };
    buckets.push(bar);
    index.set(key, bar);
  }
  for (const row of rows) {
    const key = typeof row?.day === "string" ? row.day.slice(0, 10) : "";
    const bucket = index.get(key);
    if (!bucket) continue;
    const value = Number(row[metric]);
    if (!Number.isFinite(value) || value < 0) continue;
    bucket.count += Math.round(value);
  }
  return buckets;
}

/* ------------------------------------------------------------------ *
 * Overall learning progress - one number, and the arithmetic behind it
 * ------------------------------------------------------------------ */

export interface OverallProgress {
  state: ReadState;
  /** 0-100, or null when a percentage would be a guess. */
  percent: number | null;
  label: string;
  /** The calculation, in words, so nobody has to trust a bare percentage. */
  basis: string;
  /** A sentence a student can read: what the number counts and what it does not. */
  detail: string;
  done: number | null;
  total: number | null;
}

/**
 * HOW "OVERALL PROGRESS" IS CALCULATED (documented, not invented).
 *
 *   percent = completed assignments / (completed assignments + open assignments)
 *
 * Chosen because both numbers are real `assignments` rows belonging to this member, and the
 * ratio answers a question a student can actually act on: "of the work I have, how much is
 * finished?". Deliberate limits, all stated in `detail`:
 *
 *   - It is NOT course completion. Enrolling in a course is not progress through it, and
 *     Sophira has no per-course completion figure it could honestly report.
 *   - Archived and draft assignments are not counted, because they are not work in flight.
 *   - It is not weighted by size or grade: an assignment is an assignment. Sophira does not
 *     have a defensible per-assignment weight, so it does not pretend to.
 *   - With no assignments at all there is no percentage: `percent` is null and the page says
 *     so instead of showing a reassuring 0%.
 *   - If either count could not be read, the state is `unavailable` and no number is shown.
 */
export function overallProgress(completed: CountRead, active: CountRead): OverallProgress {
  const basis =
    "Finished assignments divided by all assignments you still have (finished + open). " +
    "Archived drafts are not counted, and course enrolment is never treated as progress.";
  if (completed.state !== "ready" || active.state !== "ready") {
    return {
      state: "unavailable",
      percent: null,
      label: "Overall learning progress",
      basis,
      detail: "We couldn't read your assignment counts just now, so no percentage is shown rather than a wrong one.",
      done: null,
      total: null,
    };
  }
  const done = Math.max(0, completed.value ?? 0);
  const open = Math.max(0, active.value ?? 0);
  const total = done + open;
  if (total === 0) {
    return {
      state: "ready",
      percent: null,
      label: "Overall learning progress",
      basis,
      detail: "No assignments yet, so there is no progress to show. Start one and this will fill in.",
      done: 0,
      total: 0,
    };
  }
  const percent = Math.round((done / total) * 100);
  return {
    state: "ready",
    percent,
    label: "Overall learning progress",
    basis,
    detail:
      done === 0
        ? `None of your ${plural(total, "assignment")} is finished yet. That is a starting line, not a problem.`
        : `${done} of ${plural(total, "assignment")} finished. This counts assignments only - it is not a percentage of a course.`,
    done,
    total,
  };
}

/* ------------------------------------------------------------------ *
 * Learning milestones
 * ------------------------------------------------------------------ */

export interface Milestone {
  id: string;
  label: string;
  achieved: boolean;
  /** "3 of 5" - the visible evidence, never a guess. */
  detail: string;
}

export interface MilestoneInput {
  completed: CountRead;
  notebooks: ListRead<{ id: string }>;
  lectures: ListRead<{ id: string; status: string | null }>;
  goals: ListRead<GoalRow>;
  courses: CountRead;
}

export interface MilestonesResult {
  state: ReadState;
  items: Milestone[];
  achieved: number;
  total: number;
  /** The next milestone that is not yet reached, or null when every one is. */
  next: Milestone | null;
}

const LECTURE_DONE = new Set(["ready", "partial"]);

/**
 * Milestones are counters over rows that exist. Each tier names the number it needs and shows
 * how far along it is, so a milestone is never merely "true": 3 of 5 is visible progress even
 * when the tier is not reached. If a source could not be read, the whole set is marked
 * `unavailable` rather than reporting milestones that were never checked.
 */
export function buildMilestones(input: MilestoneInput): MilestonesResult {
  const { completed, notebooks, lectures, goals, courses } = input;
  const readable = [completed, notebooks, lectures, goals, courses].every((r) => r.state === "ready");
  const n = (v: number | null) => Math.max(0, v ?? 0);
  const finished = n(completed.value);
  const notebookCount = notebooks.rows.length;
  const lectureCount = lectures.rows.filter((l) => LECTURE_DONE.has(String(l.status ?? ""))).length;
  const achievedGoals = goals.rows.filter((g) => g.status === "achieved").length;
  const courseCount = n(courses.value);

  const tier = (id: string, label: string, have: number, need: number): Milestone => ({
    id,
    label,
    achieved: have >= need,
    detail: have >= need ? "Reached" : `${Math.min(have, need)} of ${need}`,
  });

  const items: Milestone[] = [
    tier("first-assignment", "First assignment finished", finished, 1),
    tier("five-assignments", "Five assignments finished", finished, 5),
    tier("ten-assignments", "Ten assignments finished", finished, 10),
    tier("first-notebook", "First notebook created", notebookCount, 1),
    tier("five-notebooks", "Five notebooks created", notebookCount, 5),
    tier("first-lecture", "First lecture transcribed", lectureCount, 1),
    tier("first-goal", "First learning goal achieved", achievedGoals, 1),
    tier("first-course", "First course set up", courseCount, 1),
  ];

  const achieved = items.filter((m) => m.achieved).length;
  return {
    state: readable ? "ready" : "unavailable",
    items,
    achieved,
    total: items.length,
    next: items.find((m) => !m.achieved) ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Continue where you left off
 * ------------------------------------------------------------------ */

export type ResumeKind = "assignment" | "notebook" | "lecture" | "goal" | "conversation";

export interface ResumeItem {
  id: string;
  kind: ResumeKind;
  title: string;
  detail: string;
  href: string;
  action: string;
  at: string;
}

export interface ResumeSources {
  assignments?: ListRead<{ id: string; title: string | null; status: string | null; updated_at: string | null }>;
  notebooks?: ListRead<{ id: string; title: string | null; updated_at: string | null }>;
  lectures?: ListRead<{ id: string; original_filename: string | null; status: string | null; updated_at: string | null }>;
  goals?: ListRead<GoalRow>;
  /**
   * AI conversations. In Sophira a conversation is not a separate object: each answer is a
   * `responses` row, and a response attached to an assignment is reopened by opening that
   * assignment, which reloads its latest answer and the course/teacher context that produced
   * it. A response with no `assignment_id` (a free question) has no destination that can
   * restore it, so it is deliberately NOT offered rather than linked somewhere misleading.
   */
  responses?: ListRead<{ id: string; assignment_id: string | null; created_at: string | null }>;
  /** Assignment id -> title, so a conversation is named after the work it belongs to. */
  assignmentTitles?: Record<string, string>;
}

export interface ResumeResult {
  items: ResumeItem[];
  /** Plain-English names of the sources that could not be read, for an honest footnote. */
  unreadable: string[];
}

const LECTURE_RESUMABLE = new Set(["ready", "partial", "transcribing"]);

/**
 * The most recent learning destinations that can genuinely be reopened. Every entry points at
 * a screen that restores its own state:
 *   - an assignment opens the assignment workspace for that id;
 *   - a notebook opens its notes;
 *   - the lecture studio lists every recording this member owns and reopens it there;
 *   - a goal opens the goals panel on this dashboard.
 * A row that cannot be reopened (a failed upload, a finished goal) is not offered.
 */
export function buildResumeItems(sources: ResumeSources, limit = 4): ResumeResult {
  const items: ResumeItem[] = [];
  const unreadable: string[] = [];

  if (sources.assignments) {
    if (sources.assignments.state === "unavailable") unreadable.push("assignments");
    else {
      for (const a of sources.assignments.rows) {
        if (!a.title || !a.updated_at) continue;
        if (a.status && a.status !== "active" && a.status !== "draft") continue;
        items.push({
          id: `assignment-${a.id}`,
          kind: "assignment",
          title: a.title,
          detail: "Assignment",
          href: `/assignments/${a.id}`,
          action: "Resume assignment",
          at: a.updated_at,
        });
      }
    }
  }

  if (sources.responses) {
    if (sources.responses.state === "unavailable") unreadable.push("AI conversations");
    else {
      const finished = new Set(
        (sources.assignments?.state === "ready" ? sources.assignments.rows : [])
          .filter((a) => a.status === "completed" || a.status === "archived")
          .map((a) => a.id),
      );
      for (const r of sources.responses.rows) {
        // No assignment -> no persistent conversation destination. Skipped, not faked.
        if (!r.assignment_id || !r.created_at || finished.has(r.assignment_id)) continue;
        const title = (sources.assignmentTitles?.[r.assignment_id] ?? "").trim();
        if (!title) continue;
        items.push({
          id: `conversation-${r.assignment_id}`,
          kind: "conversation",
          title,
          detail: "AI conversation",
          href: `/assignments/${r.assignment_id}`,
          action: "Reopen conversation",
          at: r.created_at,
        });
      }
    }
  }

  if (sources.notebooks) {
    if (sources.notebooks.state === "unavailable") unreadable.push("notebooks");
    else {
      for (const n of sources.notebooks.rows) {
        if (!n.title || !n.updated_at) continue;
        items.push({
          id: `notebook-${n.id}`,
          kind: "notebook",
          title: n.title,
          detail: "Notebook",
          href: `/notebooks/${n.id}`,
          action: "Open notebook",
          at: n.updated_at,
        });
      }
    }
  }

  if (sources.lectures) {
    if (sources.lectures.state === "unavailable") unreadable.push("lecture recordings");
    else {
      for (const l of sources.lectures.rows) {
        const name = (l.original_filename ?? "").trim();
        if (!name || !l.updated_at) continue;
        if (!LECTURE_RESUMABLE.has(String(l.status ?? ""))) continue;
        items.push({
          id: `lecture-${l.id}`,
          kind: "lecture",
          title: name,
          detail: "Lecture recording",
          // The studio reopens one recording when it is named in the URL (?asset=...).
          href: `/lectures?asset=${l.id}`,
          action: "Continue lecture",
          at: l.updated_at,
        });
      }
    }
  }

  if (sources.goals) {
    if (sources.goals.state === "unavailable") unreadable.push("learning goals");
    else {
      for (const g of sources.goals.rows) {
        if (!g.title || g.status === "achieved" || !g.updated_at) continue;
        items.push({
          id: `goal-${g.id}`,
          kind: "goal",
          title: g.title,
          detail: `Learning goal · ${Math.max(0, Math.min(100, Number(g.progress ?? 0)))}%`,
          href: "/dashboard#learning-goals",
          action: "Open goal",
          at: g.updated_at,
        });
      }
    }
  }

  // Newest first, THEN one row per destination: when an assignment and a conversation point at
  // the same screen, the one describing the most recent activity is kept.
  const ordered = [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const seen = new Set<string>();
  const unique = ordered.filter((i) => {
    if (seen.has(i.href)) return false;
    seen.add(i.href);
    return true;
  });

  return { items: unique.slice(0, limit), unreadable };
}

/* ------------------------------------------------------------------ *
 * Upcoming work
 * ------------------------------------------------------------------ */

export interface DueRow {
  id: string;
  title: string | null;
  due_at: string | null;
  status?: string | null;
}

export interface UpcomingItem {
  id: string;
  /** Where the date comes from, so a study plan is never confused with a submission deadline. */
  kind: "assignment" | "study";
  title: string;
  href: string;
  due_at: string;
  when: string;
  tone: "overdue" | "today" | "soon" | "later";
}

export interface UpcomingResult {
  items: UpcomingItem[];
  /** The assignment deadline read failed. */
  unreadable: boolean;
  /** The study-plan read failed, so a planned session may be missing from the timeline. */
  studyUnreadable: boolean;
}

/**
 * A persisted study plan (work_schedules, migration 0010/0017). This is Sophira's ONLY
 * scheduling record: there is no separate calendar, no user-created reminder table and no
 * events feed, so nothing else is claimed below. `deadline` is the plan's target finish.
 */
export interface StudySessionRow {
  id: string;
  assignment_id: string | null;
  deadline: string | null;
  status: string | null;
  title?: string | null;
}

const HORIZON_DAYS = 30;

/**
 * Deadlines in chronological order, overdue first, with a plain-English label. Only rows with
 * a real due date are included; nothing is scheduled on the member's behalf, and Sophira has
 * no second scheduling system to consult.
 */
export function buildUpcoming(
  rows: ListRead<DueRow>,
  now: Date,
  limit = 5,
  sessions?: ListRead<StudySessionRow>,
): UpcomingResult {
  const studyUnreadable = sessions?.state === "unavailable";
  const unreadable = rows.state === "unavailable";
  if (unreadable && !sessions) return { items: [], unreadable, studyUnreadable };
  const items: UpcomingItem[] = [];
  for (const row of rows.rows) {
    if (!row.due_at || !row.title) continue;
    if (row.status && row.status !== "active") continue;
    const due = new Date(row.due_at);
    if (Number.isNaN(due.getTime())) continue;
    const days = daysBetween(now, due);
    if (days > HORIZON_DAYS) continue;
    items.push({
      id: row.id,
      kind: "assignment",
      title: row.title,
      href: `/assignments/${row.id}`,
      due_at: row.due_at,
      when: describeDue(row.due_at, now) ?? "Due soon",
      tone: days < 0 ? "overdue" : days === 0 ? "today" : days <= 3 ? "soon" : "later",
    });
  }

  // A planned or paused study session the member actually saved. Finished plans are history,
  // not upcoming work, and a session without a date cannot be placed on a timeline.
  for (const session of sessions?.state === "ready" ? sessions.rows : []) {
    if (!session.deadline || !session.assignment_id) continue;
    if (!["planned", "running", "paused"].includes(String(session.status ?? ""))) continue;
    const deadline = new Date(session.deadline);
    if (Number.isNaN(deadline.getTime())) continue;
    const days = daysBetween(now, deadline);
    if (days > HORIZON_DAYS) continue;
    const label = (session.title ?? "").trim();
    items.push({
      id: `study-${session.id}`,
      kind: "study",
      title: `${session.status === "paused" ? "Paused study session: " : "Study session: "}${label || "your assignment"}`,
      href: `/assignments/${session.assignment_id}`,
      due_at: session.deadline,
      when: describeDue(session.deadline, now) ?? "Due soon",
      tone: days < 0 ? "overdue" : days === 0 ? "today" : days <= 3 ? "soon" : "later",
    });
  }

  // One row per destination: a study plan and the assignment deadline it belongs to are the
  // same place to go, and the deadline row is the more useful of the two.
  const byHref = new Map<string, UpcomingItem>();
  for (const item of items.sort((a, b) => (a.due_at < b.due_at ? -1 : a.due_at > b.due_at ? 1 : 0))) {
    const existing = byHref.get(item.href);
    if (!existing || (existing.kind === "study" && item.kind === "assignment")) byHref.set(item.href, item);
  }
  return {
    items: [...byHref.values()]
      .sort((a, b) => (a.due_at < b.due_at ? -1 : a.due_at > b.due_at ? 1 : 0))
      .slice(0, limit),
    unreadable,
    studyUnreadable,
  };
}

/* ------------------------------------------------------------------ *
 * Sophira's Recommendations
 * ------------------------------------------------------------------ */

export interface Recommendation {
  id: string;
  title: string;
  /** WHY it is being suggested, in plain words, from a real field. */
  reason: string;
  href: string;
  action: string;
}

export interface RecommendationInput {
  now: Date;
  assignments?: ListRead<{ id: string; title: string | null; status: string | null; due_at: string | null; updated_at: string | null }>;
  notebooks?: ListRead<{ id: string; title: string | null; updated_at: string | null }>;
  lectures?: ListRead<{ id: string; original_filename: string | null; status: string | null; updated_at: string | null }>;
  goals?: ListRead<GoalRow>;
  courses?: ListRead<{ id: string; name: string | null; teacher_id: string | null }>;
  writingProfileApproved?: boolean;
}

export interface RecommendationsResult {
  items: Recommendation[];
  /** Shown when there is genuinely nothing to suggest, and says why. */
  note: string | null;
}

const RECENT_DAYS = 14;

/**
 * SOPHIRA'S RECOMMENDATIONS.
 *
 * The rules the owner set, encoded here so they can be tested:
 *   1. every recommendation is grounded in a row that exists;
 *   2. no invented weakness, habit or learning pattern, ever;
 *   3. nothing about another member's work (these reads are RLS-scoped to the member);
 *   4. the reason is stated, briefly, in ordinary words;
 *   5. no AI provider is involved, so a provider being down cannot empty the section;
 *   6. every link goes to a screen that exists;
 *   7. if nothing can be justified, it says so instead of inventing advice.
 *
 * Priority: an overdue deadline, a deadline within three days, the assignment you were last
 * working on, a goal you are part-way through, a recent notebook, a recent lecture, then two
 * setup suggestions. At most four are shown, because four things to do is help and ten is noise.
 */
export function buildRecommendations(input: RecommendationInput, limit = 4): RecommendationsResult {
  const { now } = input;
  const out: Recommendation[] = [];
  const taken = new Set<string>();

  const push = (rec: Recommendation) => {
    if (taken.has(rec.href) || out.length >= limit) return;
    taken.add(rec.href);
    out.push(rec);
  };

  const assignments = input.assignments?.state === "ready" ? input.assignments.rows : [];
  const openAssignments = assignments.filter(
    (a) => a.title && a.status !== "completed" && a.status !== "archived",
  );

  // 1 + 2. Real deadlines first: a thing with a date beats a thing without one.
  const dated = openAssignments
    .filter((a) => a.due_at)
    .map((a) => ({ a, days: daysBetween(now, new Date(a.due_at as string)) }))
    .filter((x) => !Number.isNaN(x.days))
    .sort((x, y) => x.days - y.days);

  const overdue = dated.filter((x) => x.days < 0);
  if (overdue.length) {
    const { a, days } = overdue[0];
    push({
      id: `overdue-${a.id}`,
      title: `Finish “${a.title}”`,
      reason: `It was due ${plural(Math.abs(days), "day")} ago.`,
      href: `/assignments/${a.id}`,
      action: "Open assignment",
    });
  }
  const soon = dated.filter((x) => x.days >= 0 && x.days <= 3);
  if (soon.length) {
    const { a } = soon[0];
    push({
      id: `soon-${a.id}`,
      title: `Get ahead on “${a.title}”`,
      reason: `${(describeDue(a.due_at, now) ?? "It is due soon").replace(/\.$/, "")}.`,
      href: `/assignments/${a.id}`,
      action: "Open assignment",
    });
  }

  // 3. The assignment worked on most recently - the cheapest way back into real progress.
  const recentAssignment = [...openAssignments]
    .filter((a) => a.updated_at)
    .sort((a, b) => ((a.updated_at as string) < (b.updated_at as string) ? 1 : -1))[0];
  if (recentAssignment) {
    const days = daysBetween(new Date(recentAssignment.updated_at as string), now);
    push({
      id: `resume-${recentAssignment.id}`,
      title: `Pick up “${recentAssignment.title}”`,
      reason:
        days <= 0
          ? "You were working on it earlier today."
          : `You last worked on it ${plural(days, "day")} ago.`,
      href: `/assignments/${recentAssignment.id}`,
      action: "Resume assignment",
    });
  }

  // 4. A goal that is genuinely part-way through.
  const goals = input.goals?.state === "ready" ? input.goals.rows : [];
  const openGoal = goals
    .filter((g) => g.status === "active" && Number(g.progress ?? 0) < 100 && g.title)
    .sort((a, b) => Number(b.progress ?? 0) - Number(a.progress ?? 0))[0];
  if (openGoal) {
    const progress = Math.max(0, Math.min(100, Number(openGoal.progress ?? 0)));
    const target = openGoal.target_date ? new Date(openGoal.target_date) : null;
    const targetNote =
      target && !Number.isNaN(target.getTime())
        ? (() => {
            const days = daysBetween(now, target);
            if (days < 0) return ` Its target date passed ${plural(Math.abs(days), "day")} ago.`;
            if (days === 0) return " Its target date is today.";
            return ` ${plural(days, "day")} left before its target date.`;
          })()
        : "";
    push({
      id: `goal-${openGoal.id}`,
      title: `Move “${openGoal.title}” forward`,
      reason: `You are ${progress}% of the way there.${targetNote}`,
      href: "/dashboard#learning-goals",
      action: "Update progress",
    });
  }

  // 5. Notes worth revisiting.
  const notebooks = input.notebooks?.state === "ready" ? input.notebooks.rows : [];
  const recentNotebook = notebooks
    .filter((n) => n.title && n.updated_at && daysBetween(new Date(n.updated_at), now) <= RECENT_DAYS)
    .sort((a, b) => ((a.updated_at as string) < (b.updated_at as string) ? 1 : -1))[0];
  if (recentNotebook) {
    const days = Math.max(0, daysBetween(new Date(recentNotebook.updated_at as string), now));
    push({
      id: `notebook-${recentNotebook.id}`,
      title: `Review your notes in “${recentNotebook.title}”`,
      reason: days === 0 ? "You added to it today." : `You added to it ${plural(days, "day")} ago.`,
      href: `/notebooks/${recentNotebook.id}`,
      action: "Open notebook",
    });
  }

  // 6. A recording that is ready and recent.
  const lectures = input.lectures?.state === "ready" ? input.lectures.rows : [];
  const recentLecture = lectures
    .filter(
      (l) =>
        (l.original_filename ?? "").trim() &&
        LECTURE_RESUMABLE.has(String(l.status ?? "")) &&
        l.updated_at &&
        daysBetween(new Date(l.updated_at), now) <= RECENT_DAYS,
    )
    .sort((a, b) => ((a.updated_at as string) < (b.updated_at as string) ? 1 : -1))[0];
  if (recentLecture) {
    push({
      id: `lecture-${recentLecture.id}`,
      title: `Continue the lecture “${(recentLecture.original_filename ?? "").trim()}”`,
      reason: "Its recording and study notes are ready.",
      href: "/lectures",
      action: "Open lecture",
    });
  }

  // 7 + 8. Setup that genuinely unlocks better help. Never framed as a criticism.
  const courses = input.courses?.state === "ready" ? input.courses.rows : [];
  const courseWithoutTeacher = courses.find((c) => c.name && !c.teacher_id);
  if (courseWithoutTeacher) {
    push({
      id: `teacher-${courseWithoutTeacher.id}`,
      title: `Add ${courseWithoutTeacher.name}'s teacher`,
      reason: "Sophira can only follow a teacher's rules once that teacher's profile exists.",
      href: "/teachers/new",
      action: "Add a teacher",
    });
  }
  if (courses.length === 0 && input.courses?.state === "ready") {
    push({
      id: "first-course",
      title: "Add your first course",
      reason: "Courses tell Sophira the subject, level and teacher rules to use.",
      href: "/courses/new",
      action: "Add a course",
    });
  }
  if (input.writingProfileApproved === false) {
    push({
      id: "writing-profile",
      title: "Approve your Writing Profile",
      reason: "Writing tasks only sound like you once a profile is approved.",
      href: "/writing",
      action: "Open writing profile",
    });
  }

  if (out.length) return { items: out, note: null };

  // Nothing could be justified. Say so honestly, and distinguish "nothing to do" from "we
  // could not see enough to advise".
  const anyReadable = [input.assignments, input.notebooks, input.lectures, input.goals, input.courses].some(
    (source) => source?.state === "ready",
  );
  return {
    items: [],
    note: anyReadable
      ? "Nothing needs your attention right now. Start an assignment or set a learning goal and Sophira will suggest what to review next."
      : "Sophira couldn't read enough of your work just now to suggest anything useful. Nothing has been lost - reload the page in a moment.",
  };
}

/* ------------------------------------------------------------------ *
 * Role-aware dashboard copy
 * ------------------------------------------------------------------ */

/**
 * The name of a dashboard, by rank. Used so a Co-Owner is never told they are looking at the
 * Owner's dashboard (which is what the old hardcoded label did on the member list).
 */
export function dashboardHeadingFor(role: Role | string | null | undefined): string {
  switch (role) {
    case "owner":
      return "Owner Dashboard";
    case "co_owner":
      return "Co-Owner Dashboard";
    case "tester":
      return "Tester Dashboard";
    default:
      return "Home";
  }
}
