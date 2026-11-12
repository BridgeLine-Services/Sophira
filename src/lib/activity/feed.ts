/**
 * RECENT ACTIVITY (2026-11-12) — the definition the owner approved.
 *
 * Meaningful activity = an action that represents actual learning,
 * productivity, progress, or an important change in the workspace.
 *
 * The feed is DERIVED from rows that already exist (assignments, AI
 * responses, notebooks and their notes, goals, courses, writing profile,
 * member notifications, feedback). There is no click logger, no session
 * tracker and no new table: events that are not meaningful by definition
 * (logging in, opening a dashboard, navigating, typing a character,
 * refreshing) simply have no source row, so they cannot appear. The
 * queries that read these rows run under RLS with the signed-in user's
 * client, so a feed can only ever contain the user's own work.
 */

export type ActivityCategory = "learning" | "assignments" | "ai" | "achievements" | "workspace" | "notifications";

export interface ActivityEvent {
  id: string;
  category: ActivityCategory;
  title: string;
  detail: string;
  href: string;
  at: string; // ISO timestamp
}

export interface ActivitySources {
  assignments?: Array<{ id: string; title: string | null; status: string | null; mode: string | null; updated_at: string | null }>;
  responses?: Array<{ id: string; assignment_id: string | null; created_at: string | null }>;
  assignmentTitles?: Record<string, string>;
  notebooks?: Array<{ id: string; title: string | null; created_at: string | null }>;
  notebookNotes?: Array<{ id: string; notebook_id: string | null; created_at: string | null }>;
  notebookTitles?: Record<string, string>;
  goals?: Array<{ id: string; title: string | null; status: string | null; progress: number | null; updated_at: string | null }>;
  courses?: Array<{ id: string; name: string | null; created_at: string | null }>;
  writingProfileAt?: string | null;
  notifications?: Array<{ id: string; title: string | null; body: string | null; link: string | null; created_at: string | null }>;
  feedback?: Array<{ id: string; kind: string | null; created_at: string | null }>;
}

const clean = (s: string | null | undefined) => (s ?? "").trim();

