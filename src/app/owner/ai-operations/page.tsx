import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { providerDiagnostics, readAiEnv, paidAllowed } from "@/lib/ai/provider";
import { AI_USAGE_WINDOW_DAYS, loadAiUsage } from "@/lib/owner/ai-usage";
import {
  buildAiOperationsReport,
  describeAiActivity,
  formatCount,
  formatDuration,
  formatPercent,
} from "@/lib/owner/ai-operations";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = AI_USAGE_WINDOW_DAYS;

/**
 * AI OPERATIONS (2026-11-13).
 *
 * The place that answers "is the AI working, how fast is it, and what does it cost?" with
 * recorded facts. It reads the existing provider_usage record (migration 0021, plus the duration
 * column added by 0052) through the server's own privileged client. Nothing here reads a prompt,
 * an answer or a member's work: a usage row is a provider, a model, a success flag, a duration and
 * token counts.
 *
 * Three deliberate refusals, all visible on the page:
 *   - no cost figure, because Sophira holds no invoice and will not multiply tokens by a guessed rate;
 *   - no free-tier quota, because neither provider exposes it through its API;
 *   - no "healthy" badge for a provider merely because its key exists.
 *
 * If the duration column is missing (a database that has not taken 0052), the page still reports
 * request counts and says plainly that response time is not measured yet. It never shows 0 ms.
 */
