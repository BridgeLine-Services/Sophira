import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/Badge";
import { stateLabel, stateTone } from "@/lib/owner/feature-catalog";
import { Card, CardContent } from "@/components/ui/Card";
import { ModelCheck } from "@/components/app/ModelCheck";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { providerSetupStatus } from "@/lib/integrations/setup-status";
import { providerDiagnostics, readAiEnv, paidAllowed } from "@/lib/ai/provider";
import { capabilityOwnerState, fileCapabilities } from "@/lib/capabilities/file-capabilities";
import { probeSelfHosted } from "@/lib/media/selfhost";

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

  // 2026-11-15: what Sophira can do with a file the member brings. Both services are asked
  // (1.5s each, in parallel) so "Available" means something answered, and "Problems" means a
  // configured service did not. Nothing here costs a key: these are the owner's own services.
  const [ocrProbe, asrProbe] = await Promise.all([
    probeSelfHosted("ocr", { timeoutMs: 1500 }),
    probeSelfHosted("asr", { timeoutMs: 1500 }),
  ]);
  const fileRows = fileCapabilities(process.env, { ocr: ocrProbe, asr: asrProbe });

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
          <CardContent className="divide-y divide-line p-0">
            <div className="p-4">
              <p className="text-sm font-medium text-ink">Reading the files members bring</p>
              <p className="mt-1 text-xs text-ink-soft">
                Typed text is read here on the server with no service at all. Scans and recordings use
                the reader and transcriber you run yourself, which is why they need no key and send
                nothing to another company.
              </p>
            </div>
            {fileRows.map((row) => {
              const ownerState = capabilityOwnerState(row.state);
              return (
                <div key={row.id} className="flex items-start gap-3 p-4">
                  <span
                    aria-hidden
                    className={
                      "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full " +
                      (row.state === "local" || row.verified ? "bg-accent" : "bg-line")
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      {row.label}
                      <Badge tone={stateTone(ownerState)}>{stateLabel(ownerState)}</Badge>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-soft">{row.ownerDetail}</p>
                    {!row.verified && row.state === "available" && (
                      <p className="mt-0.5 text-xs text-ink-soft">
                        Set up, but nothing answered a check just now, so this is not claimed as working.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium text-ink">Can your own model do the work?</p>
            <p className="mt-1 mb-3 text-xs text-ink-soft">
              Reachable is not the same as capable. This asks your model four fixed questions and
              reports exactly what it got right.
            </p>
            <ModelCheck />
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
