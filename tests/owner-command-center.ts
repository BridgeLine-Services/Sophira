/**
 * THE OWNER'S COMMAND CENTRE (2026-11-13).
 *
 * Four new views - AI operations, feature health, network analytics, backup and recovery - are
 * built on five pure modules. This suite pins the rules those modules exist to enforce:
 *
 *   - a number that was not measured is never reported as zero;
 *   - "we could not look" and "nothing happened" are different answers;
 *   - an unknown is never softened into a comfortable success.
 *
 * Every assertion here is about honesty, not formatting, because a wrong "everything is fine"
 * is the failure mode that actually hurts a non-technical owner.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildAiOperationsReport, describeAiActivity, summarizeLatency, formatDuration } from "../src/lib/owner/ai-operations";
import { buildAnalyticsReport, formatPercent, plainLabel } from "../src/lib/owner/analytics";
import {
  buildBackupReport,
  readBackupReport,
  formatDay,
  STALE_AFTER_DAYS,
  RESTORE_STALE_AFTER_DAYS,
  BACKUP_REPORT_ENV,
} from "../src/lib/owner/backup-status";
import { normalizeDirectoryRows, normalizeDirectoryRow } from "../src/lib/owner/directory-rows";
import { buildFeatureCatalog, countByState, featuresNeedingOwner, stateLabel, stateExplanation } from "../src/lib/owner/feature-catalog";
import { countAiFailures } from "../src/lib/owner/ai-usage";
import { buildActionItems } from "../src/lib/owner/action-items";

const ROOT = join(__dirname, "..", "..");
const HEALTHY_INPUTS = {
  aiConfigured: true,
  aiActive: true,
  localInferenceConfigured: false,
  databaseReachable: true,
  searchConfigured: true,
  googleConfigured: true,
  microsoftConfigured: true,
  canvasConfigured: true,
  emailConfigured: true,
};

export function runOwnerCommandCenterTests(
  assert: (cond: boolean, msg: string) => void,
  section: (t: string) => void,
): void {
  /* ------------------------------------------------------------------ */
  /* AI OPERATIONS                                                       */
  /* ------------------------------------------------------------------ */
  section("1. AI operations: an unmeasured duration is not a fast answer");
  {
    const latency = summarizeLatency([
      { provider: "gemini", ok: true, latency_ms: 100 },
      { provider: "gemini", ok: true, latency_ms: 300 },
      { provider: "gemini", ok: true, latency_ms: null },
      { provider: "gemini", ok: true },
    ]);
    assert(latency.measured === 2 && latency.unmeasured === 2,
      "ai operations: attempts without a duration are counted separately, not averaged in as 0 ms");
    assert(latency.averageMs === 200, "ai operations: the average uses only the measured attempts");
    assert(latency.medianMs === 100 || latency.medianMs === 300,
      "ai operations: the median is a real measured value, never an invented midpoint");

    const none = summarizeLatency([{ ok: true }, { ok: true }]);
    assert(none.averageMs === null && none.medianMs === null && none.p95Ms === null && none.slowestMs === null,
      "ai operations: with nothing timed, every statistic is null rather than 0");

    const rejected = summarizeLatency([{ latency_ms: -5 }, { latency_ms: 99_999_999 }]);
    assert(rejected.measured === 0 && rejected.unmeasured === 2,
      "ai operations: a negative or implausible duration is discarded, not displayed");
    assert(formatDuration(null) !== "0 ms" && /not available/i.test(formatDuration(null)),
      "ai operations: a missing duration reads as not available in plain words");
  }

  section("2. AI operations: an unreadable record is not an idle AI");
  {
    const unavailable = buildAiOperationsReport({ rows: null });
    assert(unavailable.reading === "unavailable", "ai operations: unreadable rows are reported as unavailable");
    assert(unavailable.totals.requests === 0 && unavailable.totals.successPercent === null,
      "ai operations: an unreadable record never becomes a zero count with a 0% success rate");
    assert(Boolean(unavailable.unavailableReason) && !/\d{3}|error|undefined/i.test(unavailable.unavailableReason ?? ""),
      "ai operations: the reason is plain language with no code");
    assert(/0%/.test(describeAiActivity(unavailable)) === false,
      "ai operations: the summary sentence does not imply measured inactivity");

    const empty = buildAiOperationsReport({ rows: [] });
    assert(empty.reading === "read" && empty.totals.successPercent === null,
      "ai operations: a readable but empty record has no success percentage to claim");

    const mixed = buildAiOperationsReport({
      rows: [
        { provider: "gemini", model: "flash", ok: true, latency_ms: 120, tokens_in: 10, tokens_out: 20 },
        { provider: "gemini", model: "flash", ok: false, latency_ms: 40 },
        { provider: "openai", model: "gpt", ok: true },
      ],
    });
    assert(mixed.totals.requests === 3 && mixed.totals.succeeded === 2 && mixed.totals.failed === 1,
      "ai operations: successes and failures are counted from the recorded rows");
    assert(mixed.byProvider.length === 2, "ai operations: providers are broken down separately");
    assert(mixed.cost.available === false && mixed.quota.available === false,
      "ai operations: cost and quota are refused rather than guessed");
    assert(countAiFailures(mixed.byProvider.length ? [{ ok: false }, { ok: true }] : []) === 1,
      "ai operations: failures can be counted for the overview's attention list");
    assert(countAiFailures(null) === null,
      "ai operations: an unreadable record yields null failures, never zero");

    // The write side matters as much as the read side. One unknown column rejects a whole row in
    // PostgREST, so on a database without 0052 the latency field would have silently stopped ALL
    // usage logging - the exact opposite of what the new page needs.
    const clientSrc = readFileSync(join(ROOT, "src", "lib", "ai", "client.ts"), "utf8");
    assert(/42703/.test(clientSrc) && /withoutLatency/.test(clientSrc),
      "ai operations: the usage insert drops the duration and retries, so counts survive a pre-0052 database");
    assert(/latency_ms: typeof r\.latencyMs === "number"/.test(clientSrc),
      "ai operations: a duration is recorded only when it was actually measured");
  }

  /* ------------------------------------------------------------------ */
  /* NETWORK ANALYTICS                                                   */
  /* ------------------------------------------------------------------ */
  section("3. Network analytics: counts only, and absences kept apart");
  {
    const now = Date.parse("2026-11-13T12:00:00.000Z");
    const report = buildAnalyticsReport({
      now,
      members: [
        { user_id: "a", created_at: "2026-11-12T10:00:00.000Z", last_active_at: "2026-11-13T09:00:00.000Z", role: "owner", status: "active", presence: { state: "online" } },
        { user_id: "b", created_at: "2026-10-01T10:00:00.000Z", last_active_at: null, role: "user", status: "active", presence: { state: "offline" } },
        { user_id: "c", created_at: "2026-11-01T10:00:00.000Z", last_active_at: "2026-11-13T08:00:00.000Z", role: "tester" },
      ],
      invitations: [
        { status: "accepted", created_at: "2026-11-01T10:00:00.000Z", accepted_at: "2026-11-02T10:00:00.000Z" },
        { status: "pending", created_at: "2026-11-05T10:00:00.000Z" },
      ],
    });

    assert(report.reading === "read" && report.totals.members === 3, "analytics: every member is counted once");
    assert(report.totals.joinedLast7 === 1, "analytics: joins in the last seven days come from the join date");
    assert(report.totals.joinedLast30 === 2, "analytics: joins in the last thirty days come from the join date");
    assert(report.totals.neverActive === 1, "analytics: a member with no recorded activity is counted as such, not as active");
    assert(report.totals.recordedActivityLast7 === 2,
      "analytics: recent activity counts members, and the member with no record is excluded");
    assert(report.invitations.issued === 2 && report.invitations.accepted === 1 && report.invitations.pending === 1,
      "analytics: the invitation funnel is counted from stored statuses");
    assert(report.invitations.acceptancePercent === 50, "analytics: the acceptance rate is accepted over issued");
    assert(report.weekly.length === 8, "analytics: eight weekly buckets, so a quiet week is a real zero");
    assert(report.weekly.reduce((sum, w) => sum + w.joins, 0) === 3,
      "analytics: every join inside the charted window lands in exactly one weekly bucket");
    assert(report.byRole.length === 3 && report.byCondition.length === 2,
      "analytics: roles and account conditions are grouped, not listed per member");
    assert(report.notRecorded.length === 3 &&
      report.notRecorded.every((row) => row.detail.length > 20),
      "analytics: what Sophira does not record is stated, with a reason");

    const noInvites = buildAnalyticsReport({ now, members: [{ user_id: "a" }], invitations: [] });
    assert(noInvites.invitations.acceptancePercent === null,
      "analytics: no invitations means no rate to report - not 0% and not 100%");
    assert(formatPercent(null) === "Not available" && formatPercent(50) === "50%",
      "analytics: a missing percentage reads as not available");

    const unreadable = buildAnalyticsReport({ members: null, invitations: null });
    assert(unreadable.reading === "unavailable" && unreadable.totals.members === 0,
      "analytics: an unreadable directory is unavailable, never an empty network");
    assert((unreadable.unavailableReason?.length ?? 0) > 20, "analytics: the unavailable report explains itself");
    assert(plainLabel("co_owner") === "Co-Owner" && plainLabel("revoked") === "Access revoked",
      "analytics: stored values are worded for a person, not shown as database words");
  }

  /* ------------------------------------------------------------------ */
  /* DELETE DUPLICATE EMAIL (the presentation fix)                       */
  /* ------------------------------------------------------------------ */
  section("4. Members table: the email appears exactly once");
  {
    const source = readFileSync(join(ROOT, "src", "components", "app", "MemberDirectory.tsx"), "utf8");
    assert(source.includes("{id.subtitle}"),
      "members table: the identity subtitle (which carries the email once) is rendered");
    assert(source.includes("row.emailDisplay") === false,
      "members table: the separate email line is gone, so a member never reads their address twice");
  }

  /* ------------------------------------------------------------------ */
  /* BACKUP AND RECOVERY                                                 */
  /* ------------------------------------------------------------------ */
  section("5. Backup: tooling is not a backup, and no report is not success");
  {
    const none = buildBackupReport({ raw: null });
    assert(none.reported === false && none.recoverable === false,
      "backup: with no report, nothing is called recoverable");
    assert(none.steps.length === 5, "backup: the five separate facts are always shown");
    assert(/cannot tell you/i.test(none.headline),
      "backup: the headline says Sophira cannot tell, rather than implying protection");
    assert(none.steps.find((s) => s.key === "tooling")?.state === "done",
      "backup: the tooling itself is a done step, because it ships with Sophira");
    assert(none.nextActions.length >= 2, "backup: the owner is told what to do next");

    const fresh = new Date().toISOString();
    const complete = buildBackupReport({
      raw: JSON.stringify({
        last_run_at: fresh,
        last_verified_at: fresh,
        restore_tested_at: fresh,
      }),
    });
    assert(complete.reported && complete.recoverable,
      "backup: a current, checked and rehearsed backup is the only case called recoverable");
    assert(complete.steps.every((s) => s.state === "done"), "backup: every step is done in that case");
    assert(complete.nextActions.length === 0, "backup: nothing is listed as outstanding when nothing is");

    const stale = buildBackupReport({
      raw: JSON.stringify({ last_run_at: "2026-01-01T00:00:00.000Z" }),
    });
    assert(stale.recoverable === false, "backup: an old backup is not current, whatever the report implies");
    assert(stale.steps.find((s) => s.key === "completed")?.state === "failed",
      "backup: a stale backup is reported as failed, not merely old");
    assert(/not current/i.test(stale.steps.find((s) => s.key === "completed")?.detail ?? ""),
      "backup: the wording says plainly that the backup is not current");

    const unverified = buildBackupReport({ raw: JSON.stringify({ last_run_at: fresh }) });
    assert(unverified.recoverable === false &&
      unverified.steps.find((s) => s.key === "verified")?.state === "not-done",
      "backup: a backup that was never re-checked is not trusted");

    const oldRestore = buildBackupReport({
      raw: JSON.stringify({
        last_run_at: fresh,
        last_verified_at: fresh,
        restore_tested_at: new Date(Date.now() - (RESTORE_STALE_AFTER_DAYS + 30) * 86_400_000).toISOString(),
      }),
    });
    assert(oldRestore.recoverable === false &&
      oldRestore.steps.find((s) => s.key === "restore")?.state === "blocked",
      "backup: a restore rehearsal older than the limit no longer proves recovery");

    const broken = buildBackupReport({ raw: "not json at all" });
    assert(broken.ignored.length >= 1 && broken.recoverable === false,
      "backup: a report Sophira cannot parse is refused, and said so, not trusted");

    const badDate = buildBackupReport({ raw: JSON.stringify({ last_run_at: "yesterday" }) });
    assert(badDate.ignored.some((line) => /not a date/i.test(line)),
      "backup: an unreadable date is reported as ignored rather than guessed");

    const failedRun = buildBackupReport({
      raw: JSON.stringify({ last_run_at: fresh, last_verified_at: fresh, restore_tested_at: fresh, error: "permission denied" }),
    });
    assert(failedRun.recoverable === false, "backup: a recorded failure overrides a recent date");

    assert(readBackupReport({ NODE_ENV: "test" } as NodeJS.ProcessEnv).raw === null, "backup: the reader returns no report when the variable is unset");
    assert(readBackupReport({ NODE_ENV: "test", [BACKUP_REPORT_ENV]: '{"a":1}' } as NodeJS.ProcessEnv).raw === '{"a":1}',
      "backup: the reader uses the documented variable name");
    assert(formatDay(null) === "Never recorded" && formatDay("2026-11-01T00:00:00.000Z").includes("2026"),
      "backup: a missing date reads as never recorded, and a real date is printed");
    assert(STALE_AFTER_DAYS > 0 && RESTORE_STALE_AFTER_DAYS > STALE_AFTER_DAYS,
      "backup: a restore rehearsal is allowed to be older than a backup");
  }

  /* ------------------------------------------------------------------ */
  /* DIRECTORY ROWS                                                      */
  /* ------------------------------------------------------------------ */
  section("6. Directory rows: the prefixed shape cannot turn every member anonymous");
  {
    const prefixed = normalizeDirectoryRow({
      o_user_id: "u1",
      o_display_name: "Ada",
      o_email: "ada@example.test",
      o_role: "owner",
      o_status: "active",
      o_created_at: "2026-11-01T00:00:00.000Z",
      o_presence_state: "online",
      o_presence_sessions: 2,
    });
    assert(prefixed?.user_id === "u1" && prefixed?.display_name === "Ada",
      "directory rows: the o_ prefixed columns map to a member instead of an unnamed blank");
    assert(prefixed?.presence?.state === "online" && prefixed?.presence.session_count === 2,
      "directory rows: presence is read from the prefixed columns");

    const plain = normalizeDirectoryRow({ user_id: "u2", display_name: "Grace", presence: { state: "idle" } });
    assert(plain?.user_id === "u2" && plain?.presence?.state === "idle",
      "directory rows: the older unprefixed shape still works");

    assert(normalizeDirectoryRow({ display_name: "no id" }) === null,
      "directory rows: a row with no identifier is dropped rather than given a made-up one");

    const result = normalizeDirectoryRows([
      { o_user_id: "u1", o_display_name: "Ada" },
      { o_display_name: "ghost" },
      { o_user_id: "u3", o_display_name: "Linus", unexpected_column: 1 },
    ]);
    assert(result.members.length === 2 && result.dropped === 1,
      "directory rows: the batch reports what it kept and what it had to drop");
    assert(result.unknownKeys.includes("unexpected_column"),
      "directory rows: an unexpected column is reported for diagnostics, not silently swallowed");

    const nothing = normalizeDirectoryRows(null);
    assert(nothing.members.length === 0 && nothing.dropped === 0,
      "directory rows: no rows is not the same as rows dropped");
  }

  /* ------------------------------------------------------------------ */
  /* FEATURE HEALTH                                                      */
  /* ------------------------------------------------------------------ */
  section("7. Feature health: sixteen capabilities, each with a reason");
  {
    const entries = buildFeatureCatalog(HEALTHY_INPUTS);
    assert(entries.length === 17, "feature health: the catalogue covers seventeen capabilities");
    assert(new Set(entries.map((e) => e.key)).size === entries.length, "feature health: every capability has its own key");
    assert(entries.every((e) => e.what.length > 10 && e.detail.length > 20),
      "feature health: each entry says what it is and why it is in that state");
    assert(entries.every((e) => stateLabel(e.state).length > 0 && stateExplanation(e.state).length > 20),
      "feature health: every state has a word and an explanation");
    assert(entries.every((e) => e.ownerAction === null || (e.href && e.href.startsWith("/owner"))),
      "feature health: anything needing the owner names a page to open");

    const counts = countByState(entries);
    assert(Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) === entries.length,
      "feature health: the state counts add up to the whole catalogue");

    const nothingConfigured = buildFeatureCatalog({
      aiConfigured: false,
      aiActive: false,
      localInferenceConfigured: false,
      databaseReachable: true,
      searchConfigured: false,
      googleConfigured: false,
      microsoftConfigured: false,
      canvasConfigured: false,
      emailConfigured: false,
    });
    const unconfigured = nothingConfigured.filter((e) => e.state === "not-configured");
    assert(unconfigured.length > 0, "feature health: an unconnected service reads as not set up");
    assert(unconfigured.every((e) => e.ownerAction !== null),
      "feature health: every unconnected service tells the owner what to do about it");
    assert(nothingConfigured.some((e) => e.state === "working"),
      "feature health: the built-in features still read as working when nothing outside is connected");

    const failing = buildFeatureCatalog({ ...HEALTHY_INPUTS, recentAiFailures: 4 });
    assert(failing.some((e) => e.state === "problems"),
      "feature health: a recorded failure shows as a problem, not as available");
    assert(featuresNeedingOwner(failing).length >= featuresNeedingOwner(entries).length,
      "feature health: a failure never removes an item from the owner's list");

    // The rule above is only true if the page actually hands it the failures. It did not once:
    // the catalogue could show "problems" while the page never passed the count, so this is
    // pinned from the source rather than assumed.
    const featuresPage = readFileSync(join(ROOT, "src", "app", "owner", "features", "page.tsx"), "utf8");
    assert(/recentAiFailures/.test(featuresPage) && /countAiFailures\(/.test(featuresPage),
      "feature health: the page feeds recorded AI failures in, instead of leaving the rule unused");
    assert(/loadAiUsage\(/.test(featuresPage),
      "feature health: those failures come from the same shared reader the AI page and overview use");
  }

  /* ------------------------------------------------------------------ */
  /* THE OVERVIEW'S ATTENTION LIST                                       */
  /* ------------------------------------------------------------------ */
  section("8. The overview reports the new work in the owner's words");
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

    const noBackupReport = buildActionItems({ ...base, backup: { recoverable: false, reported: false } });
    assert(noBackupReport.some((i) => i.key === "backup-unreported"),
      "overview: a missing backup report is listed as unknown, not as a failure");
    const missing = noBackupReport.find((i) => i.key === "backup-unreported");
    assert(missing?.tone === "info" && missing.href === "/owner/backup",
      "overview: the missing report points at the backup page and is not urgent");
    assert(missing?.membersAffected === false, "overview: a backup gap is marked as not affecting members today");

    const partialBackup = buildActionItems({ ...base, backup: { recoverable: false, reported: true } });
    assert(partialBackup.some((i) => i.key === "backup" && i.tone === "urgent"),
      "overview: a backup that is reported but not proven is urgent");

    const goodBackup = buildActionItems({ ...base, backup: { recoverable: true, reported: true } });
    assert(goodBackup.every((i) => i.key !== "backup" && i.key !== "backup-unreported"),
      "overview: proven backups produce no item at all");

    const aiFailing = buildActionItems({ ...base, aiFailures: 3 });
    const aiItem = aiFailing.find((i) => i.key === "ai-failures");
    assert(Boolean(aiItem) && aiItem?.href === "/owner/ai-operations",
      "overview: recorded AI failures are surfaced with a way to investigate");
    assert(aiItem?.membersAffected === true, "overview: a failing AI is marked as affecting members");

    assert(buildActionItems({ ...base, aiFailures: null }).every((i) => i.key !== "ai-failures"),
      "overview: an unreadable usage record produces no failure claim");
    assert(buildActionItems({ ...base, aiFailures: 0 }).every((i) => i.key !== "ai-failures"),
      "overview: zero failures produce no item");

    const legal = buildActionItems({ ...base, legalIncomplete: true });
    assert(legal.some((i) => i.key === "legal" && i.tone === "info"),
      "overview: template legal pages are mentioned, and are not urgent");
    assert(buildActionItems({ ...base, legalIncomplete: null }).every((i) => i.key !== "legal"),
      "overview: legal documents that could not be read produce no claim either way");
  }
}
