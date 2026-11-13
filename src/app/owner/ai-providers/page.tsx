import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/Badge";
import { stateLabel, stateTone } from "@/lib/owner/feature-catalog";
import { Card, CardContent } from "@/components/ui/Card";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { providerSetupStatus } from "@/lib/integrations/setup-status";
import { providerDiagnostics, readAiEnv, paidAllowed } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

/**
 * AI Providers and Models (2026-11-03, phase 1). Reports what is configured and what is
 * actually active, using the existing diagnostics. No key, token or private URL is rendered:
 * only whether something is configured, which is all an owner needs to decide.
 */
export default async function OwnerAiProvidersPage() {
  await requireOwnerPage();
  const env = readAiEnv();
  const diag = providerDiagnostics(env);
  const setup = providerSetupStatus();
  const paid = paidAllowed(env);

  const rows = [
    {
      key: "local",
      label: "Built-in offline help",
      on: true,
      detail: "Always available. Writing and study help work without any paid service or connection.",
    },
    {
      key: "cloud",
      label: "Cloud AI provider",
      on: Boolean(diag.activeProvider),
      detail: diag.activeProvider
        ? "A provider is configured and active for richer help."
        : "Not configured. Members still have offline help; nothing else is affected.",
    },
    {
      key: "search",
      label: "Web search for research",
      on: setup.search,
      detail: setup.search
        ? "Research can look up current sources and cite them."
        : "Not configured. Research works from sources you upload or paste.",
    },
  ];

  return (
    <AppShell
      subtitle="Which AI providers are configured and available." title="AI Providers and Models" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">How Sophira is doing its thinking</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Sophira starts with help that runs on the device, then adds a cloud service only if you
              configure one. Paid usage stays switched off unless you turn it on yourself.
            </p>
          </div>
          <Link href="/owner" className="text-sm font-medium text-accent hover:underline">Back to overview</Link>
        </div>

        <Card>
          <CardContent className="divide-y divide-line p-0">
            {rows.map((row) => (
              <div key={row.key} className="flex items-start gap-3 p-4">
                {/* 2026-11-13 (Part 13): a configured provider is "Available, not verified here",
                    never "working" - nothing on this page sent it a request. Same words as
                    System Status and Feature Health. */}
                <span
                  aria-hidden
                  className={"mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full " + (row.on ? "bg-accent" : "bg-line")}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                    {row.label}
                    <Badge tone={stateTone(row.on ? "available" : "not-configured")}>
                      {stateLabel(row.on ? "available" : "not-configured")}
                    </Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">{row.detail}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium text-ink">Paid usage</p>
            <p className="mt-1 text-sm text-ink-soft">
              {paid
                ? "Allowed. You have enabled paid AI in the server settings, so charges are possible."
                : "Not allowed. Sophira refuses paid providers and unverified models before contacting them."}
            </p>
            <p className="mt-2 text-xs text-ink-soft">
              Changing this requires access to the server configuration, never a switch on this page.
              Details: <Link href="/owner/security" className="text-accent hover:underline">Security and billing</Link>.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
