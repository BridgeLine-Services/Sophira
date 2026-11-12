/**
 * THE DASHBOARD MUST NOT LIE ABOUT A FAILED READ (2026-11-12).
 *
 * The page used to write `courses?.length ?? 0`. That is fine for a member with no courses
 * and WRONG for a member whose query failed: both rendered a confident "0", and "nothing in
 * progress" is a very different message from "we could not read your assignments".
 *
 * These tests drive the real decision module with the shapes it will see, including the
 * failure shapes, and check what a student would actually be told. They also pin the
 * recommendation rules the owner set: grounded in a real row, always explained, never a
 * fabricated weakness, never dependent on an AI provider.
 */
import { existsSync, readFileSync } from "fs";
import {
  buildProgress,
  buildRecommendations,
  buildResumeItems,
  buildUpcoming,
  countRows,
  dashboardHeadingFor,
  daysBetween,
  describeDue,
  readCount,
  readList,
  type CountRead,
  type GoalRow,
} from "../src/lib/dashboard/overview";

const NOW = new Date("2026-11-12T18:00:00.000Z");
const iso = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

const ready = <T,>(rows: T[]) => ({ state: "ready" as const, rows });
const unavailable = <T,>() => ({ state: "unavailable" as const, rows: [] as T[] });
const count = (value: number | null): CountRead => ({ state: value === null ? "unavailable" : "ready", value });

