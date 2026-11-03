import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { noUnexpectedCharges } from "@/lib/ai/capabilities";
import { readAiEnv, paidAllowed } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

/**
 * Security and Billing (2026-11-03, phase 1). Reads the same server-side policy the providers
 * enforce. This page reports the policy; it cannot change it, so no browser interaction can
 * switch protection off.
 */
export default async function OwnerSecurityPage() {
  await requireOwnerPage();
  const charges = noUnexpectedCharges(paidAllowed(readAiEnv()));

  return (
    <AppShell title="Security and Billing" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Protection against surprise charges</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Sophira is built so an unattended setting cannot start costing money. This page shows
              the rule currently in force.
            </p>
          </div>
          <Link href="/owner" className="text-sm font-medium text-accent hover:underline">Back to overview</Link>
        </div>

        <Card>
          <CardContent className="p-4">
            <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
              No unexpected charges
              <Badge>{charges.enabled ? "on" : "off"}</Badge>
            </p>
            <p className="mt-1 text-sm text-ink-soft">{charges.detail}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 p-4 text-sm text-ink-soft">
            <p className="font-medium text-ink">What protects your members</p>
            <p>
              Every protected action checks who is asking on the server before it runs. Hiding a
              button is never the protection.
            </p>
            <p>
              Members can read their own academic work. They cannot read each other&apos;s, and you
              cannot read theirs either: you manage membership, not their essays.
            </p>
            <p>
              Access you revoke takes effect on the server, not just in the interface.
            </p>
            <p>
              Deeper verification lives on <Link href="/owner/health" className="text-accent hover:underline">System Health</Link>.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