export default async function OwnerAiOperationsPage() {
  // The page is owner-gated; the read itself is shared with the overview (lib/owner/ai-usage).
  await requireOwnerPage();
  const env = readAiEnv();
  const diag = providerDiagnostics(env);

  const usage = await loadAiUsage();
  const report = buildAiOperationsReport({
    rows: usage.rows,
    unavailableReason: usage.reason ?? undefined,
    windowDays: WINDOW_DAYS,
  });

  return (
    <AppShell title="AI Operations" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">How the AI is actually doing</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              These figures come from Sophira&apos;s own record of the AI requests it has made in the
              last {WINDOW_DAYS} days. Sophira never stores what a member asked or what the AI
              answered here, so what you see is performance, not content.
            </p>
          </div>
          <Link href="/owner" className="text-sm font-medium text-accent hover:underline">Back to overview</Link>
        </div>

        <Card>
          <CardContent className="p-4">
            <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
              Active AI provider
              <Badge>{diag.activeProvider ?? "none"}</Badge>
              {diag.activeModel && <span className="text-sm font-normal text-ink-soft">{diag.activeModel}</span>}
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              {diag.activeProvider
                ? "A provider is selected, so requests are being sent to it. A key being present is not proof that it answers: the counts below are the proof, one way or the other."
                : "No outside AI provider is selected. The built-in offline help and the maths engine still work; the features that write or explain need a provider."}
            </p>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-soft">Paid AI allowed</dt>
                <dd className="text-ink">{paidAllowed(env) ? "Yes, by your configuration" : "No - zero-billing policy"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-soft">Mode</dt>
                <dd className="text-ink">{diag.configuredMode}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-soft">Monthly budget setting</dt>
                <dd className="text-ink">${env.MONTHLY_AI_BUDGET_USD}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-soft">Local AI service</dt>
                <dd className="text-ink">
                  {diag.activeProvider === "selfhost"
                    ? "Active - answers are produced on your own machine"
                    : env.LOCAL_LLM_BASE_URL
                      ? "Configured, but not the active provider right now"
                      : "Not configured"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="font-medium text-ink">What the record says</p>
            <p className="mt-1 text-sm text-ink-soft">{describeAiActivity(report)}</p>
            {report.reading === "unavailable" && (
              <p role="status" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-ink">
                {report.unavailableReason}
              </p>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Requests" value={formatCount(report.totals.requests)} note={`In the last ${WINDOW_DAYS} days`} />
              <Metric label="Successful" value={formatCount(report.totals.succeeded)} note={formatPercent(report.totals.successPercent) + " of requests"} />
              <Metric label="Failed" value={formatCount(report.totals.failed)} note="A failure is shown to the member as a plain message" />
              <Metric
                label="Average response"
                value={report.latency.averageMs === null ? "Not available" : formatDuration(report.latency.averageMs)}
                note={report.latency.measured === 0 ? "No request has been timed yet" : `${formatCount(report.latency.measured)} timed`}
              />
              <Metric
                label="Typical (median) response"
                value={report.latency.medianMs === null ? "Not available" : formatDuration(report.latency.medianMs)}
                note="Half of answers were faster than this"
              />
              <Metric
                label="Slow end (95th percentile)"
                value={report.latency.p95Ms === null ? "Not available" : formatDuration(report.latency.p95Ms)}
                note="19 answers in 20 were faster than this"
              />
              <Metric
                label="Slowest answer"
                value={report.latency.slowestMs === null ? "Not available" : formatDuration(report.latency.slowestMs)}
                note="The single worst wait recorded"
              />
              <Metric
                label="Not timed"
                value={formatCount(report.latency.unmeasured)}
                note="Requests recorded before response time was measured"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="border-b border-line p-4">
              <p className="font-medium text-ink">By provider and model</p>
              <p className="mt-1 text-xs text-ink-soft">
                A provider with failures is not a broken setting: it means a request did not come
                back. The reason for the newest failure is on the System Health page.
              </p>
            </div>
            {report.byProvider.length === 0 ? (
              <p className="p-4 text-sm text-ink-soft">
                {report.reading === "read"
                  ? "No AI request has been recorded in this period, so there is nothing to break down."
                  : "Nothing can be broken down while the record cannot be read."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-ink-soft">
                      <th className="px-4 py-2">Provider</th>
                      <th className="px-4 py-2">Model</th>
                      <th className="px-4 py-2">Requests</th>
                      <th className="px-4 py-2">Succeeded</th>
                      <th className="px-4 py-2">Failed</th>
                      <th className="px-4 py-2">Average</th>
                      <th className="px-4 py-2">Slow end</th>
                      <th className="px-4 py-2">Words in / out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byProvider.map((p) => (
                      <tr key={`${p.provider}-${p.model}`} className="border-b last:border-b-0">
                        <td className="px-4 py-2 font-medium text-ink">{p.provider}</td>
                        <td className="px-4 py-2 text-ink-soft">{p.model}</td>
                        <td className="px-4 py-2">{formatCount(p.requests)}</td>
                        <td className="px-4 py-2">{formatCount(p.succeeded)}</td>
                        <td className="px-4 py-2">{formatCount(p.failed)}</td>
                        <td className="px-4 py-2">{p.latency.averageMs === null ? "Not available" : formatDuration(p.latency.averageMs)}</td>
                        <td className="px-4 py-2">{p.latency.p95Ms === null ? "Not available" : formatDuration(p.latency.p95Ms)}</td>
                        <td className="px-4 py-2 text-ink-soft">
                          {formatCount(p.tokensIn)} / {formatCount(p.tokensOut)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardContent className="p-4">
              <p className="font-medium text-ink">What it has cost</p>
              <p className="mt-1 text-sm text-ink-soft">{report.cost.detail}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="font-medium text-ink">Free allowance left</p>
              <p className="mt-1 text-sm text-ink-soft">{report.quota.detail}</p>
            </CardContent>
          </Card>
        </div>

        {usage.note && (
          <p className="text-xs text-ink-soft" role="note">{usage.note}</p>
        )}

        <Card>
          <CardContent className="space-y-2 p-4 text-sm text-ink-soft">
            <p className="font-medium text-ink">What is and is not recorded</p>
            <p>
              Recorded: which provider answered, which model, whether it succeeded, how long it took,
              and how many words went in and came out.
            </p>
            <p>
              Not recorded: what a member asked, what the AI answered, who asked, and anything from
              their coursework or conversations. Sophira cannot show you those, by design.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink-soft">{note}</p>
    </div>
  );
}