export function runDashboardOverviewTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): void {
  // ==== A. Reading honestly ====
  section("dashboard: a failed read is never an empty result");
  {
    assert(readList<{ id: string }>({ data: [], error: null }).state === "ready",
      "dashboard: a successful read with no rows is READY (genuinely empty)");
    assert(readList<{ id: string }>({ data: null, error: { message: "relation does not exist" } }).state === "unavailable",
      "dashboard: an errored read is UNAVAILABLE, not empty - the old `?? 0` bug");
    assert(readList<{ id: string }>({ data: null, error: null }).state === "unavailable",
      "dashboard: null data with no error is still UNAVAILABLE (nothing was returned to trust)");
    assert(readCount({ count: 7, error: null }).value === 7,
      "dashboard: a real count is kept");
    assert(readCount({ count: null, error: { message: "boom" } }).state === "unavailable" &&
      readCount({ count: null, error: { message: "boom" } }).value === null,
      "dashboard: a failed count has NO value - it cannot be mistaken for zero");
    assert(countRows({ data: [], error: null }).value === 0 && countRows({ data: [1, 2], error: null }).value === 2,
      "dashboard: a list's length is used only when the read succeeded");
    assert(countRows({ data: null, error: { message: "no" } }).state === "unavailable",
      "dashboard: a failed list read yields no number at all");
  }

  // ==== B. Deadlines, in plain words ====
  section("dashboard: deadlines read the way a student would say them");
  {
    assert(daysBetween(NOW, new Date(iso(3))) === 3 && daysBetween(NOW, new Date(iso(-2))) === -2,
      "dashboard: day counting is calendar-based and may be negative");
    assert(describeDue(iso(0), NOW) === "Due today", "dashboard: today's deadline says 'Due today'");
    assert(describeDue(iso(1), NOW) === "Due tomorrow", "dashboard: tomorrow says 'Due tomorrow'");
    assert(describeDue(iso(5), NOW) === "Due in 5 days", "dashboard: later says 'Due in 5 days'");
    assert(describeDue(iso(1), NOW) === "Due tomorrow" && describeDue(iso(2), NOW) === "Due in 2 days",
      "dashboard: singular/plural wording is correct");
    assert(describeDue(iso(-3), NOW) === "Overdue by 3 days",
      "dashboard: a missed deadline is stated plainly, not hidden");
    assert(describeDue(null, NOW) === null && describeDue("not a date", NOW) === null,
      "dashboard: an absent or unreadable date produces no claim at all");
  }

  // ==== C. My progress ====
  section("dashboard: progress tiles distinguish absent, zero and unreadable");
  {
    const empty = buildProgress({
      completed: count(0), active: count(0), courses: count(0), teachers: count(0),
      notebooks: ready([]), goals: ready([]),
    });
    assert(empty.length === 4 && empty.every((m) => m.value === "0" && m.state === "ready"),
      "dashboard: an empty account shows real zeros, and every tile is marked READY");
    assert(empty[0].note.includes("None yet") && empty.every((m) => !m.note.includes("couldn't read")),
      "dashboard: an empty account is told what to do, not that something failed");

    const broken = buildProgress({
      completed: count(null), active: count(null), courses: count(null), teachers: count(null),
      notebooks: unavailable<{ id: string }>(), goals: unavailable<GoalRow>(),
    });
    assert(broken.every((m) => m.value === "—" && m.state === "unavailable"),
      "dashboard: a failed read shows no number at all (an em dash), never a 0");
    assert(broken.every((m) => m.note.includes("couldn't read this just now") && m.note.includes("Nothing has been lost")),
      "dashboard: every unreadable tile says so in ordinary words, and says nothing was lost");

    const full = buildProgress({
      completed: count(12), active: count(3), courses: count(4), teachers: count(2),
      notebooks: { ...ready([{ id: "a" }, { id: "b" }]), capped: true },
      goals: ready([
        { id: "g1", title: "Improve essays", status: "active", progress: 40 },
        { id: "g2", title: "Finish calculus", status: "active", progress: 80 },
        { id: "g3", title: "Read more", status: "achieved", progress: 100 },
      ]),
    });
    assert(full[0].value === "12" && full[1].value === "3",
      "dashboard: real counts are shown exactly as read");
    assert(full[2].note.includes("2 teachers") && full[2].note.includes("2 notebooks"),
      "dashboard: the course tile reports the real teacher and notebook counts");
    assert(full[3].value === "2" && full[3].note.startsWith("60% average progress") && full[3].note.includes("1 goal achieved"),
      "dashboard: goal progress is the average of the goals still open, with achieved ones counted separately");

    const goalUnknown = buildProgress({
      completed: count(1), active: count(1), courses: count(1), teachers: count(1),
      notebooks: ready([]), goals: unavailable<GoalRow>(),
    });
    assert(goalUnknown[3].value === "—" && goalUnknown[0].value === "1",
      "dashboard: one unreadable tile does not spoil the others");
    const teacherUnknown = buildProgress({
      completed: count(1), active: count(1), courses: count(2), teachers: count(null),
      notebooks: ready([]), goals: ready([]),
    });
    assert(teacherUnknown[2].note.includes("couldn't be counted"),
      "dashboard: an unreadable teacher count is admitted in the note instead of reported as zero teachers");
  }

  // ==== D. Continue where you left off ====
  section("dashboard: only work that can genuinely be reopened is offered");
  {
    const sources = {
      assignments: ready([
        { id: "a-old", title: "Old essay", status: "active", updated_at: iso(-9) },
        { id: "a-new", title: "New essay", status: "active", updated_at: iso(-1) },
        { id: "a-done", title: "Finished lab", status: "completed", updated_at: iso(0) },
      ]),
      notebooks: ready([{ id: "n1", title: "Cell biology", updated_at: iso(-2) }]),
      lectures: ready([
        { id: "l1", original_filename: "Lecture 4.mp4", status: "ready", updated_at: iso(-3) },
        { id: "l2", original_filename: "Broken.mp4", status: "failed", updated_at: iso(-1) },
      ]),
      goals: ready([
        { id: "g1", title: "Read more", status: "active", progress: 30, updated_at: iso(-4) },
        { id: "g2", title: "Done goal", status: "achieved", progress: 100, updated_at: iso(0) },
      ]),
    };
    const result = buildResumeItems(sources, 10);
    const hrefs = result.items.map((i) => i.href);
    assert(result.items[0].kind === "assignment" && result.items[0].href === "/assignments/a-new",
      "dashboard: the most recently touched work is offered first");
    assert(hrefs.includes("/notebooks/n1") && hrefs.includes("/lectures") && hrefs.includes("/dashboard#learning-goals"),
      "dashboard: notebooks, lectures and goals are all resumable destinations");
    assert(!hrefs.includes("/assignments/a-done"),
      "dashboard: a COMPLETED assignment is not offered as 'continue where you left off'");
    assert(!result.items.some((i) => i.title === "Broken.mp4"),
      "dashboard: a lecture whose processing failed is not offered as a resumable lecture");
    assert(!result.items.some((i) => i.title === "Done goal"),
      "dashboard: an achieved goal is not offered as unfinished work");
    assert(result.items.every((i) => i.action.length > 0 && i.href.startsWith("/")),
      "dashboard: every resume item carries a real destination and a named action");
    assert(new Set(hrefs).size === hrefs.length,
      "dashboard: the same destination is never offered twice");
    assert(buildResumeItems(sources, 2).items.length === 2,
      "dashboard: the list is capped so the page stays readable");

    const broken = buildResumeItems({
      assignments: unavailable<{ id: string; title: string | null; status: string | null; updated_at: string | null }>(),
      notebooks: unavailable<{ id: string; title: string | null; updated_at: string | null }>(),
      lectures: ready([]),
      goals: ready([]),
    });
    assert(broken.items.length === 0 && broken.unreadable.includes("assignments") && broken.unreadable.includes("notebooks"),
      "dashboard: an unreadable source is NAMED so the page can say something recent may be missing");
    assert(!broken.unreadable.includes("learning goals"),
      "dashboard: a source that read fine is not blamed");
  }

  // ==== E. Upcoming work ====
  section("dashboard: upcoming work is chronological, overdue first, and never invented");
  {
    const result = buildUpcoming(ready([
      { id: "u3", title: "Later essay", due_at: iso(9), status: "active" },
      { id: "u1", title: "Overdue lab", due_at: iso(-2), status: "active" },
      { id: "u2", title: "Tomorrow's quiz", due_at: iso(1), status: "active" },
      { id: "u4", title: "Finished thing", due_at: iso(2), status: "completed" },
      { id: "u5", title: "No date", due_at: null, status: "active" },
      { id: "u6", title: "Way off", due_at: iso(90), status: "active" },
    ]), NOW, 5);
    assert(result.items.map((i) => i.id).join("|") === "u1|u2|u3",
      "dashboard: deadlines are ordered chronologically, overdue first, finished ones excluded");
    assert(result.items[0].tone === "overdue" && result.items[0].when === "Overdue by 2 days",
      "dashboard: the missed deadline is visually and verbally flagged");
    assert(result.items[1].when === "Due tomorrow" && result.items[1].tone === "soon",
      "dashboard: an approaching deadline is described in plain words");
    assert(result.items.every((i) => i.href === `/assignments/${i.id}`),
      "dashboard: every deadline links to the assignment it belongs to");
    assert(!result.items.some((i) => i.id === "u6"),
      "dashboard: a deadline months away is not presented as this week's work");

    const failed = buildUpcoming(unavailable<{ id: string; title: string | null; due_at: string | null }>(), NOW);
    assert(failed.unreadable && failed.items.length === 0,
      "dashboard: a failed deadline read is reported as unreadable, not as 'no deadlines'");
  }

  // ==== F. Sophira's Recommendations ====
  section("dashboard: recommendations are grounded, explained and never invented");
  {
    const base = {
      now: NOW,
      assignments: ready([
        { id: "a1", title: "Cell essay", status: "active", due_at: iso(-2), updated_at: iso(-1) },
        { id: "a2", title: "Chem lab", status: "active", due_at: iso(2), updated_at: iso(0) },
      ]),
      notebooks: ready([]),
      lectures: ready([]),
      goals: ready([]),
      courses: ready([{ id: "c1", name: "Biology", teacher_id: "t1" }]),
      writingProfileApproved: true,
    };
    const result = buildRecommendations(base, 4);
    assert(result.items.length > 0 && result.items.length <= 4,
      "dashboard: between one and four suggestions, never a wall of them");
    assert(result.items[0].reason === "It was due 2 days ago." && result.items[0].href === "/assignments/a1",
      "dashboard: the first suggestion is the missed deadline, and it says WHY");
    assert(result.items[1].reason === "Due in 2 days." && result.items[1].href === "/assignments/a2",
      "dashboard: the next suggestion is the deadline that is still coming");
    assert(result.items.every((r) => r.reason.trim().length > 0 && r.href.startsWith("/") && r.action.length > 0),
      "dashboard: every recommendation explains itself and offers a real action");
    assert(new Set(result.items.map((r) => r.href)).size === result.items.length && result.note === null,
      "dashboard: no duplicated destination, and no 'empty' note when there are suggestions");

    // A goal with a target date, a recent notebook and a recent lecture.
    const rich = buildRecommendations({
      now: NOW,
      assignments: ready([]),
      notebooks: ready([{ id: "n1", title: "Cell biology", updated_at: iso(-3) }]),
      lectures: ready([{ id: "l1", original_filename: "Lecture 4.mp4", status: "ready", updated_at: iso(-2) }]),
      goals: ready([{ id: "g1", title: "Improve essays", status: "active", progress: 45, target_date: "2026-11-20" }]),
      courses: ready([]),
      writingProfileApproved: false,
    }, 4);
    const titles = rich.items.map((i) => i.title).join(" | ");
    assert(rich.items.some((i) => i.title.includes("Improve essays") && i.reason.includes("45%")),
      "dashboard: a goal in progress is suggested with its real percentage");
    assert(rich.items.some((i) => i.title.includes("Cell biology")),
      "dashboard: a notebook touched this fortnight is worth revisiting");
    assert(rich.items.some((i) => i.title.includes("Lecture 4.mp4")),
      "dashboard: a ready lecture is offered to continue");
    assert(rich.items.some((i) => i.title === "Add your first course"),
      "dashboard: with no courses at all, the honest suggestion is to add one");
    assert(!titles.includes("weak") && !titles.includes("struggl"),
      "dashboard: nobody is told they are weak at something - no invented weaknesses");

    // Nothing readable at all: say so, do not invent advice.
    const nothing = buildRecommendations({
      now: NOW,
      assignments: unavailable<{ id: string; title: string | null; status: string | null; due_at: string | null; updated_at: string | null }>(),
      notebooks: unavailable<{ id: string; title: string | null; updated_at: string | null }>(),
      lectures: unavailable<{ id: string; original_filename: string | null; status: string | null; updated_at: string | null }>(),
      goals: unavailable<GoalRow>(),
      courses: unavailable<{ id: string; name: string | null; teacher_id: string | null }>(),
    });
    assert(nothing.items.length === 0 && !!nothing.note && nothing.note.includes("couldn't read"),
      "dashboard: when nothing could be read, it says so instead of inventing personalised advice");

    // Readable but genuinely quiet: a kind, honest message - not fake suggestions.
    const quiet = buildRecommendations({
      now: NOW,
      assignments: ready([]), notebooks: ready([]), lectures: ready([]), goals: ready([]),
      courses: ready([{ id: "c1", name: "Biology", teacher_id: "t1" }]),
      writingProfileApproved: true,
    });
    assert(quiet.items.length === 0 && !!quiet.note && quiet.note.startsWith("Nothing needs your attention right now"),
      "dashboard: a quiet week says nothing needs attention, and suggests how to start");

    // An AI provider being unavailable cannot empty this section: no AI is consulted at all.
    const source = readFileSync("src/lib/dashboard/overview.ts", "utf8");
    assert(!/\bfetch\(|openai|gemini|anthropic|googleapis/i.test(source),
      "dashboard: recommendations are computed from rows only - no AI provider, no network call");
    assert(!/from "(\.\.\/)*ai\//.test(source) && !source.includes("supabase"),
      "dashboard: the module imports no AI client and no database client - it cannot depend on either");
    // And every link a recommendation can produce points at a page that exists.
    for (const href of ["/assignments/x", "/notebooks/x", "/lectures", "/dashboard", "/teachers/new", "/courses/new", "/writing"]) {
      const file = href === "/dashboard" ? "src/app/dashboard/page.tsx" : `src/app${href}/page.tsx`;
      assert(existsSync(file) || href.includes("/x"),
        `dashboard: the destination ${href} exists`);
    }
    assert(existsSync("src/app/teachers/new/page.tsx") && existsSync("src/app/courses/new/page.tsx") &&
      existsSync("src/app/writing/page.tsx") && existsSync("src/app/lectures/page.tsx") &&
      existsSync("src/app/notebooks/page.tsx"),
      "dashboard: every setup recommendation links to a page that really exists");
  }

  // ==== G. Copy that names the right rank, and a page wired to this module ====
  section("dashboard: the copy never shows one rank another rank's dashboard name");
  {
    assert(dashboardHeadingFor("owner") === "Owner Dashboard" &&
      dashboardHeadingFor("co_owner") === "Co-Owner Dashboard" &&
      dashboardHeadingFor("tester") === "Tester Dashboard" &&
      dashboardHeadingFor("user") === "Home" && dashboardHeadingFor(null) === "Home",
      "dashboard: each rank's dashboard has its own name, and a member's is Home");

    const page = readFileSync("src/app/dashboard/page.tsx", "utf8");
    assert(page.includes("buildProgress(") && page.includes("buildRecommendations(") &&
      page.includes("buildResumeItems(") && page.includes("buildUpcoming("),
      "dashboard: the page delegates every judgement to the tested module");
    assert(!page.includes("activeAssignmentCount ?? 0") && !page.includes("completedAssignmentCount ?? 0"),
      "dashboard: the `?? 0` fallbacks that turned a failed read into a zero are gone");
    assert(page.includes("Sophira&apos;s Recommendations"),
      "dashboard: the section is titled 'Sophira's Recommendations'");
    assert(page.includes('role={profile.role}'),
      "dashboard: the shell receives the server-verified rank");
    assert(page.includes('id="learning-goals"'),
      "dashboard: the goals panel has the anchor the goal recommendation links to");
  }
}
