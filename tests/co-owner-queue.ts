import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCESS_REQUEST_SOON_DAYS,
  ACCESS_REQUEST_TODAY_DAYS,
  DORMANT_NOTICE_DAYS,
  DORMANT_SOON_DAYS,
  INVITATION_SOON_DAYS,
  INVITATION_TODAY_DAYS,
  NEVER_ACTIVE_SOON_DAYS,
  NEVER_ACTIVE_TODAY_DAYS,
  QUEUE_PAGE_SIZE,
  buildCoOwnerQueue,
  daysBetween,
  personLabel,
  queueGroups,
  queuePage,
  sortQueue,
  waitingWords,
  type QueueInputs,
} from "../src/lib/co-owner/queue";

const ROOT = join(__dirname, "..", "..");
const NOW = "2026-11-15T22:00:00.000Z";
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

const EMPTY: QueueInputs = {
  now: NOW,
  accessRequests: [],
  invitations: [],
  testerReports: [],
  members: [],
};

export function runCoOwnerQueueTests(
  assert: (cond: boolean, msg: string) => void,
  section: (t: string) => void,
): void {
  /* ---------------------------------------------------------------- */
  section("1. An empty, healthy network invents no work");
  /* ---------------------------------------------------------------- */
  {
    const q = buildCoOwnerQueue(EMPTY);
    assert(q.items.length === 0, "co-owner queue: no items when nothing is waiting");
    assert(q.counts.today === 0 && q.counts.thisWeek === 0 && q.counts.whenYouCan === 0 && q.counts.total === 0,
      "co-owner queue: every count is a real zero when every source answered");
    assert(q.nothingWaiting === true, "co-owner queue: the page can say nothing is waiting");
    assert(q.unavailable.length === 0, "co-owner queue: nothing is reported unreadable when everything answered");
    assert(/nothing is waiting/i.test(q.headline), "co-owner queue: the headline says so plainly");
  }

  /* ---------------------------------------------------------------- */
  section("2. A source that could not be read is never reported as zero (2026-11-15)");
  /* ---------------------------------------------------------------- */
  {
    const q = buildCoOwnerQueue({ ...EMPTY, testerReports: null });
    assert(q.counts.total === null, "co-owner queue: an unreadable source makes the total unknown, not zero");
    assert(q.counts.today === null && q.counts.thisWeek === null && q.counts.whenYouCan === null,
      "co-owner queue: every per-urgency count becomes unknown, because the parts cannot be trusted");
    assert(q.nothingWaiting === false, "co-owner queue: it never claims nothing is waiting while a source is missing");
    assert(q.unavailable.length === 1 && q.unavailable[0].source === "tester-report",
      "co-owner queue: the missing source is named");
    assert(/could not be read/i.test(q.headline) && /nothing could be confirmed|incomplete/i.test(q.headline),
      "co-owner queue: the headline admits the list is incomplete instead of sounding cheerful");

    const partial = buildCoOwnerQueue({
      ...EMPTY,
      accessRequests: [{ id: "r1", email: "a@b.test", created_at: daysAgo(2) }],
      members: null,
    });
    assert(partial.items.length === 1, "co-owner queue: what could be read is still shown");
    assert(/1 thing waiting/i.test(partial.headline) && /incomplete/i.test(partial.headline),
      "co-owner queue: the headline counts what it has and says the rest is missing");
    assert(partial.counts.total === null, "co-owner queue: a partially read queue still reports an unknown total");

    const order = buildCoOwnerQueue({
      ...EMPTY,
      accessRequests: null,
      invitations: null,
      testerReports: null,
      members: null,
    });
    assert(order.unavailable.map((u) => u.source).join(",") === "access-request,invitation,tester-report,quiet-member",
      "co-owner queue: the missing sources are listed in a fixed order, so the panel does not reshuffle");
    assert(order.items.length === 0 && /nothing could be confirmed/i.test(order.headline),
      "co-owner queue: with nothing readable it says so rather than showing an empty success");
  }

  /* ---------------------------------------------------------------- */
  section("3. Access requests: a week is too long, three days is worth this week");
  /* ---------------------------------------------------------------- */
  {
    const at = (n: number) => buildCoOwnerQueue({
      ...EMPTY,
      accessRequests: [{ id: "a1", email: "person@example.test", created_at: daysAgo(n) }],
    }).items[0];

    assert(at(0).urgency === "when-you-can", "co-owner queue: a request from today is not urgent");
    assert(at(ACCESS_REQUEST_SOON_DAYS - 1).urgency === "when-you-can", "co-owner queue: two days is still not urgent");
    assert(at(ACCESS_REQUEST_SOON_DAYS).urgency === "this-week", "co-owner queue: three days is this week's work");
    assert(at(ACCESS_REQUEST_TODAY_DAYS - 1).urgency === "this-week", "co-owner queue: six days is still this week");
    assert(at(ACCESS_REQUEST_TODAY_DAYS).urgency === "today", "co-owner queue: seven days is today's work");
    assert(at(30).urgency === "today" && at(30).daysWaiting === 30, "co-owner queue: a month old stays urgent");
    assert(at(30).waitingFor === "a month", "co-owner queue: the wait is written as words, not a date");
    assert(/asked to join/i.test(at(1).title), "co-owner queue: the item says what the person did");
    assert(at(1).href === "/owner/requests", "co-owner queue: it links to the screen that decides it");
    assert(at(8).detail.includes("more than a week"), "co-owner queue: the overdue item explains why it matters");
    assert(at(1).source === "access-request", "co-owner queue: the source is recorded for grouping and testing");
    assert(/^access-request:/.test(at(1).id), "co-owner queue: the id is stable and carries the record id");
  }

  /* ---------------------------------------------------------------- */
  section("4. Invitations: chase at two weeks, act at a month");
  /* ---------------------------------------------------------------- */
  {
    const at = (n: number) => buildCoOwnerQueue({
      ...EMPTY,
      invitations: [{ id: "i1", email: "quiet@example.test", created_at: daysAgo(n) }],
    }).items[0];

    assert(at(1).urgency === "when-you-can", "co-owner queue: yesterday's invitation is not urgent");
    assert(at(INVITATION_SOON_DAYS).urgency === "this-week", "co-owner queue: two weeks is worth chasing");
    assert(at(INVITATION_TODAY_DAYS - 1).urgency === "this-week", "co-owner queue: 29 days is still this week");
    assert(at(INVITATION_TODAY_DAYS).urgency === "today", "co-owner queue: a month means decide now");
    assert(at(45).waitingFor === "a month", "co-owner queue: 45 days reads as a month");
    assert(at(75).waitingFor === "2 months", "co-owner queue: 75 days reads as two months");
    assert(/has not been accepted/i.test(at(20).title), "co-owner queue: the item states the fact, not the status word");
    assert(!/pending/i.test(at(20).title + at(20).detail), "co-owner queue: the database's status word never reaches the reader");
    assert(at(40).href === "/owner/invitations", "co-owner queue: it links to the invitations screen");
    assert(at(40).action === "Chase or withdraw", "co-owner queue: the action is the work, in two words");
  }

  /* ---------------------------------------------------------------- */
  section("5. Tester reports: serious ones are today's work from the moment they arrive");
  /* ---------------------------------------------------------------- */
  {
    const rep = (severity: string, n: number) => buildCoOwnerQueue({
      ...EMPTY,
      testerReports: [{ id: "q1", title: "The essay screen loses my text", severity, created_at: daysAgo(n) }],
    }).items[0];

    assert(rep("critical", 0).urgency === "today", "co-owner queue: a critical report needs attention the day it arrives");
    assert(rep("high", 5).urgency === "today", "co-owner queue: a high report does not age out of today");
    assert(rep("medium", 0).urgency === "when-you-can", "co-owner queue: an ordinary report from today can wait");
    assert(rep("medium", 3).urgency === "this-week", "co-owner queue: three days makes an ordinary report this week's work");
    assert(rep("medium", 4).urgency === "today", "co-owner queue: four days makes it today's work");
    assert(rep("low", 0).urgency === "when-you-can", "co-owner queue: a low report does not jump the queue");
    assert(rep("CRITICAL", 0).urgency === "today", "co-owner queue: severity is compared without case, as the database stores it");
    assert(/serious/i.test(rep("high", 0).detail), "co-owner queue: the serious item says why it is at the top");
    assert(rep("medium", 1).title === "The essay screen loses my text", "co-owner queue: the report's own title is used");
    assert(rep("medium", 1).href === "/owner/qa", "co-owner queue: it links to QA triage");
    const untitled = buildCoOwnerQueue({
      ...EMPTY,
      testerReports: [{ id: "q2", title: "   ", severity: "low", created_at: daysAgo(1) }],
    }).items[0];
    assert(/no title/i.test(untitled.title), "co-owner queue: a report with no title is described, not rendered blank");
  }

  /* ---------------------------------------------------------------- */
  section("6. Quiet members: never used it, or stopped using it");
  /* ---------------------------------------------------------------- */
  {
    const member = (over: Partial<{ created: number; last: number | null; status: string }> = {}) =>
      buildCoOwnerQueue({
        ...EMPTY,
        members: [{
          id: "m1",
          display_name: "Dana Reed",
          status: over.status ?? "active",
          created_at: daysAgo(over.created ?? 40),
          last_active_at: over.last === null ? null : daysAgo(over.last ?? 1),
        }],
      }).items;

    assert(member({ last: 1 }).length === 0, "co-owner queue: a member who was here yesterday is not work");
    assert(member({ created: 2, last: null }).length === 0,
      "co-owner queue: a brand-new member is given time to try it before anyone chases them");
    assert(member({ created: NEVER_ACTIVE_SOON_DAYS - 1, last: null }).length === 0,
      "co-owner queue: six days of silence after signing up is not yet an item");
    const week = member({ created: NEVER_ACTIVE_SOON_DAYS, last: null })[0];
    assert(week && week.urgency === "this-week", "co-owner queue: a week of never opening anything is this week's work");
    assert(/never used Sophira/i.test(week.title), "co-owner queue: it says what happened without blaming anyone");
    const fortnight = member({ created: NEVER_ACTIVE_TODAY_DAYS, last: null })[0];
    assert(fortnight.urgency === "today", "co-owner queue: two weeks of never opening it becomes today's work");
    assert(member({ last: DORMANT_NOTICE_DAYS - 1 }).length === 0,
      "co-owner queue: 29 quiet days is not raised, because people have lives");
    const month = member({ last: DORMANT_NOTICE_DAYS })[0];
    assert(month && month.urgency === "this-week", "co-owner queue: a month of silence is worth a look");
    const two = member({ last: DORMANT_SOON_DAYS })[0];
    assert(two.urgency === "today", "co-owner queue: two months of silence is today's work");
    assert(/has not used Sophira for/i.test(two.title) && two.title.includes("2 months"),
      "co-owner queue: the quiet member's item says how long, in words");
    assert(member({ status: "revoked", last: 90 }).length === 0,
      "co-owner queue: a revoked account is a decision already taken, not work");
    assert(member({ status: "pending", created: 60, last: null }).length === 0,
      "co-owner queue: someone who has not been let in yet is not chased for not using it");
    assert(member({ last: 45 })[0].href === "/owner/members", "co-owner queue: quiet members link to the member list");
  }

  /* ---------------------------------------------------------------- */
  section("7. The order is the point: urgency first, then the longest wait");
  /* ---------------------------------------------------------------- */
  {
    const q = buildCoOwnerQueue({
      now: NOW,
      accessRequests: [
        { id: "old", email: "old@example.test", created_at: daysAgo(20) },
        { id: "new", email: "new@example.test", created_at: daysAgo(1) },
      ],
      invitations: [{ id: "inv", email: "inv@example.test", created_at: daysAgo(16) }],
      testerReports: [{ id: "crit", title: "Crash on save", severity: "critical", created_at: daysAgo(0) }],
      members: [],
    });
    assert(q.items[0].id === "access-request:old", "co-owner queue: the oldest urgent item leads the list");
    assert(q.items[1].id === "tester-report:crit", "co-owner queue: a critical report sits above waiting invitations and requests");
    assert(q.items[2].id === "invitation:inv", "co-owner queue: this week's work follows today's");
    assert(q.items[3].id === "access-request:new", "co-owner queue: the least urgent item is last");
    assert(q.counts.today === 2 && q.counts.thisWeek === 1 && q.counts.whenYouCan === 1,
      "co-owner queue: the counts match the list it just produced");
    assert(q.counts.total === 4 && q.counts.total === q.items.length, "co-owner queue: the total is the list's own length");

    const same = sortQueue([
      { id: "b:id", source: "quiet-member", who: "b", title: "b", detail: "d", waitingFor: "1 day", daysWaiting: 5, urgency: "today", href: "/x", action: "a", tieBreak: "id-b" },
      { id: "a:id", source: "quiet-member", who: "a", title: "a", detail: "d", waitingFor: "1 day", daysWaiting: 5, urgency: "today", href: "/x", action: "a", tieBreak: "id-a" },
    ]);
    assert(same[0].tieBreak === "id-a" && same[1].tieBreak === "id-b",
      "co-owner queue: two identical items keep a stable order instead of shuffling between loads");
  }

  /* ---------------------------------------------------------------- */
  section("8. Words a non-technical administrator can read");
  /* ---------------------------------------------------------------- */
  {
    assert(waitingWords(0) === "today", "co-owner queue: zero days reads as today");
    assert(waitingWords(1) === "1 day", "co-owner queue: one day is singular");
    assert(waitingWords(6) === "6 days", "co-owner queue: days under a week are counted");
    assert(waitingWords(7) === "a week" && waitingWords(14) === "2 weeks", "co-owner queue: weeks read naturally");
    assert(waitingWords(30) === "a month" && waitingWords(95) === "3 months", "co-owner queue: months read naturally");
    assert(waitingWords(-3) === "today", "co-owner queue: a clock skew never produces a negative wait");
    assert(daysBetween(daysAgo(9), NOW) === 9, "co-owner queue: whole days are counted");
    assert(daysBetween(null, NOW) === null, "co-owner queue: a missing timestamp is unknown, not zero");
    assert(daysBetween("not a date", NOW) === null, "co-owner queue: an unreadable timestamp is unknown, not zero");
    assert(daysBetween(new Date(Date.parse(NOW) + 86_400_000).toISOString(), NOW) === 0,
      "co-owner queue: a future timestamp reads as zero days, never a negative");

    assert(personLabel({ name: "Dana Reed", email: "d@x.test" }, "Someone") === "Dana Reed",
      "co-owner queue: the name is used when there is one");
    assert(personLabel({ name: "  ", email: "e@x.test" }, "Someone") === "e@x.test",
      "co-owner queue: a blank name falls back to the email");
    assert(personLabel({}, "Someone") === "Someone", "co-owner queue: with neither, a plain word is used");

    const all = buildCoOwnerQueue({
      now: NOW,
      accessRequests: [{ id: "r", email: "a@b.test", created_at: daysAgo(9) }],
      invitations: [{ id: "i", email: "a@b.test", created_at: daysAgo(40) }],
      testerReports: [{ id: "q", title: "Save button does nothing", severity: "high", created_at: daysAgo(1) }],
      members: [{ id: "m", display_name: "Dana", status: "active", created_at: daysAgo(90), last_active_at: daysAgo(70) }],
    });
    const prose = [all.headline, ...all.items.flatMap((i) => [i.title, i.detail, i.action, i.waitingFor])].join(" ");
    for (const banned of ["sql", "rls", "api", "null", "undefined", "migration", "pending", "status", "uuid", "403", "error code"]) {
      assert(!new RegExp(`\\b${banned}\\b`, "i").test(prose),
        `co-owner queue: no technical word reaches the reader ("${banned}")`);
    }
    for (const banned of ["claim", "assignee", "ticket"]) {
      assert(!new RegExp(banned, "i").test(prose),
        `co-owner queue: it does not imply a claiming system that does not exist ("${banned}")`);
    }
  }

  /* ---------------------------------------------------------------- */
  section("9. Paging and grouping");
  /* ---------------------------------------------------------------- */
  {
    const many = buildCoOwnerQueue({
      now: NOW,
      accessRequests: Array.from({ length: 12 }, (_, i) => ({
        id: `r${i}`,
        email: `p${i}@example.test`,
        created_at: daysAgo(10),
      })),
      invitations: [],
      testerReports: [],
      members: [],
    });
    const page = queuePage(many);
    assert(page.visible.length === QUEUE_PAGE_SIZE, "co-owner queue: the panel shows one page, not everything");
    assert(page.hidden === 12 - QUEUE_PAGE_SIZE, "co-owner queue: it says how many it held back");
    assert(queuePage(many, 50).hidden === 0, "co-owner queue: a large enough page hides nothing");
    assert(queuePage(many, 0).visible.length === 0 && queuePage(many, 0).hidden === 12,
      "co-owner queue: a zero page hides everything and says so");
    assert(queuePage(many, -4).visible.length === 0, "co-owner queue: a nonsense page size shows nothing rather than throwing");

    const groups = queueGroups(page.visible);
    assert(groups.length === 1 && groups[0].urgency === "today", "co-owner queue: empty groups are dropped");
    assert(groups[0].label === "Today", "co-owner queue: the group heading is a plain word");
    const mixed = queueGroups([
      { id: "1", source: "invitation", who: "a", title: "a", detail: "d", waitingFor: "1 day", daysWaiting: 1, urgency: "when-you-can", href: "/x", action: "a", tieBreak: "1" },
      { id: "2", source: "invitation", who: "b", title: "b", detail: "d", waitingFor: "9 days", daysWaiting: 9, urgency: "today", href: "/x", action: "a", tieBreak: "2" },
    ]);
    assert(mixed.map((g) => g.urgency).join(",") === "today,when-you-can",
      "co-owner queue: groups always appear in the order today, this week, when you can");
  }

  /* ---------------------------------------------------------------- */
  section("10. The dashboard reads it honestly, and cannot widen access to do it");
  /* ---------------------------------------------------------------- */
  {
    const page = readFileSync(join(ROOT, "src/app/co-owner/page.tsx"), "utf8");
    assert(/buildCoOwnerQueue/.test(page), "co-owner page: the queue is built by the tested module, not inline in the page");
    assert(/<CoOwnerQueue result=\{queue\}/.test(page), "co-owner page: the panel is rendered with that result");
    assert(/invitation_requests/.test(page) && /from\("invitations"\)/.test(page) && /from\("qa_reports"\)/.test(page),
      "co-owner page: the queue is fed by the three records whose status decides the work");
    assert(/\.eq\("status", "pending"\)/.test(page) && /\.eq\("status", "open"\)/.test(page),
      "co-owner page: dealt-with records leave the queue, so there is no second list to drift");
    assert(/last_active_at/.test(page), "co-owner page: quiet members are measured by real activity, not by a guess");
    assert(/error \? null :/.test(page), "co-owner page: a failed read is passed as unknown, never as an empty list");
    assert(!/createAdminClient|SERVICE_ROLE|service_role/.test(page),
      "co-owner page: the queue uses the user-scoped client, so row level security still decides");
    assert(!/"use client"/.test(readFileSync(join(ROOT, "src/components/co-owner/CoOwnerQueue.tsx"), "utf8")),
      "co-owner queue component: it stays a server component, so no member data is shipped to the browser to draw it");
    const component = readFileSync(join(ROOT, "src/components/co-owner/CoOwnerQueue.tsx"), "utf8");
    assert(/could not read/i.test(component), "co-owner queue component: the unreadable state is on screen, not only in code");
    assert(!/dangerouslySetInnerHTML/.test(component), "co-owner queue component: a report title is never rendered as HTML");
    const lib = readFileSync(join(ROOT, "src/lib/co-owner/queue.ts"), "utf8");
    assert(/DERIVED/.test(lib) && /does NOT do/.test(lib),
      "co-owner queue: the module states what it is and what it deliberately is not");
    assert(/no table in this\s+\*?\s*database records who picked an item up/i.test(lib),
      "co-owner queue: the missing claim/assignment is documented rather than implied");
    for (const href of ["/owner/requests", "/owner/invitations", "/owner/qa", "/owner/members"]) {
      assert(lib.includes(`"${href}"`), `co-owner queue: the action for that source points at ${href}, a screen a Co-Owner can open`);
    }
  }
}
