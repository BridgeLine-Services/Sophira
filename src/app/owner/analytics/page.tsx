import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent } from "@/components/ui/Card";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { loadOwnerRoster } from "@/lib/owner/roster";
import { buildAnalyticsReport, formatCount, formatPercent, plainLabel } from "@/lib/owner/analytics";
import {
  formatMs,
  resolvePeriod,
  summarizeAiPeriod,
  summarizeDelivery,
  summarizePeriod,
  type Period,
} from "@/lib/owner/analytics-extended";
import { loadAiUsage } from "@/lib/owner/ai-usage";
import { loadFeatureFootprint } from "@/lib/owner/feature-footprint";

export const dynamic = "force-dynamic";

/**
 * NETWORK ANALYTICS (2026-11-13; reporting periods and AI/delivery/footprint added 2026-11-11).
 *
 * How big the network is, whether it is growing, how invitations turn into members, how the AI is
 * actually performing over the chosen period, and how much of each feature genuinely exists.
 *
 * PRIVACY: every figure is an aggregate COUNT. Nothing reads a member's assignment, essay,
 * notebook, lecture, conversation or memory. The feature footprint counts stored rows through the
 * server's privileged client precisely so the count is the whole network's - and asks for counts
 * only, never rows.
 *
 * HONESTY: what Sophira does not record is listed at the bottom rather than drawn as a zero, and
 * a count that failed is shown as unavailable, not as 0.
 */
