import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { requireOwnerPage } from "@/lib/owner/page-context";
import {
  buildBackupReport,
  formatDay,
  readBackupReport,
  RESTORE_STALE_AFTER_DAYS,
  STALE_AFTER_DAYS,
  type StepState,
} from "@/lib/owner/backup-status";

export const dynamic = "force-dynamic";

/**
 * BACKUP AND RECOVERY (2026-11-13).
 *
 * Answers one question in plain language: "if the database vanished tonight, could we get it
 * back?" It reads the backup REPORT this deployment was given (SOPHIRA_BACKUP_REPORT) and shows
 * the five separate facts - tooling, configured, completed, verified, rehearsed - without ever
 * merging them into a comfortable "you're fine".
 *
 * The page deliberately cannot take a backup itself: the job needs database credentials and runs
 * where they live. So it tells the owner exactly which command to run and which report lets
 * Sophira read the result, and reports "unknown" - not "protected" - until that happens.
 */
export default async function OwnerBackupPage() {
  await requireOwnerPage();
  const report = buildBackupReport(readBackupReport());
  const done = report.steps.filter((s) => s.state === "done").length;

  return (
    <AppShell
      subtitle="Backups and recovery: what is saved and when it was verified." title="Backup and recovery" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Could your network be brought back?</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              A backup is not the same as a verified backup, and a verified backup is not a tested
              restore. These five steps are kept apart on purpose, so nothing here can look safer
              than it is.
            </p>
          </div>
          <Link href="/owner" className="text-sm font-medium text-accent hover:underline">Back to overview</Link>
        </div>

        <Card>
          <CardContent className="p-4">
            <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
              {report.recoverable ? "Backups and recovery are proven" : "Not proven yet"}
              <Badge>{done} of {report.steps.length} steps done</Badge>
            </p>
            <p className="mt-1 text-sm text-ink-soft">{report.headline}</p>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-soft">Last backup</dt>
                <dd className="text-ink">{formatDay(report.lastRunAt)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-soft">Last checked</dt>
                <dd className="text-ink">{formatDay(report.lastVerifiedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-soft">Last restore rehearsal</dt>
                <dd className="text-ink">{formatDay(report.lastRestoreTestAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="divide-y divide-line p-0">
            {report.steps.map((step) => (
              <div key={step.key} className="flex items-start gap-3 p-4">
                <span aria-hidden className={"mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full " + dotFor(step.state)} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                    {step.label}
                    <Badge>{stateWord(step.state)}</Badge>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-soft">{step.detail}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {report.ignored.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="font-medium text-ink">What Sophira would not trust</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
                {report.ignored.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {report.nextActions.length > 0 ? (
          <Card>
            <CardContent className="p-4">
              <p className="font-medium text-ink">What to do next, in order</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-ink-soft">
                {report.nextActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 text-sm text-ink-soft">
              Nothing is outstanding. Keep taking backups on your usual schedule, and rehearse a
              restore again before this rehearsal is older than {RESTORE_STALE_AFTER_DAYS} days.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="space-y-3 p-4 text-sm text-ink-soft">
            <p className="font-medium text-ink">How a backup happens</p>
            <p>
              Sophira cannot copy its own database from a web page, because that would mean a web
              page holding the keys to everything. The backup runs on the machine that already has
              your database details.
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                On that machine, in the Sophira folder, type{" "}
                <code className="rounded bg-line/60 px-1 py-0.5 text-xs text-ink">npm run backup:run</code>.
                It writes a backup and a report of what it protected.
              </li>
              <li>
                Give Sophira the report by setting{" "}
                <code className="rounded bg-line/60 px-1 py-0.5 text-xs text-ink">SOPHIRA_BACKUP_REPORT</code>{" "}
                to its contents in your deployment settings, then reload this page.
              </li>
              <li>
                Rehearse a restore into an empty database, never your live one. That rehearsal is
                the only proof recovery works, and Sophira will not claim it otherwise.
              </li>
            </ol>
            <p>
              A backup older than {STALE_AFTER_DAYS} days is treated as out of date here, whatever
              the report says.
            </p>
          </CardContent>
        </Card>

        <p className="text-xs text-ink-soft">
          Deeper checks on storage, sign-in and the database live on{" "}
          <Link href="/owner/health" className="text-accent hover:underline">System Health</Link>. What
          the backup is expected to contain is listed in{" "}
          <Link href="/owner/database" className="text-accent hover:underline">Database updates</Link>.
        </p>
      </div>
    </AppShell>
  );
}

function dotFor(state: StepState): string {
  if (state === "done") return "bg-success";
  if (state === "failed") return "bg-danger";
  if (state === "blocked") return "bg-warn";
  if (state === "unknown") return "bg-line";
  return "bg-ink-soft/40";
}

function stateWord(state: StepState): string {
  const words: Record<StepState, string> = {
    done: "done",
    "not-done": "not done yet",
    failed: "failed",
    blocked: "out of date",
    unknown: "unknown",
  };
  return words[state];
}
