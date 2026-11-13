import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { canReadDirectory } from "@/lib/owner/roster";
import { buildStatusRows, statusIsHealthy } from "@/lib/owner-status";
import { providerSetupStatus } from "@/lib/integrations/setup-status";
import { stateExplanation, stateLabel, stateTone } from "@/lib/owner/feature-catalog";
import { providerDiagnostics, readAiEnv } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

/**
 * System Status (2026-11-03, phase 1). Each row is a real configuration or a real request
 * outcome. An optional service that is off is labelled as such and never counted as a failure.
 *
 * 2026-11-13 (Part 13): this page used to invent its own three words ("working", "not set up",
 * "needs attention") while Feature Health used six. The owner had to translate between two
 * pages describing the same service. Both now read from ONE vocabulary, and the page shows the
 * legend so a state is never a bare colour.
 */
export default async function OwnerStatusPage() {
  const { supabase } = await requireOwnerPage();
  // 2026-11-12 (consolidation): this page needs ONE fact - whether the directory is
  // readable - so it asks for that, instead of loading the whole roster (three reads).
  const membersLoaded = await canReadDirectory(supabase);
  const setup = providerSetupStatus();
  const diag = providerDiagnostics(readAiEnv());
  const rows = buildStatusRows({
    aiReady: Boolean(diag.activeProvider),
    microsoft: setup.microsoft,
    google: setup.google,
    search: setup.search,
    email: setup.email,
    membersLoaded,
  });

  // Only the states this page can actually show, in the shared order, each explained once.
  const legend = [...new Set(rows.map((r) => r.stage))];

  return (
    <AppShell
      subtitle="The current state of each part of the system." title="System Status" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">What is working right now</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              This page checks each part of Sophira when you open it. &quot;Not set up&quot; means an
              optional extra you have not connected; it does not affect your members.
            </p>
          </div>
          <Link href="/owner" className="text-sm font-medium text-accent hover:underline">Back to overview</Link>
        </div>

        <Card>
          <CardContent className="divide-y divide-line p-0">
            {rows.map((row) => (
              <div key={row.key} className="flex items-start gap-3 p-4">
                <span
                  aria-hidden
                  className={
                    "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full " +
                    (row.stage === "working" ? "bg-success"
                      : row.stage === "available" ? "bg-accent"
                        : row.stage === "problems" ? "bg-warn"
                          : row.stage === "unavailable" ? "bg-danger"
                            : "bg-line")
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                    {row.label}
                    <Badge tone={stateTone(row.stage)}>{stateLabel(row.stage)}</Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">{row.detail}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* The legend. Same words as Feature Health, so one page never contradicts the other. */}
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-ink">What these words mean</h3>
            <dl className="mt-2 space-y-1.5">
              {legend.map((stage) => (
                <div key={stage} className="flex flex-wrap gap-x-2 text-xs">
                  <dt className="font-medium text-ink">{stateLabel(stage)}</dt>
                  <dd className="min-w-0 flex-1 text-ink-soft">{stateExplanation(stage)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <p className="text-xs text-ink-soft">
          {statusIsHealthy(rows)
            ? "Everything your members need is working."
            : "The items marked “needs attention” affect members. The optional extras do not."}
        </p>
        <p className="text-xs text-ink-soft">
          For deeper technical checks, open <Link href="/owner/health" className="text-accent hover:underline">System Health</Link>.
        </p>
      </div>
    </AppShell>
  );
}
