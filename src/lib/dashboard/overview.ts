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
 * Continue where you left off
 * ------------------------------------------------------------------ */

export type ResumeKind = "assignment" | "notebook" | "lecture" | "goal";

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
          href: "/lectures",
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

  const seen = new Set<string>();
  const unique = items.filter((i) => {
    if (seen.has(i.href)) return false;
    seen.add(i.href);
    return true;
  });

  return {
    items: unique.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit),
    unreadable,
  };
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
  title: string;
  href: string;
  due_at: string;
  when: string;
  tone: "overdue" | "today" | "soon" | "later";
}

export interface UpcomingResult {
  items: UpcomingItem[];
  unreadable: boolean;
}

const HORIZON_DAYS = 30;

/**
 * Deadlines in chronological order, overdue first, with a plain-English label. Only rows with
 * a real due date are included; nothing is scheduled on the member's behalf, and Sophira has
 * no second scheduling system to consult.
 */
export function buildUpcoming(rows: ListRead<DueRow>, now: Date, limit = 5): UpcomingResult {
  if (rows.state === "unavailable") return { items: [], unreadable: true };
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
      title: row.title,
      href: `/assignments/${row.id}`,
      due_at: row.due_at,
      when: describeDue(row.due_at, now) ?? "Due soon",
      tone: days < 0 ? "overdue" : days === 0 ? "today" : days <= 3 ? "soon" : "later",
    });
  }
  return {
    items: items
      .sort((a, b) => (a.due_at < b.due_at ? -1 : a.due_at > b.due_at ? 1 : 0))
      .slice(0, limit),
    unreadable: false,
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