/** Builds the feed. Pure: same rows in, same events out (sorted newest first). */
export function buildActivityEvents(src: ActivitySources): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const a of src.assignments ?? []) {
    const title = clean(a.title);
    if (!title) continue; // an abandoned empty draft is not an accomplishment
    const at = a.updated_at;
    if (!at) continue;
    const completed = a.status === "completed";
    const writing = a.mode === "writing";
    events.push({
      id: `assignment-${a.id}`,
      category: completed ? "achievements" : writing ? "assignments" : "learning",
      title: completed ? "Assignment completed" : writing ? "Writing task in progress" : "Assignment updated",
      detail: title,
      href: `/assignments/${a.id}`,
      at,
    });
  }

  // AI sessions: grouped per assignment per day (smart grouping - never a wall
  // of "asked a question" rows). A single session stays a single entry.
  const byAssignmentDay = new Map<string, { count: number; at: string; assignmentId: string }>();
  for (const r of src.responses ?? []) {
    if (!r.created_at) continue;
    const day = r.created_at.slice(0, 10);
    const key = `${r.assignment_id ?? "free"}|${day}`;
    const prev = byAssignmentDay.get(key);
    if (prev) prev.count += 1;
    else byAssignmentDay.set(key, { count: 1, at: r.created_at, assignmentId: r.assignment_id ?? "" });
  }
  for (const [key, v] of byAssignmentDay) {
    if (v.count < 1) continue;
    const what = v.assignmentId ? (src.assignmentTitles?.[v.assignmentId] ?? "an assignment") : "a question";
    events.push({
      id: `ai-${key}`,
      category: "ai",
      title: v.count === 1 ? "AI-assisted learning session" : `${v.count} AI-assisted sessions`,
      detail: what,
      href: v.assignmentId ? `/assignments/${v.assignmentId}` : "/dashboard",
      at: v.at,
    });
  }

  for (const n of src.notebooks ?? []) {
    const title = clean(n.title);
    if (!title || !n.created_at) continue;
    events.push({ id: `notebook-${n.id}`, category: "workspace", title: "Notebook created", detail: title, href: `/notebooks/${n.id}`, at: n.created_at });
  }

  // Notes: one entry per notebook per day (smart grouping of "saved notes").
  const notesByDay = new Map<string, { count: number; at: string; notebookId: string }>();
  for (const note of src.notebookNotes ?? []) {
    if (!note.created_at || !note.notebook_id) continue;
    const key = `${note.notebook_id}|${note.created_at.slice(0, 10)}`;
    const prev = notesByDay.get(key);
    if (prev) prev.count += 1;
    else notesByDay.set(key, { count: 1, at: note.created_at, notebookId: note.notebook_id });
  }
  for (const [key, v] of notesByDay) {
    events.push({
      id: `notes-${key}`,
      category: "workspace",
      title: v.count === 1 ? "Study notes saved" : `${v.count} notes saved`,
      detail: src.notebookTitles?.[v.notebookId] ?? "a notebook",
      href: `/notebooks/${v.notebookId}`,
      at: v.at,
    });
  }

  for (const g of src.goals ?? []) {
    const title = clean(g.title);
    if (!title || !g.updated_at) continue;
    const achieved = g.status === "achieved";
    events.push({
      id: `goal-${g.id}`,
      category: "achievements",
      title: achieved ? "Learning goal achieved" : "Progress on a learning goal",
      detail: achieved ? title : `${title} · ${g.progress ?? 0}%`,
      href: "/dashboard",
      at: g.updated_at,
    });
  }

  for (const c of src.courses ?? []) {
    const name = clean(c.name);
    if (!name || !c.created_at) continue;
    events.push({ id: `course-${c.id}`, category: "workspace", title: "Course added", detail: name, href: `/courses/${c.id}`, at: c.created_at });
  }

  if (src.writingProfileAt) {
    events.push({ id: "writing-profile", category: "workspace", title: "Writing profile updated", detail: "Your approved writing voice", href: "/writing", at: src.writingProfileAt });
  }

  for (const n of src.notifications ?? []) {
    const title = clean(n.title);
    if (!title || !n.created_at) continue;
    events.push({ id: `notification-${n.id}`, category: "notifications", title, detail: clean(n.body), href: n.link ?? "/notifications", at: n.created_at });
  }

  for (const f of src.feedback ?? []) {
    if (!f.created_at) continue;
    events.push({ id: `feedback-${f.id}`, category: "achievements", title: "Feedback received", detail: "On work you submitted", href: "/dashboard", at: f.created_at });
  }

  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export type ActivityGroup = { key: "today" | "yesterday" | "week" | "earlier"; label: string; events: ActivityEvent[] };

/** Groups events for display: Today, Yesterday, This week, Earlier. Pure. */
export function groupActivity(events: ActivityEvent[], now: Date): ActivityGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const groups: ActivityGroup[] = [
    { key: "today", label: "Today", events: [] },
    { key: "yesterday", label: "Yesterday", events: [] },
    { key: "week", label: "This week", events: [] },
    { key: "earlier", label: "Earlier", events: [] },
  ];
  for (const e of events) {
    const t = new Date(e.at).getTime();
    if (Number.isNaN(t)) continue;
    if (t >= startOfToday) groups[0].events.push(e);
    else if (t >= startOfToday - day) groups[1].events.push(e);
    else if (t >= startOfToday - 6 * day) groups[2].events.push(e);
    else groups[3].events.push(e);
  }
  return groups.filter((g) => g.events.length > 0);
}

export const ACTIVITY_FILTERS: Array<{ key: "all" | ActivityCategory; label: string }> = [
  { key: "all", label: "All activity" },
  { key: "learning", label: "Learning" },
  { key: "assignments", label: "Assignments" },
  { key: "ai", label: "AI sessions" },
  { key: "achievements", label: "Achievements" },
  { key: "workspace", label: "Workspace" },
];
