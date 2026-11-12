import {
  buildReadinessReport,
  parseGateReport,
  dateGateSnapshot,
  quickReleaseWord,
  securityNotRunCount,
  STALE_AFTER_DAYS,
} from "../src/lib/owner/release-readiness";
import {
  resolvePeriod,
  summarizePeriod,
  summarizeAiPeriod,
  summarizeDelivery,
  withinPeriod,
  MAX_CUSTOM_DAYS,
} from "../src/lib/owner/analytics-extended";
import { parseAuditFilters, auditHref, hasFilters, describeAction } from "../src/lib/owner/audit-page";
import { buildActionItems } from "../src/lib/owner/action-items";

const NOW = new Date("2026-11-11T20:00:00.000Z").getTime();
const DAY = 86_400_000;

function gateJson(checks: Array<{ id: number; name: string; status: string; detail?: string }>, generatedAt?: string) {
  return JSON.stringify({
    generatedAt: generatedAt ?? new Date(NOW - DAY).toISOString(),
    verdict: checks.every((c) => c.status === "PASS") ? "GO" : "BLOCKED",
    checks: checks.map((c) => ({ ...c, detail: c.detail ?? "" })),
  });
}

const HEALTHY_BACKUP = {
  reported: true,
  recoverable: true,
  lastRunAt: new Date(NOW - DAY).toISOString(),
  lastVerifiedAt: new Date(NOW - DAY).toISOString(),
  lastRestoreTestAt: new Date(NOW - 30 * DAY).toISOString(),
};

const READY_DEPLOYMENT = { environment: "production", commit: "abc123def456", url: "https://sophira.example" };
const READY_DATABASE = { reachable: true, applied: 52, pending: 0 };