export default async function OwnerAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { supabase } = await requireOwnerPage();
  const params = await searchParams;
  const { period, error: periodError } = resolvePeriod({ key: params.period, from: params.from, to: params.to });
  // A refused custom range falls back to 30 days for the figures, and the page says the range was
  // refused. Showing nothing at all would hide the working parts behind a typo.
  const active: Period =
    period ??
    resolvePeriod({ key: "30" }).period!;

  const roster = await loadOwnerRoster(supabase);
  const membersAvailable = !(roster.statsError && roster.members.length === 0);
  const members = membersAvailable ? roster.members : null;
  const invitations = roster.invitationsAvailable ? roster.invitations : null;

  const report = buildAnalyticsReport({
    members,
    invitations,
    unavailableReason: roster.directoryError ?? roster.statsError ?? undefined,
  });

  const periodSummary = summarizePeriod(members ?? [], invitations ?? [], active);
  const delivery = summarizeDelivery(invitations ?? []);

  const usage = await loadAiUsage({ windowDays: Math.max(active.days, 1), maxRows: 5000 });
  const ai = summarizeAiPeriod(usage.rows, active, usage.reason);
  const footprint = await loadFeatureFootprint();

  const peak = Math.max(1, ...report.weekly.map((w) => Math.max(w.joins, w.invitationsAccepted)));
  const aiPeak = Math.max(1, ...ai.days.map((d) => d.requests));
  const slowPeak = Math.max(1, ...ai.days.map((d) => d.averageMs ?? 0));

  return (
    <AppShell
      subtitle="How the network is being used over time." title="Network analytics" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">How your network is doing</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Counts taken from your member directory, your invitation list and Sophira&apos;s own
              record of AI requests. Nothing here reads a member&apos;s assignments, notes or
              conversations.
            </p>
          </div>
          <Link href="/owner" className="text-sm font-medium text-accent hover:underline">Back to overview</Link>
        </div>

        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium text-ink">Reporting period</p>
            <p className="mt-1 text-xs text-ink-soft">
              Every figure below uses this period where the record allows it. Account totals (who is
              in the network, roles, presence) are always as they are right now.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["7", "30", "90"] as const).map((key) => (
                <Link
                  key={key}
                  href={`/owner/analytics?period=${key}`}
                  aria-current={active.key === key && !active.custom ? "true" : undefined}
                  className={
                    "rounded-full border px-3 py-1.5 text-sm " +
                    (active.key === key && !active.custom
                      ? "border-accent bg-accent/10 font-medium text-ink"
                      : "border-line bg-card text-ink-soft hover:text-ink")
                  }
                >
                  Last {key} days
                </Link>
              ))}
              <span className="self-center text-sm text-ink-soft">or choose dates:</span>
              <form method="get" action="/owner/analytics" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="period" value="custom" />
                <label className="text-xs text-ink-soft">
                  From
                  <input
                    type="date"
                    name="from"
                    defaultValue={active.custom ? new Date(active.fromMs).toISOString().slice(0, 10) : ""}
                    className="mt-0.5 block rounded-card border border-line bg-card px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <label className="text-xs text-ink-soft">
                  To
                  <input
                    type="date"
                    name="to"
                    defaultValue={active.custom ? new Date(active.toMs - 86_400_000).toISOString().slice(0, 10) : ""}
                    className="mt-0.5 block rounded-card border border-line bg-card px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-card border border-line bg-card px-3 py-1.5 text-sm text-ink hover:bg-accent/5"
                >
                  Show this period
                </button>
              </form>
            </div>
            {periodError && (
              <p role="status" className="mt-2 rounded-lg border border-warn/30 bg-warn/[0.07] p-2 text-sm text-ink">
                {periodError} The figures below use the last 30 days.
              </p>
            )}
            <p className="mt-2 text-sm text-ink-soft">Showing: <span className="font-medium text-ink">{active.label}</span>.</p>
          </CardContent>
        </Card>

        {report.reading === "unavailable" && (
          <div role="status" className="rounded-card border border-warn/30 bg-warn/[0.07] p-3 text-sm text-ink">
            {report.unavailableReason}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Members" value={formatCount(report.totals.members)} note="Everyone in your directory" />
          <Metric label="Joined in this period" value={formatCount(periodSummary.newMembers)} note={active.label} />
          <Metric
            label="Active in this period"
            value={formatCount(periodSummary.activeMembers)}
            note="Members with a recorded activity, not sign-ins"
          />
          <Metric
            label="Invitations accepted"
            value={formatCount(periodSummary.invitationsAccepted)}
            note={
              periodSummary.acceptancePercent === null
                ? "No invitation was issued in this period"
                : `${formatPercent(periodSummary.acceptancePercent)} of those issued in this period`
            }
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
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-soft">
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
              <p className="font-medium text-ink">Invitations in this period</p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <Fact label="Issued" value={formatCount(periodSummary.invitationsIssued)} />
                <Fact label="Accepted" value={formatCount(periodSummary.invitationsAccepted)} />
                <Fact label="Revoked" value={formatCount(periodSummary.invitationsRevoked)} />
                <Fact label="Waiting now" value={formatCount(periodSummary.invitationsPendingNow)} />
              </dl>
              <p className="mt-3 text-sm text-ink-soft">
                {periodSummary.acceptancePercent === null
                  ? "No invitation was issued in this period, so there is no acceptance rate to report - that is not 0%."
                  : `${formatPercent(periodSummary.acceptancePercent)} of the invitations issued in this period were accepted.`}
              </p>
              <p className="mt-2 text-sm text-ink-soft">
                &quot;Waiting now&quot; is the current backlog whatever its age; it is not limited to the
                period you chose.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <p className="font-medium text-ink">Who is in the network</p>
              <p className="mt-1 text-xs text-ink-soft">Roles and account conditions, as recorded now.</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <CountTable title="By role" rows={report.byRole.map((r) => ({ label: plainLabel(r.role), count: r.count }))} />
                <CountTable title="By account" rows={report.byCondition.map((r) => ({ label: plainLabel(r.condition), count: r.count }))} />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-4">
            <p className="font-medium text-ink">The AI, over this period</p>
            <p className="mt-1 text-xs text-ink-soft">
              From Sophira&apos;s own request record. It stores a provider, a model, whether the request
              worked, how long it took and token counts. It never stores what a member asked or what
              the AI answered.
            </p>

            {ai.reading === "unavailable" ? (
              <p role="status" className="mt-3 rounded-lg border border-warn/30 bg-warn/[0.07] p-2 text-sm text-ink">
                {ai.reason}
              </p>
            ) : (
              <>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Fact label="Requests" value={formatCount(ai.requests)} />
                  <Fact label="Successful" value={formatCount(ai.succeeded)} />
                  <Fact label="Failed" value={formatCount(ai.failed)} />
                  <Fact
                    label="Success rate"
                    value={ai.successPercent === null ? "Not available" : formatPercent(ai.successPercent)}
                  />
                </div>

                {ai.days.length === 0 ? (
                  <p className="mt-3 text-sm text-ink-soft">
                    No AI request was recorded in this period. That is a real zero: the record was read
                    successfully and contained nothing for these dates.
                  </p>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink-soft">Requests per day</p>
                      <div className="mt-2 flex items-end gap-1 overflow-x-auto" role="img" aria-label="AI requests per day in the chosen period">
                        {ai.days.map((day) => (
                          <div key={day.day} className="flex min-w-[18px] flex-1 flex-col items-center gap-1">
                            <div className="flex h-24 w-full items-end justify-center">
                              <span
                                className={"w-2.5 rounded-t " + (day.failed > 0 ? "bg-danger/80" : "bg-accent/80")}
                                style={{ height: `${Math.max(2, (day.requests / aiPeak) * 100)}%` }}
                                title={`${day.day}: ${day.requests} requests, ${day.failed} failed`}
                              />
                            </div>
                            <span className="text-[10px] text-ink-soft">{day.day.slice(5)}</span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-ink-soft">A red bar marks a day with at least one failed request.</p>
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink-soft">Response time</p>
                      {ai.timed ? (
                        <>
                          <div className="mt-2 flex items-end gap-1 overflow-x-auto" role="img" aria-label="Average AI response time per day">
                            {ai.days.map((day) => (
                              <div key={day.day} className="flex min-w-[18px] flex-1 flex-col items-center gap-1">
                                <div className="flex h-20 w-full items-end justify-center">
                                  <span
                                    className="w-2.5 rounded-t bg-ink-soft/60"
                                    style={{ height: `${Math.max(2, ((day.averageMs ?? 0) / slowPeak) * 100)}%` }}
                                    title={`${day.day}: ${day.averageMs === null ? "not timed" : formatMs(day.averageMs)}`}
                                  />
                                </div>
                                <span className="text-[10px] text-ink-soft">{day.day.slice(5)}</span>
                              </div>
                            ))}
                          </div>
                          <p className="mt-1 text-xs text-ink-soft">
                            A day with no bar has no timed request; it is not a fast day.
                          </p>
                        </>
                      ) : (
                        <p className="mt-1 text-sm text-ink-soft">
                          No request in this period carried a duration, so there is no response-time trend
                          to show. Sophira will not draw a 0 ms line for a measurement it does not have.
                        </p>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="data-table w-full min-w-[420px] text-sm">
                        <caption className="sr-only">AI activity per day, as a table</caption>
                        <thead>
                          <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-soft">
                            <th scope="col" className="px-3 py-2">Day</th>
                            <th scope="col" className="px-3 py-2">Requests</th>
                            <th scope="col" className="px-3 py-2">Failed</th>
                            <th scope="col" className="px-3 py-2">Average time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ai.days.map((day) => (
                            <tr key={day.day} className="border-b last:border-b-0">
                              <td className="px-3 py-2 text-ink-soft">{day.day}</td>
                              <td className="px-3 py-2">{day.requests}</td>
                              <td className="px-3 py-2">{day.failed}</td>
                              <td className="px-3 py-2">{day.averageMs === null ? "Not available" : formatMs(day.averageMs)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink-soft">By provider</p>
                      {ai.byProvider.length === 0 ? (
                        <p className="mt-1 text-sm text-ink-soft">No provider is recorded for this period.</p>
                      ) : (
                        <ul className="mt-1 space-y-1 text-sm">
                          {ai.byProvider.map((row) => (
                            <li key={row.provider} className="flex items-baseline justify-between gap-3">
                              <span className="text-ink-soft">{row.provider}</span>
                              <span className="font-medium text-ink">
                                {row.requests} {row.requests === 1 ? "request" : "requests"}
                                {row.failed > 0 ? `, ${row.failed} failed` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <p className="text-xs text-ink-soft">
                      Tokens recorded: {ai.tokens.in === null && ai.tokens.out === null
                        ? "not available for this period"
                        : `${formatCount(ai.tokens.in)} in, ${formatCount(ai.tokens.out)} out`}.
                      Cost is not shown: Sophira holds no invoice and will not multiply tokens by a
                      guessed rate.
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="font-medium text-ink">Invitation delivery</p>
            <p className="mt-1 text-xs text-ink-soft">
              What happened when Sophira tried to send each invitation. An invitation you created by
              copying a link has no delivery result, and is counted as unrecorded rather than failed.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Fact label="Sent" value={formatCount(delivery.sent)} />
              <Fact label="Failed" value={formatCount(delivery.failed)} />
              <Fact label="No mail service set up" value={formatCount(delivery.notConfigured)} />
              <Fact label="Unrecorded or copied link" value={formatCount(delivery.unrecorded)} />
            </div>
            <p className="mt-3 text-sm text-ink-soft">
              {delivery.deliveryRatePercent === null
                ? "No invitation carries a delivery result yet, so there is no delivery rate to report - that is not 0%."
                : `${formatPercent(delivery.deliveryRatePercent)} of the invitations Sophira tried to send were reported sent.`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="font-medium text-ink">How much each feature holds</p>
            <p className="mt-1 text-xs text-ink-soft">
              These are counts of stored records in your network. They are not a count of people and
              they are not a per-member history: Sophira does not track what an individual member
              studies.
            </p>
            {footprint.reason && (
              <p role="status" className="mt-3 rounded-lg border border-warn/30 bg-warn/[0.07] p-2 text-sm text-ink">
                {footprint.reason}
              </p>
            )}
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {footprint.entries.map((entry) => (
                <li key={entry.key} className="rounded-card border border-line bg-card p-3">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">{entry.label}</span>
                    <span className="text-lg font-semibold text-ink">
                      {entry.count === null ? "—" : entry.count.toLocaleString("en-US")}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">{entry.detail}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="font-medium text-ink">At their screen right now</p>
            <p className="mt-1 text-xs text-ink-soft">
              Presence is reported by the member&apos;s own signed-in session, not guessed from a
              last-seen date. It is a moment in time, so it is not affected by the reporting period.
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
              <li>
                <span className="font-medium text-ink">Offline synchronisation failures:</span> offline
                work is retried on the member&apos;s own device, and no failure is reported to the
                server, so there is no count to show.
              </li>
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
      <dt className="text-xs uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

function CountTable({ title, rows }: { title: string; rows: Array<{ label: string; count: number }> }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-ink-soft">{title}</p>
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
