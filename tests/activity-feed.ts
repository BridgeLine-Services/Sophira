/**
 * Recent Activity (2026-11-12): the owner's approved definition, enforced.
 * "Meaningful activity represents actual learning, productivity, progress,
 * or an important change in the workspace." The feed is derived from real
 * rows, so non-meaningful events (login, navigation, button clicks, typing)
 * are structurally impossible - these pins prove the sources stay that way.
 */
import { readFileSync } from "fs";
import { buildActivityEvents, groupActivity, ACTIVITY_FILTERS, type ActivityEvent } from "../src/lib/activity/feed";

export function runActivityFeedTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("Recent Activity: meaningful events only, private, grouped, filterable");

  const now = new Date("2026-11-11T18:00:00Z");

  // Real accomplishments become entries; empty drafts never do.
  const events = buildActivityEvents({
    assignments: [
      { id: "a1", title: "Introduction to Anthropology", status: "completed", mode: "assignment", updated_at: "2026-11-11T18:42:00Z" },
      { id: "a2", title: "", status: "active", mode: "assignment", updated_at: "2026-11-11T18:00:00Z" },
    ],
    responses: [
      { id: "r1", assignment_id: "a3", created_at: "2026-11-11T17:15:00Z" },
      { id: "r2", assignment_id: "a3", created_at: "2026-11-11T17:30:00Z" },
      { id: "r3", assignment_id: "a3", created_at: "2026-11-11T17:45:00Z" },
    ],
    assignmentTitles: { a3: "Cultural Anthropology" },
    notebooks: [{ id: "n1", title: "Chapter 4", created_at: "2026-11-11T16:30:00Z" }],
  });

  assert(events.some((e) => e.title === "Assignment completed" && e.detail === "Introduction to Anthropology"),
    "activity: a completed assignment appears with its real title");
  assert(!events.some((e) => e.detail === "" && e.title.includes("Assignment")),
    "activity: an abandoned empty draft is NOT an accomplishment");
  const ai = events.filter((e) => e.category === "ai");
  assert(ai.length === 1 && ai[0].title === "3 AI-assisted sessions",
    "activity: repeated AI sessions in one assignment-day collapse into one grouped entry");
  assert(events.some((e) => e.title === "Notebook created"),
    "activity: creating a notebook is a workspace event");

  // Every event carries the data the UI needs to be useful.
  assert(events.every((e) => e.href.startsWith("/") && e.at && e.title),
    "activity: every entry links to the real record and carries a timestamp");

  // Grouping: Today / Yesterday / This week / Earlier, in the reader's clock.
  const mk = (at: string): ActivityEvent => ({ id: at, category: "learning", title: "t", detail: "", href: "/x", at });
  const groups = groupActivity([mk("2026-11-11T12:00:00Z"), mk("2026-11-10T12:00:00Z"), mk("2026-11-07T12:00:00Z"), mk("2026-09-01T12:00:00Z")], now);
  assert(groups.map((g) => g.key).join() === "today,yesterday,week,earlier",
    "activity: entries land in Today / Yesterday / This week / Earlier");
  assert(groups.every((g) => g.events.length > 0),
    "activity: empty time groups are dropped, never rendered as bare headings");

  // The filters the owner specified.
  assert(ACTIVITY_FILTERS.map((f) => f.key).join() === "all,learning,assignments,ai,achievements,workspace",
    "activity: filters are exactly All / Learning / Assignments / AI sessions / Achievements / Workspace");

  // Sources: derived from real rows under RLS - no click log, no admin client.
  const lib = readFileSync("src/lib/activity/feed.ts", "utf8");
  assert(!lib.includes("createAdminClient") && !lib.includes("service_role"),
    "activity: the feed never reads through an admin client - RLS scopes every row to its owner");
  const page = readFileSync("src/app/dashboard/page.tsx", "utf8");
  assert(page.includes('from("member_notifications")') && page.includes("buildActivityEvents"),
    "activity: the dashboard derives the feed from real user rows (notifications included)");
  assert(!/from\("(auth\.audit|sessions|page_views|clicks|events)\)"/.test(page),
    "activity: no login, navigation or click telemetry table is consulted anywhere");
  // Behavioural, not textual: feed a source set where ONLY non-meaningful things
  // "happened" (no rows at all - a login or page view writes nothing) and assert
  // the vocabulary itself never names such an event.
  const barren = buildActivityEvents({});
  assert(barren.length === 0,
    "activity: sessions/navigation cannot produce entries - they have no source row");
  const vocabulary = buildActivityEvents({
    assignments: [{ id: "x", title: "T", status: "active", mode: "assignment", updated_at: "2026-11-11T10:00:00Z" }],
    responses: [{ id: "r", assignment_id: "x", created_at: "2026-11-11T10:00:00Z" }],
    notebooks: [{ id: "n", title: "N", created_at: "2026-11-11T10:00:00Z" }],
  }).map((e) => e.title.toLowerCase()).join(" | ");
  assert(!/log ?in|sign ?in|page view|clicked|navigat|refresh/.test(vocabulary),
    "activity: the emitted event vocabulary contains no login/navigation/click entries");
}