export function runOwnerReadinessTests(
  assert: (cond: boolean, msg: string) => void,
  section: (t: string) => void,
): void {
  section("Release readiness: an absent report is unknown, never ready");
  {
    const report = buildReadinessReport({
      gateReportText: null,
      deployment: READY_DEPLOYMENT,
      database: READY_DATABASE,
      backup: HEALTHY_BACKUP,
      legalIncomplete: false,
      now: NOW,
    });
    assert(report.verdict === "UNKNOWN", "readiness: no stored report yields UNKNOWN");
    assert(report.ready === false, "readiness: no report is never READY");
    assert(report.missing.some((m) => /release checks have not been run/i.test(m)),
      "readiness: it says the release checks have not been run");
    assert(report.gate === null && Boolean(report.gateUnavailableReason),
      "readiness: it explains why there is no report instead of leaving a blank");

    const malformed = buildReadinessReport({
      gateReportText: "{not json",
      deployment: READY_DEPLOYMENT,
      database: READY_DATABASE,
      backup: HEALTHY_BACKUP,
      legalIncomplete: false,
      now: NOW,
    });
    assert(malformed.verdict === "UNKNOWN", "readiness: an unreadable report is UNKNOWN, not empty success");
  }

  section("Release readiness: statuses are preserved, never promoted");
  {
    const parsed = parseGateReport(
      gateJson([
        { id: 1, name: "Unit tests", status: "PASS" },
        { id: 2, name: "Live RLS matrix", status: "BLOCKED" },
        { id: 3, name: "Device acceptance", status: "NOT RUN" },
        { id: 4, name: "Migration chain", status: "FAIL" },
        { id: 5, name: "Bogus status", status: "MAYBE" },
      ]),
    );
    assert(parsed.snapshot !== null, "readiness: a well-formed report parses");
    const counts = parsed.snapshot!.counts;
    assert(counts.pass === 1 && counts.blocked === 1 && counts.notRun === 1 && counts.fail === 1,
      "readiness: every status is counted exactly as reported");
    assert(counts.total === 4, "readiness: an unrecognised status is dropped rather than guessed");

    const report = buildReadinessReport({
      gateReportText: gateJson([
        { id: 1, name: "Unit tests", status: "PASS" },
        { id: 4, name: "Migration chain", status: "FAIL" },
      ]),
      deployment: READY_DEPLOYMENT,
      database: READY_DATABASE,
      backup: HEALTHY_BACKUP,
      legalIncomplete: false,
      now: NOW,
    });
    assert(report.verdict === "NOT READY", "readiness: any failure makes the release NOT READY");
    assert(report.ready === false, "readiness: NOT READY is never ready");

    const blocked = buildReadinessReport({
      gateReportText: gateJson([{ id: 2, name: "Live RLS matrix", status: "BLOCKED" }]),
      deployment: READY_DEPLOYMENT,
      database: READY_DATABASE,
      backup: HEALTHY_BACKUP,
      legalIncomplete: false,
      now: NOW,
    });
    assert(blocked.verdict === "BLOCKED", "readiness: a blocked check makes the release BLOCKED, never READY");
    assert(blocked.missing.some((m) => /Live RLS matrix/.test(m)),
      "readiness: the blocked check is named in what is outstanding");
  }

  section("Release readiness: a stale report stops vouching for today's code");
  {
    const old = new Date(NOW - (STALE_AFTER_DAYS + 3) * DAY).toISOString();
    const report = buildReadinessReport({
      gateReportText: gateJson([{ id: 1, name: "Unit tests", status: "PASS" }], old),
      deployment: READY_DEPLOYMENT,
      database: READY_DATABASE,
      backup: HEALTHY_BACKUP,
      legalIncomplete: false,
      now: NOW,
    });
    assert(report.gate?.stale === true, "readiness: an old report is marked stale");
    assert(report.verdict === "BLOCKED", "readiness: a stale report cannot produce READY");
    assert(report.missing.some((m) => /days old/.test(m)), "readiness: it says how old the report is");

    const { snapshot } = parseGateReport(gateJson([{ id: 1, name: "Unit tests", status: "PASS" }], old));
    const dated = dateGateSnapshot(snapshot!, NOW);
    assert(dated.ageDays === STALE_AFTER_DAYS + 3, "readiness: the age is computed from the caller's clock");

    const undated = dateGateSnapshot({ ...snapshot!, generatedAt: null }, NOW);
    assert(undated.stale === true && undated.ageDays === null,
      "readiness: an undated report is treated as stale rather than current");
  }

  section("Release readiness: READY requires everything, including what the gate cannot see");
  {
    const green = gateJson([
      { id: 1, name: "Unit tests", status: "PASS" },
      { id: 2, name: "Live RLS matrix", status: "PASS" },
    ]);
    const ready = buildReadinessReport({
      gateReportText: green,
      deployment: READY_DEPLOYMENT,
      database: READY_DATABASE,
      backup: HEALTHY_BACKUP,
      legalIncomplete: false,
      now: NOW,
    });
    assert(ready.verdict === "READY", "readiness: a current, fully green report with a healthy system is READY");
    assert(ready.ready === true, "readiness: the ready flag agrees with the verdict");

    const pendingDatabase = buildReadinessReport({
      gateReportText: green,
      deployment: READY_DEPLOYMENT,
      database: { reachable: true, applied: 50, pending: 2 },
      backup: HEALTHY_BACKUP,
      legalIncomplete: false,
      now: NOW,
    });
    assert(pendingDatabase.verdict !== "READY",
      "readiness: a green report cannot override a database that still has updates pending");
    assert(pendingDatabase.sections.find((s) => s.key === "database")!.facts.some((f) => f.state === "blocked"),
      "readiness: the database section says the update is missing");

    const noRestore = buildReadinessReport({
      gateReportText: green,
      deployment: READY_DEPLOYMENT,
      database: READY_DATABASE,
      backup: { ...HEALTHY_BACKUP, recoverable: false, lastRestoreTestAt: null },
      legalIncomplete: false,
      now: NOW,
    });
    assert(noRestore.verdict === "BLOCKED", "readiness: an unrehearsed restore blocks READY");
    assert(noRestore.sections.find((s) => s.key === "recovery")!.facts.some((f) => /rehearsed/i.test(f.label) && f.state === "blocked"),
      "readiness: the recovery section names the missing rehearsal");

    const legal = buildReadinessReport({
      gateReportText: green,
      deployment: READY_DEPLOYMENT,
      database: READY_DATABASE,
      backup: HEALTHY_BACKUP,
      legalIncomplete: true,
      now: NOW,
    });
    assert(legal.verdict === "NOT READY", "readiness: legal placeholders are a genuine 'not ready'");
    const unknownLegal = buildReadinessReport({
      gateReportText: green,
      deployment: READY_DEPLOYMENT,
      database: READY_DATABASE,
      backup: HEALTHY_BACKUP,
      legalIncomplete: null,
      now: NOW,
    });
    assert(unknownLegal.sections.find((s) => s.key === "legal")!.facts[0].state === "unknown",
      "readiness: unreadable legal pages are unknown, not assumed complete");
  }

  section("Release readiness: the overview's cheap word agrees with the rule");
  {
    assert(quickReleaseWord(null, NOW).word === null, "readiness: no report means no release line on the overview");
    assert(quickReleaseWord(gateJson([{ id: 1, name: "Unit tests", status: "FAIL" }]), NOW).word === "NOT READY",
      "readiness: a failed check reads NOT READY");
    assert(quickReleaseWord(gateJson([{ id: 1, name: "Unit tests", status: "NOT RUN" }]), NOW).word === "BLOCKED",
      "readiness: an unrun check reads BLOCKED");
    const snap = quickReleaseWord(gateJson([{ id: 1, name: "Unit tests", status: "PASS" }]), NOW);
    assert(snap.word === "READY" && snap.snapshot !== null, "readiness: a green current report reads READY");
    assert(securityNotRunCount(snap.snapshot) === 0, "readiness: no security check is counted as unrun when none is");
    const withSecurity = quickReleaseWord(
      gateJson([{ id: 7, name: "Security: RLS matrix", status: "NOT RUN" }]),
      NOW,
    );
    assert(securityNotRunCount(withSecurity.snapshot) === 1,
      "readiness: an unrun security check is counted so the owner is told");
    assert(securityNotRunCount(null) === null, "readiness: no report yields no security count at all");
  }

  section("Analytics: the reporting period is validated, not guessed");
  {
    const fallback = resolvePeriod({ now: NOW });
    assert(fallback.period?.key === "30" && fallback.error === null, "period: the default is the last 30 days");

    const seven = resolvePeriod({ key: "7", now: NOW });
    assert(seven.period?.days === 7, "period: seven days is seven days");

    const half = resolvePeriod({ key: "custom", from: "2026-11-01", now: NOW });
    assert(half.period === null && Boolean(half.error), "period: a half-entered custom range is refused, not guessed");

    const reversed = resolvePeriod({ key: "custom", from: "2026-11-05", to: "2026-11-01", now: NOW });
    assert(reversed.period === null && /before the start/i.test(reversed.error ?? ""),
      "period: a reversed range is refused with a plain sentence");

    const valid = resolvePeriod({ key: "custom", from: "2026-11-01", to: "2026-11-05", now: NOW });
    assert(valid.period?.days === 5 && valid.period.custom === true, "period: a custom range counts both end days");

    const tooLong = resolvePeriod({ key: "custom", from: "2024-01-01", to: "2026-01-01", now: NOW });
    assert(tooLong.period === null && (tooLong.error ?? "").includes(String(MAX_CUSTOM_DAYS)),
      "period: an oversized range is refused and says the limit");

    assert(withinPeriod("2026-11-03T00:00:00.000Z", valid.period!), "period: a date inside the range matches");
    assert(!withinPeriod("2026-10-01T00:00:00.000Z", valid.period!), "period: a date outside the range does not match");
    assert(!withinPeriod(null, valid.period!), "period: a missing date never counts as inside");
  }

  section("Analytics: membership and invitation figures follow the chosen period");
  {
    const period = resolvePeriod({ key: "7", now: NOW }).period!;
    const members = [
      { user_id: "a", created_at: new Date(NOW - 2 * DAY).toISOString(), last_active_at: new Date(NOW - DAY).toISOString(), role: "owner", status: "active" },
      { user_id: "b", created_at: new Date(NOW - 40 * DAY).toISOString(), last_active_at: new Date(NOW - 20 * DAY).toISOString(), role: "user", status: "active" },
      { user_id: "c", created_at: new Date(NOW - 60 * DAY).toISOString(), last_active_at: null, role: "user", status: "suspended" },
    ];
    const invitations = [
      { status: "accepted", created_at: new Date(NOW - 3 * DAY).toISOString() },
      { status: "pending", created_at: new Date(NOW - 2 * DAY).toISOString() },
      { status: "accepted", created_at: new Date(NOW - 200 * DAY).toISOString() },
    ];
    const summary = summarizePeriod(members, invitations, period);
    assert(summary.newMembers === 1, "analytics: only the member who joined inside the period is counted");
    assert(summary.activeMembers === 1, "analytics: only activity inside the period is counted");
    assert(summary.invitationsIssued === 2 && summary.invitationsAccepted === 1,
      "analytics: invitation counts are limited to the period");
    assert(summary.invitationsPendingNow === 1, "analytics: the waiting backlog is reported as it is now");
    assert(summary.acceptancePercent === 50, "analytics: the rate uses the period's own issued invitations");
    assert(summary.byRole.some((r) => r.role === "owner" && r.count === 1), "analytics: roles are counted as recorded");

    const none = summarizePeriod([], [], period);
    assert(none.acceptancePercent === null, "analytics: no invitations in the period is null, never 0%");
  }

  section("Analytics: AI activity keeps unmeasured time out of the averages");
  {
    const period = resolvePeriod({ key: "7", now: NOW }).period!;
    const rows = [
      { provider: "gemini", ok: true, latency_ms: 400, created_at: new Date(NOW - DAY).toISOString(), tokens_in: 10, tokens_out: 20 },
      { provider: "gemini", ok: false, latency_ms: null, created_at: new Date(NOW - DAY).toISOString() },
      { provider: "selfhost", ok: true, latency_ms: 1200, created_at: new Date(NOW - 2 * DAY).toISOString() },
      { provider: "gemini", ok: true, latency_ms: 500, created_at: new Date(NOW - 60 * DAY).toISOString() },
    ];
    const summary = summarizeAiPeriod(rows, period);
    assert(summary.requests === 3, "analytics: requests outside the period are excluded");
    assert(summary.succeeded === 2 && summary.failed === 1, "analytics: successes and failures are counted separately");
    assert(summary.days.length === 2, "analytics: a day without requests is not invented");
    const dayOne = summary.days.find((d) => d.requests === 2)!;
    assert(dayOne.averageMs === 400, "analytics: an untimed request is excluded from the day's average");
    assert(dayOne.measured === 1, "analytics: the measured count is reported, so the average can be judged");
    assert(summary.byProvider[0].provider === "gemini" && summary.byProvider[0].requests === 2,
      "analytics: providers are ranked by real requests");
    assert(summary.tokens.in === 10 && summary.tokens.out === 20, "analytics: tokens are summed only where recorded");

    const missing = summarizeAiPeriod(null, period);
    assert(missing.reading === "unavailable" && missing.requests === 0 && missing.days.length === 0,
      "analytics: an unreadable record is unavailable, never zero activity");
    assert(Boolean(missing.reason), "analytics: an unreadable record explains itself");

    const untimed = summarizeAiPeriod(
      [{ provider: "gemini", ok: true, latency_ms: null, created_at: new Date(NOW - DAY).toISOString() }],
      period,
    );
    assert(untimed.timed === false, "analytics: no timed request means no response-time trend to draw");
    assert(untimed.days[0].averageMs === null, "analytics: an untimed day shows no average rather than 0 ms");
  }

  section("Analytics: invitation delivery distinguishes unrecorded from failed");
  {
    const summary = summarizeDelivery([
      { status: "accepted", email_status: "sent" },
      { status: "pending", email_status: "failed" },
      { status: "pending", email_status: "not_configured" },
      { status: "pending", email_status: null },
      { status: "revoked" },
    ]);
    assert(summary.sent === 1 && summary.failed === 1 && summary.notConfigured === 1,
      "analytics: each delivery result is counted as recorded");
    assert(summary.unrecorded === 2, "analytics: a copied link or an older row is unrecorded, not a failure");
    assert(summary.deliveryRatePercent === 33.3, "analytics: the rate is over attempted sends only");

    const empty = summarizeDelivery([]);
    assert(empty.deliveryRatePercent === null, "analytics: no attempts means no rate, not 0%");
  }

  section("Security history: filters are validated and the URL round-trips");
  {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const filters = parseAuditFilters({
      q: "  ada  ",
      action: "set_role",
      actor: uuid,
      target: "not-a-uuid",
      outcome: "refused",
      from: "2026-11-01",
      to: "not-a-date",
      page: "3",
    });
    assert(filters.search === "ada", "audit: search text is trimmed");
    assert(filters.action === "set_role", "audit: a known action is kept");
    assert(filters.actorId === uuid, "audit: a real member id is accepted");
    assert(filters.targetId === null, "audit: an invalid id is dropped rather than passed to the database");
    assert(filters.outcome === "refused", "audit: the outcome filter is kept");
    assert(filters.from === "2026-11-01" && filters.to === null, "audit: a bad date is dropped, not guessed");
    assert(filters.page === 3, "audit: the page number is read");

    const rogue = parseAuditFilters({ action: "drop_table", page: "-4", outcome: "maybe" });
    assert(rogue.action === null && rogue.outcome === null && rogue.page === 1,
      "audit: an unknown action, outcome or page is refused");

    assert(hasFilters(filters) === true, "audit: an active filter is recognised");
    assert(hasFilters(parseAuditFilters({})) === false, "audit: an unfiltered visit reports no filters");

    const href = auditHref(filters);
    assert(href.startsWith("/owner/security?"), "audit: the paging link keeps the filters in the URL");
    assert(href.includes("q=ada") && href.includes("page=3"), "audit: search and page survive the round trip");
    assert(auditHref(parseAuditFilters({})) === "/owner/security", "audit: no filters produce a clean URL");
    assert(describeAction("set_role") === "Role change", "audit: a stored action gets a plain label");
  }

  section("Owner action list: the new responsibilities are real, and absent when unknown");
  {
    const base = {
      requestsWaiting: 0,
      suspendedMembers: 0,
      databaseOutdated: false,
      membersUnreadable: false,
      aiReady: true,
      microsoftReady: true,
      googleReady: true,
      searchReady: true,
    };
    const unknown = buildActionItems(base);
    assert(unknown.length === 0, "actions: nothing is invented when the new inputs were not supplied");

    const items = buildActionItems({
      ...base,
      backup: { recoverable: false, reported: true },
      restoreRehearsed: false,
      storageVerified: false,
      securityChecksNotRun: 2,
      release: "NOT READY",
      canvasReady: false,
    });
    const keys = items.map((i) => i.key);
    assert(keys.includes("restore-rehearsal"), "actions: an unrehearsed restore is listed");
    assert(keys.includes("storage-backup"), "actions: unverified uploaded files are listed");
    assert(keys.includes("security-checks"), "actions: unrun security checks are listed");
    assert(keys.includes("canvas"), "actions: an unconfigured Canvas connection is listed");
    const release = items.find((i) => i.key === "release")!;
    assert(release.tone === "urgent", "actions: a failed release check is urgent");
    assert(release.href === "/owner/release-readiness", "actions: it links to the release page");

    const blocked = buildActionItems({ ...base, release: "BLOCKED" });
    assert(blocked.find((i) => i.key === "release")?.tone === "info",
      "actions: an unfinished release is information, not an emergency");

    const noBackupReport = buildActionItems({ ...base, restoreRehearsed: false, storageVerified: false });
    assert(!noBackupReport.some((i) => i.key === "restore-rehearsal"),
      "actions: without a backup report the restore item is not repeated");

    for (const item of items) {
      assert(!/migration|sql|pgrst|schema cache|rls/i.test(item.title + " " + item.body),
        `actions: "${item.title}" avoids technical vocabulary`);
    }
  }
}
