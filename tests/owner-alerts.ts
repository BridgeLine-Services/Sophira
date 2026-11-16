import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALERT_PAGE_SIZE,
  DORMANT_DAYS,
  INVITATION_NOTICE_DAYS,
  NEVER_ACTIVE_DAYS,
  REQUEST_NOTICE_DAYS,
  REQUEST_TODAY_DAYS,
  REPORT_NOTICE_DAYS,
  REPORT_TODAY_DAYS,
  alertPage,
  buildOwnerAlerts,
  sortAlerts,
  type AlertInputs,
  type OwnerAlert,
} from "../src/lib/owner/alerts";

const ROOT = join(__dirname, "..", "..");
const NOW = "2026-11-16T08:00:00.000Z";
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

const EMPTY: AlertInputs = {
  now: NOW,
  actionItems: [],
  testerReports: [],
  accessRequests: [],
  invitations: [],
  members: [],
};

const item = (days: number): OwnerAlert => ({
  id: `x:${days}`,
  severity: "watch",
  source: "invitation",
  title: "x",
  why: null,
  who: null,
  href: null,
  linkLabel: null,
  waitingFor: null,
  daysWaiting: days,
});

export function runOwnerAlertTests(
  assert: (cond: boolean, msg: string) => void,
  section: (t: string) => void,
): void {
  /* ---------------------------------------------------------------- */
  section("1. An all-clear is only said when everything was actually checked");
  /* ---------------------------------------------------------------- */
  {
    const q = buildOwnerAlerts(EMPTY);
    assert(q.alerts.length === 0, "owner alerts: nothing is listed when every source answered and nothing is old");
    assert(q.counts.total === 0 && q.counts.today === 0 && q.counts.watch === 0,
      "owner alerts: the counts are real zeros, not unknowns");
    assert(q.quiet === true, "owner alerts: the page can state an all-clear");
    assert(q.unavailable.length === 0, "owner alerts: nothing is named unreadable when everything answered");
    assert(/nothing needs you/i.test(q.headline), "owner alerts: the all-clear is one plain sentence");

    const missing = buildOwnerAlerts({ ...EMPTY, members: null });
    assert(missing.counts.total === null && missing.counts.today === null,
      "owner alerts: an unchecked source makes the counts unknown, never zero");
    assert(missing.quiet === false, "owner alerts: it never says an all-clear while a check did not run");
    assert(missing.unavailable.length === 1 && missing.unavailable[0].label === "Member activity",
      "owner alerts: the unchecked source is named in the words a reader uses");
    assert(/could not be checked/i.test(missing.headline), "owner alerts: the headline admits the gap");

    const all = buildOwnerAlerts({
      now: NOW,
      actionItems: null,
      testerReports: null,
      accessRequests: null,
      invitations: null,
      members: null,
    });
    assert(all.unavailable.map((u) => u.source).join(",") === "action-item,tester-report,access-request,invitation,quiet-member",
      "owner alerts: every unchecked source is listed in a fixed order, so the panel never reshuffles");
    assert(/no alert could be confirmed/i.test(all.headline),
      "owner alerts: with nothing checkable it says so instead of showing an empty success");

    const partial = buildOwnerAlerts({
      ...EMPTY,
      invitations: [{ id: "i1", email: "a@b.test", created_at: daysAgo(40) }],
      testerReports: null,
    });
    assert(partial.alerts.length === 1 && partial.counts.total === null,
      "owner alerts: what was checked is still shown, and the total stays unknown");
    assert(/1 alert/i.test(partial.headline) && /not the whole picture/i.test(partial.headline),
      "owner alerts: the headline counts what it has and says the rest was not checked");
  }

  /* ---------------------------------------------------------------- */
  section("2. The existing action items keep their wording, and are not repeated");
  /* ---------------------------------------------------------------- */
  {
    const q = buildOwnerAlerts({
      ...EMPTY,
      actionItems: [
        {
          key: "database",
          title: "Sophira's database is missing an update",
          body: "Two updates have not been applied, so some newer screens cannot read their data.",
          href: "/owner/database",
          linkLabel: "Update the database",
          tone: "urgent",
          membersAffected: true,
        },
        {
          key: "search",
          title: "Live research is not set up",
          body: "Research uses what is already known instead of the web.",
          tone: "info",
          membersAffected: false,
        },
      ],
    });
    assert(q.alerts.length === 2, "owner alerts: every action item reaches the one list");
    const db = q.alerts.find((a) => a.id === "action-item:database")!;
    assert(db.severity === "today", "owner alerts: an urgent action item is today's work here too");
    assert(db.title === "Sophira's database is missing an update", "owner alerts: the item's own words are kept");
    assert(db.href === "/owner/database" && db.linkLabel === "Update the database",
      "owner alerts: the link the owner already had is kept, not replaced");
    assert(db.who === "People using Sophira are affected right now.",
      "owner alerts: it says whether people are affected, in plain words");
    const search = q.alerts.find((a) => a.id === "action-item:search")!;
    assert(search.severity === "watch", "owner alerts: an informational item is worth knowing, not today");
    assert(search.who === "Nobody is blocked by this yet.", "owner alerts: it says plainly that nobody is blocked");
    const unknown = buildOwnerAlerts({
      ...EMPTY,
      actionItems: [{ key: "k", title: "t", body: "b", tone: "info", membersAffected: null }],
    }).alerts[0];
    assert(unknown.who === null, "owner alerts: an unknown effect on people is left unsaid, not guessed");
    assert(unknown.href === null && unknown.linkLabel === null, "owner alerts: an item with no link renders none");
  }

  /* ---------------------------------------------------------------- */
  section("3. Age is the point: what the counts could never show");
  /* ---------------------------------------------------------------- */
  {
    const qa = (n: number, severity = "medium") => buildOwnerAlerts({
      ...EMPTY,
      testerReports: [{ id: "r1", title: "Save button does nothing", severity, created_at: daysAgo(n) }],
    }).alerts;

    assert(qa(REPORT_NOTICE_DAYS - 1).length === 0, "owner alerts: a report from today is not yet the owner's alert");
    assert(qa(REPORT_NOTICE_DAYS)[0].severity === "watch", "owner alerts: an unanswered report from yesterday is worth knowing");
    assert(qa(REPORT_TODAY_DAYS)[0].severity === "today", "owner alerts: two days unanswered is today's work");
    assert(qa(9)[0].waitingFor === "a week", "owner alerts: the alert says how long, in words");
    assert(qa(9)[0].href === "/owner/qa", "owner alerts: it links to the screen that answers it");
    assert(qa(1, "critical")[0].severity === "today",
      "owner alerts: a serious report is today's work even on its first afternoon");
    assert(/serious/i.test(qa(1, "high")[0].why ?? ""), "owner alerts: the serious one explains why it is at the top");

    const req = (n: number) => buildOwnerAlerts({
      ...EMPTY,
      accessRequests: [{ id: "a1", email: "sam@example.test", created_at: daysAgo(n) }],
    }).alerts;
    assert(req(REQUEST_NOTICE_DAYS - 1).length === 0, "owner alerts: a request from this morning is not yet an alert");
    assert(req(REQUEST_NOTICE_DAYS)[0].severity === "watch", "owner alerts: three days is worth knowing");
    assert(req(REQUEST_TODAY_DAYS)[0].severity === "today", "owner alerts: a week undecided is today's work");
    assert(/sam@example.test/.test(req(20)[0].title), "owner alerts: it names who is waiting");
    assert(/cannot get in/i.test(req(20)[0].who ?? ""), "owner alerts: it says what it costs the person waiting");

    const inv = (n: number) => buildOwnerAlerts({
      ...EMPTY,
      invitations: [{ id: "i1", email: "quiet@example.test", created_at: daysAgo(n) }],
    }).alerts;
    assert(inv(INVITATION_NOTICE_DAYS - 1).length === 0, "owner alerts: an invitation from last week is not raised");
    assert(inv(INVITATION_NOTICE_DAYS)[0].severity === "watch", "owner alerts: a month is worth knowing");
    assert(inv(INVITATION_NOTICE_DAYS * 2)[0].severity === "today", "owner alerts: two months is today's work");
    assert(/still unused/i.test(inv(40)[0].title), "owner alerts: the invitation alert states the fact");
    assert(!/pending/i.test(inv(40)[0].title + (inv(40)[0].why ?? "")),
      "owner alerts: the database's status word never reaches the reader");
  }

  /* ---------------------------------------------------------------- */
  section("4. Quiet members, without blaming anybody");
  /* ---------------------------------------------------------------- */
  {
    const member = (over: { created?: number; last?: number | null; status?: string } = {}) =>
      buildOwnerAlerts({
        ...EMPTY,
        members: [{
          id: "m1",
          display_name: "Dana Reed",
          status: over.status ?? "active",
          created_at: daysAgo(over.created ?? 60),
          last_active_at: over.last === null ? null : daysAgo(over.last ?? 1),
        }],
      }).alerts;

    assert(member({ last: 1 }).length === 0, "owner alerts: a member who was here yesterday is not an alert");
    assert(member({ created: 5, last: null }).length === 0, "owner alerts: a new member is given time before anyone worries");
    assert(member({ created: NEVER_ACTIVE_DAYS - 1, last: null }).length === 0,
      "owner alerts: two weeks of never opening it is the line, and a day short is not");
    const never = member({ created: NEVER_ACTIVE_DAYS, last: null })[0];
    assert(/never used Sophira/i.test(never.title), "owner alerts: it says what happened, plainly");
    assert(never.severity === "watch", "owner alerts: a quiet member is worth knowing, not an emergency");
    assert(/invitation nobody followed up/i.test(never.why ?? ""), "owner alerts: it offers the likely cause");
    assert(member({ last: DORMANT_DAYS - 1 }).length === 0, "owner alerts: 59 quiet days is not raised");
    const dormant = member({ last: DORMANT_DAYS })[0];
    assert(/has not used Sophira for/i.test(dormant.title) && dormant.title.includes("2 months"),
      "owner alerts: the dormant member's alert says how long, in words");
    assert(member({ status: "revoked", last: 200 }).length === 0,
      "owner alerts: a revoked account is a decision already taken, not neglect");
    assert(member({ status: "suspended", last: 200 }).length === 0,
      "owner alerts: a suspended account is handled by the action items, not repeated here");
    assert(dormant.href === "/owner/members", "owner alerts: it links to the member list");
  }

  /* ---------------------------------------------------------------- */
  section("5. One sentence per problem, and the right problem first");
  /* ---------------------------------------------------------------- */
  {
    const withItem = buildOwnerAlerts({
      ...EMPTY,
      actionItems: [{ key: "requests", title: "Three people are waiting to join", body: "Decide whether they may join.", tone: "urgent", membersAffected: true }],
      accessRequests: [{ id: "a1", email: "old@example.test", created_at: daysAgo(30) }],
    });
    assert(withItem.alerts.length === 1 && withItem.alerts[0].id === "action-item:requests",
      "owner alerts: a request already covered by an action item is not listed twice");
    assert(!withItem.alerts.some((a) => a.source === "access-request"),
      "owner alerts: the duplicate is dropped, not merged into a second wording of the same fact");

    const withQa = buildOwnerAlerts({
      ...EMPTY,
      actionItems: [{ key: "qa", title: "Tester reports are waiting", body: "Some reports have not been answered.", tone: "info", membersAffected: false }],
      testerReports: [{ id: "r1", title: "Crash", severity: "critical", created_at: daysAgo(9) }],
    });
    assert(withQa.alerts.length === 1, "owner alerts: an unanswered report the action list already mentions is not repeated");

    const ordered = buildOwnerAlerts({
      now: NOW,
      actionItems: [],
      testerReports: [{ id: "r", title: "Crash", severity: "medium", created_at: daysAgo(3) }],
      accessRequests: [{ id: "a", email: "a@b.test", created_at: daysAgo(2) }],
      invitations: [{ id: "i", email: "c@d.test", created_at: daysAgo(70) }],
      members: [{ id: "m", display_name: "Lee", status: "active", created_at: daysAgo(200), last_active_at: daysAgo(100) }],
    });
    assert(ordered.alerts[0].severity === "today", "owner alerts: today's work leads the list");
    assert(ordered.alerts[0].id === "invitation:i" && ordered.alerts[0].daysWaiting === 70,
      "owner alerts: a two-month-old invitation is today's work, and the longest wait leads");
    assert(ordered.alerts[1].id === "tester-report:r" && ordered.alerts[1].daysWaiting === 3,
      "owner alerts: the unanswered report follows, still among today's work");
    assert(ordered.alerts[2].source === "quiet-member" && ordered.alerts[2].severity === "watch",
      "owner alerts: worth-knowing items follow today's");
    assert(ordered.alerts.length === 3, "owner alerts: a request from two days ago is not yet an alert");
    assert(ordered.counts.today === 2 && ordered.counts.watch === 1 && ordered.counts.total === 3,
      "owner alerts: the counts agree with the list that was just built");

    const stable = sortAlerts([item(5), { ...item(5), id: "a:5", source: "access-request" }]);
    assert(stable[0].id === "a:5", "owner alerts: equal items keep a stable order instead of jumping between loads");

    const paged = alertPage({ ...ordered, alerts: [...ordered.alerts, ...ordered.alerts, ...ordered.alerts] });
    assert(paged.visible.length === ALERT_PAGE_SIZE, "owner alerts: the panel shows one page");
    assert(paged.hidden === ordered.alerts.length * 3 - ALERT_PAGE_SIZE, "owner alerts: it says how many it held back");
    assert(alertPage({ ...ordered, alerts: [] }, 0).hidden === 0, "owner alerts: paging an empty list is harmless");
  }

  /* ---------------------------------------------------------------- */
  section("6. The Owner page reads real records, and cannot widen access to do it");
  /* ---------------------------------------------------------------- */
  {
    const page = readFileSync(join(ROOT, "src/app/owner/page.tsx"), "utf8");
    assert(/buildOwnerAlerts/.test(page), "owner page: the alert list is built by the tested module, not inline");
    assert(/<OwnerAlerts result=\{ownerAlerts\}/.test(page), "owner page: the panel is rendered with that result");
    assert(/from\("qa_reports"\)/.test(page) && /from\("profiles"\)/.test(page),
      "owner page: alerts about reports and members come from the records themselves");
    assert(/\.in\("status", \["open", "triaged"\]\)/.test(page),
      "owner page: an answered report leaves the alert list, because the record says so");
    assert(/error \? null :/.test(page), "owner page: a failed read is passed as unknown, never as an empty list");
    assert(/createAdminClient|service_role|SERVICE_ROLE/.test(page) === false,
      "owner page: the alerts use the user-scoped client, so row level security still decides");

    const component = readFileSync(join(ROOT, "src/components/owner/OwnerAlerts.tsx"), "utf8");
    assert(/"use client"/.test(component) === false, "owner alerts panel: it stays a server component");
    assert(/could not be checked/i.test(component), "owner alerts panel: the incomplete picture is on screen");
    assert(/dangerouslySetInnerHTML/.test(component) === false, "owner alerts panel: a report title is never rendered as HTML");

    const lib = readFileSync(join(ROOT, "src/lib/owner/alerts.ts"), "utf8");
    assert(/could not read" is not "nothing wrong/i.test(lib), "owner alerts: the honesty rule is written down");
    assert(/no student's work/i.test(lib), "owner alerts: academic privacy is a stated constraint, not an accident");
    for (const href of ["/owner/qa", "/owner/requests", "/owner/invitations", "/owner/members"]) {
      assert(lib.includes(`"${href}"`), `owner alerts: the action for that source points at ${href}`);
    }
    const prose = readFileSync(join(ROOT, "src/lib/owner/alerts.ts"), "utf8")
      .split("\n")
      .filter((line) => /title:|why:|who:|headline = /.test(line))
      // Code lines mentioning null are type plumbing, not sentences a reader sees.
      .filter((line) => !/null/i.test(line))
      .join(" ");
    for (const banned of ["sql", "rls", "null", "undefined", "migration", "uuid"]) {
      assert(!new RegExp(`\\b${banned}\\b`, "i").test(prose),
        `owner alerts: no technical word is written into a sentence a reader sees ("${banned}")`);
    }
  }

  /* ---------------------------------------------------------------- */
  section("7. The requirement record cites evidence that exists");
  /* ---------------------------------------------------------------- */
  {
    const spec = readFileSync(join(ROOT, "src/lib/governance/product-spec.ts"), "utf8");
    assert(spec.includes("src/lib/owner/alerts.ts"),
      "product spec: the Owner alert area is cited by the file that implements it");
    assert(!spec.includes("src/lib/owner/autonomous-monitor.ts"),
      "product spec: an evidence path that does not exist is not cited");
    assert(/everything that needs you/i.test(spec), "product spec: R17 area 3 is recorded as built in plain words");
  }
}
