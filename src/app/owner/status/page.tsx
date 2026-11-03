import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { loadOwnerRoster } from "@/lib/owner/roster";
import { buildStatusRows, statusIsHealthy } from "@/lib/owner-status";
import { providerSetupStatus } from "@/lib/integrations/setup-status";
import { providerDiagnostics, readAiEnv } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

/**
 * System Status (2026-11-03, phase 1). Each row is a real configuration or a real request
 * outcome. An optional service that is off is labelled as such and never counted as a failure.
 */
export default async function OwnerStatusPage() {
  const { supabase } = await requireOwnerPage();
  const { statsError } = await loadOwnerRoster(supabase);
  const setup = providerSetupStatus();
  const diag = providerDiagnostics(readAiEnv());
  const rows = buildStatusRows({
    aiReady: Boolean(diag.activeProvider),
    microsoft: setup.microsoft,
    google: setup.google,
    search: setup.search,
    membersLoaded: !statsError,
  });

  return (
    <AppShell title="System Status" variant="owner">
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
                  className={"mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full " + (row.state === "ready" ? "bg-emerald-500" : row.state === "attention" ? "bg-amber-400" : "bg-line")}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                    {row.label}
                    <Badge>{row.state === "ready" ? "working" : row.state === "attention" ? "needs attention" : "not set up"}</Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">{row.detail}</p>
                </div>
              </div>
            ))}
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
