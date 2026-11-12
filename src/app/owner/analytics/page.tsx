import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent } from "@/components/ui/Card";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { loadOwnerRoster } from "@/lib/owner/roster";
import {
  buildAnalyticsReport,
  formatCount,
  formatPercent,
  plainLabel,
} from "@/lib/owner/analytics";

export const dynamic = "force-dynamic";

/**
 * NETWORK ANALYTICS (2026-11-13).
 *
 * How big the network is, whether it is growing, and how invitations turn into members. Every
 * figure is a COUNT over the member directory and the invitation list - the same two reads the
 * Members page already makes - so this page adds no query and no new source of truth.
 *
 * PRIVACY: no member's coursework is read, and no per-member figure is shown. There is no usage
 * tracking here and none is invented: what Sophira does not record is listed at the bottom rather
 * than drawn as a zero.
 */
export default async function OwnerAnalyticsPage() {
  const { supabase } = await requireOwnerPage();
  const roster = await loadOwnerRoster(supabase);

  const report = buildAnalyticsReport({
    members: roster.statsError && roster.members.length === 0 ? null : roster.members,
    invitations: roster.invitationsAvailable ? roster.invitations : null,
    unavailableReason: roster.directoryError ?? roster.statsError ?? undefined,
  });

  const peak = Math.max(1, ...report.weekly.map((w) => Math.max(w.joins, w.invitationsAccepted)));

  return (
    <AppShell title="Network analytics" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">How your network is growing</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Counts taken from your member directory and your invitation list when you opened this
              page. Nothing here reads a member&apos;s assignments, notes or conversations.
            </p>
          </div>
          <Link href="/owner" className="text-sm font-medium text-accent hover:underline">Back to overview</Link>
        </div>

        {report.reading === "unavailable" && (
          <div role="status" className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm text-ink">
            {report.unavailableReason}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Members" value={formatCount(report.totals.members)} note="Everyone in your directory" />
          <Metric label="Joined in the last 7 days" value={formatCount(report.totals.joinedLast7)} note="From their join date" />
          <Metric label="Joined in the last 30 days" value={formatCount(report.totals.joinedLast30)} note="From their join date" />
          <Metric
            label="Active in the last 7 days"
            value={formatCount(report.totals.recordedActivityLast7)}
            note="Members with a recorded activity, not sign-ins"
          />
        </div>

        <Card>
          <CardContent className="p-4">
            <p className="font-medium text-ink">Joins and accepted invitations, week by week</p>
            <p className="mt-1 text-xs text-ink-soft">
              The last eight weeks, oldest first. A week with nothing recorded is a real zero, not a
              gap in the record.
            </p>
            {report.weekly.length === 0 ? (
              <p className="mt-3 text-sm text-ink-soft">There is no week to chart while the directory cannot be read.</p>
            ) : (
              <div className="mt-4">
                <div className="flex items-end gap-2" role="img" aria-label={`Weekly joins and accepted invitations for the last ${report.weekly.length} weeks`}>
                  {report.weekly.map((week) => (
                    <div key={week.weekStart} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      <div className="flex h-32 w-full items-end justify-center gap-1">
                        <span
                          className="w-2.5 rounded-t bg-accent/80"
                          style={{ height: `${Math.max(2, (week.joins / peak) * 100)}%` }}
                          title={`${week.joins} joined`}
                        />
                        <span
                          className="w-2.5 rounded-t bg-ink-soft/50"
                          style={{ height: `${Math.max(2, (week.invitationsAccepted / peak) * 100)}%` }}
                          title={`${week.invitationsAccepted} invitations accepted`}
                        />
                      </div>
                      <span className="text-[10px] text-ink-soft">{week.weekStart.slice(5)}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 flex flex-wrap gap-4 text-xs text-ink-soft">
                  <span className="flex items-center gap-1"><span aria-hidden className="h-2 w-2 rounded-sm bg-accent/80" /> joined</span>
                  <span className="flex items-center gap-1"><span aria-hidden className="h-2 w-2 rounded-sm bg-ink-soft/50" /> invitations accepted</span>
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="data-table w-full min-w-[420px] text-sm">
                    <caption className="sr-only">The same weekly figures as a table</caption>
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="px-3 py-2">Week starting</th>
                        <th scope="col" className="px-3 py-2">Joined</th>
                        <th scope="col" className="px-3 py-2">Invitations accepted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.weekly.map((week) => (
                        <tr key={week.weekStart} className="border-b last:border-b-0">
                          <td className="px-3 py-2 text-ink-soft">{week.weekStart}</td>
                          <td className="px-3 py-2">{week.joins}</td>
                          <td className="px-3 py-2">{week.invitationsAccepted}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardContent className="p-4">
              <p className="font-medium text-ink">Invitations</p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <Fact label="Issued" value={formatCount(report.invitations.issued)} />
                <Fact label="Accepted" value={formatCount(report.invitations.accepted)} />
                <Fact label="Waiting" value={formatCount(report.invitations.pending)} />
                <Fact label="Revoked" value={formatCount(report.invitations.revoked)} />
              </dl>
              <p className="mt-3 text-sm text-ink-soft">
                {report.invitations.acceptancePercent === null
                  ? "No invitation has been issued yet, so there is no acceptance rate to report - that is not 0%."
                  : `${formatPercent(report.invitations.acceptancePercent)} of the invitations you issued were accepted.`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <p className="font-medium text-ink">Who is in the network</p>
              <p className="mt-1 text-xs text-ink-soft">Roles and account conditions, as recorded.</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <CountTable title="By role" rows={report.byRole.map((r) => ({ label: plainLabel(r.role), count: r.count }))} />
                <CountTable title="By account" rows={report.byCondition.map((r) => ({ label: plainLabel(r.condition), count: r.count }))} />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-4">
            <p className="font-medium text-ink">At their screen right now</p>
            <p className="mt-1 text-xs text-ink-soft">
              Presence is reported by the member&apos;s own signed-in session, not guessed from a
              last-seen date.
            </p>
            {report.presenceNow.length === 0 ? (
              <p className="mt-2 text-sm text-ink-soft">No presence information could be read.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                {report.presenceNow.map((row) => (
                  <li key={row.state} className="rounded-full border border-line bg-card px-2.5 py-1">
                    <span className="text-ink">{plainLabel(row.state)}</span>
                    <span className="ml-1.5 font-semibold text-ink">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="font-medium text-ink">What this page does not measure, and why</p>
            <ul className="mt-2 space-y-2 text-sm text-ink-soft">
              {report.notRecorded.map((row) => (
                <li key={row.key}>
                  <span className="font-medium text-ink">{row.label}:</span> {row.detail}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <p className="text-xs text-ink-soft">
          {formatCount(report.totals.neverActive)} members have never had an activity recorded. For
          the member list itself, open <Link href="/owner/members" className="text-accent hover:underline">Members</Link>.
        </p>
      </div>
    </AppShell>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-ink-soft">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
        <p className="mt-1 text-xs text-ink-soft">{note}</p>
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

function CountTable({ title, rows }: { title: string; rows: Array<{ label: string; count: number }> }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-ink-soft">Nothing to show.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.label} className="flex items-baseline justify-between gap-3">
              <span className="text-ink-soft">{row.label}</span>
              <span className="font-medium text-ink">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
