import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { scanMigrations } from "@/lib/db-ddl";
import { buildBackupReport, readBackupReport } from "@/lib/owner/backup-status";
import { legalPlaceholdersRemain, loadLegalDoc } from "@/lib/legal";
import { readReleaseReport } from "@/lib/owner/release-report";
import {
  buildReadinessReport,
  type FactState,
  type ReadinessFact,
  type ReadinessSection,
} from "@/lib/owner/release-readiness";

export const dynamic = "force-dynamic";

/**
 * RELEASE READINESS (2026-11-11).
 *
 * One page that answers "is the app ready to go out, and what is missing?" by arranging the
 * results of the release gate that already exists - it does not run its own checks and it does
 * not add a second gate. The report is the machine-readable file the gate writes
 * (docs/release-gate-report.json); an env override exists so a scheduler can hand a fresh report
 * to a deployment without a rebuild.
 *
 * Deliberate refusals, all visible on the page:
 *   - no stored report means UNKNOWN, never READY;
 *   - a blocked or unrun check is never drawn as a pass;
 *   - a report older than a week is shown but not called current;
 *   - no deploy or rollback buttons: those need safeguards that do not exist here.
 */
const STATE_LABEL: Record<FactState, string> = {
  ready: "in place",
  "not-ready": "failed",
  blocked: "not proved",
  unknown: "unknown",
};

const STATE_DOT: Record<FactState, string> = {
  ready: "bg-success",
  "not-ready": "bg-danger",
  blocked: "bg-warn",
  unknown: "bg-line",
};

function Fact({ fact }: { fact: ReadinessFact }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${STATE_DOT[fact.state]}`} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
          <span className="min-w-0 break-words">{fact.label}</span>
          <Badge>{STATE_LABEL[fact.state]}</Badge>
        </p>
        <p className="mt-0.5 text-sm text-ink-soft">{fact.detail}</p>
        {fact.action && (
          <p className="mt-1 text-sm text-ink-soft">
            <span className="font-medium text-ink">What to do: </span>
            {fact.action}
            {fact.href && (
              <>
                {" "}
                <Link href={fact.href} className="font-medium text-accent hover:underline">
                  Open the page
                </Link>
              </>
            )}
          </p>
        )}
      </div>
    </li>
  );
}

function Section({ section }: { section: ReadinessSection }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold text-ink">{section.title}</h3>
        <p className="mt-1 text-xs text-ink-soft">{section.intro}</p>
        {section.facts.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">There is nothing to report in this part yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {section.facts.map((fact) => (
              <Fact key={fact.key} fact={fact} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default async function OwnerReleaseReadinessPage() {
  await requireOwnerPage();

  const { text: gateReportText, source } = readReleaseReport();
  const scan = await scanMigrations();
  const backup = buildBackupReport(readBackupReport());
  const terms = loadLegalDoc("TERMS_OF_SERVICE");
  const privacy = loadLegalDoc("PRIVACY_POLICY");
  const legalIncomplete =
    terms === null && privacy === null
      ? null
      : Boolean((terms && legalPlaceholdersRemain(terms)) || (privacy && legalPlaceholdersRemain(privacy)));

  const report = buildReadinessReport({
    gateReportText,
    deployment: {
      environment: (process.env.VERCEL_ENV ?? "").trim() || (process.env.NODE_ENV === "production" ? "production" : null),
      commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim().slice(0, 12) || null,
      url: (process.env.SOPHIRA_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").trim() || null,
    },
    database: scan
      ? { reachable: scan.reachable, applied: scan.applied, pending: scan.pending.length }
      : null,
    backup: {
      reported: backup.reported,
      recoverable: backup.recoverable,
      lastRunAt: backup.lastRunAt,
      lastVerifiedAt: backup.lastVerifiedAt,
      lastRestoreTestAt: backup.lastRestoreTestAt,
    },
    legalIncomplete,
  });

  const verdictTone =
    report.verdict === "READY"
      ? "border-success/30 bg-success/[0.07]"
      : report.verdict === "NOT READY"
        ? "border border-danger/30 bg-danger/[0.06]"
        : "border border-warn/30 bg-warn/[0.07]";

  return (
    <AppShell
      subtitle="Checks that must pass before a release goes out." title="Release readiness" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Is Sophira ready to go out?</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              This page collects the results of the release checks that Sophira already runs, and adds
              what those checks cannot see: your database, your backups and your legal pages. It never
              marks something as passed because it was not checked.
            </p>
          </div>
          <Link href="/owner" className="text-sm font-medium text-accent hover:underline">Back to overview</Link>
        </div>

        <div role="status" className={`rounded-card border p-4 ${verdictTone}`}>
          <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
            {report.verdict === "READY"
              ? "Ready"
              : report.verdict === "NOT READY"
                ? "Not ready"
                : report.verdict === "BLOCKED"
                  ? "Blocked - something has not been proved"
                  : "Unknown - no result to show"}
          </p>
          <p className="mt-1 text-sm text-ink-soft">{report.summary}</p>
          {report.gate && (
            <p className="mt-2 text-xs text-ink-soft">
              Release report {source}
              {report.gate.generatedAt ? `, run ${report.gate.generatedAt.slice(0, 16).replace("T", " ")} UTC` : " (undated)"}
              {report.gate.ageDays !== null ? ` (${report.gate.ageDays} day${report.gate.ageDays === 1 ? "" : "s"} old)` : ""}.
              {" "}
              {report.gate.counts.pass} passed, {report.gate.counts.fail} failed, {report.gate.counts.blocked} waiting,{" "}
              {report.gate.counts.notRun} not run.
            </p>
          )}
          {!report.gate && report.gateUnavailableReason && (
            <p className="mt-2 text-xs text-ink-soft">{report.gateUnavailableReason}</p>
          )}
        </div>

        {report.missing.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm font-semibold text-ink">What is still outstanding</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
                {report.missing.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          {report.sections.map((section) => (
            <Section key={section.key} section={section} />
          ))}
        </div>

        <p className="text-xs text-ink-soft">
          Technical detail lives on{" "}
          <Link href="/owner/health" className="text-accent hover:underline">System Health</Link>, and the checks
          themselves are run by the project&apos;s release process. This page cannot deploy or roll back:
          those actions need safeguards that Sophira does not claim to have.
        </p>
      </div>
    </AppShell>
  );
}
