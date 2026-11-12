import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { noUnexpectedCharges } from "@/lib/ai/capabilities";
import { readAiEnv, paidAllowed } from "@/lib/ai/provider";
import { loadOwnerRoster } from "@/lib/owner/roster";
import { loadRoleAudit } from "@/lib/owner/role-audit";
import { SecurityHistory } from "@/components/app/SecurityHistory";

export const dynamic = "force-dynamic";

/** How many audit entries the history page asks for. More than the Members panel's handful,
 *  because this page exists to be searched. */
const HISTORY_LIMIT = 200;

/**
 * Security and Billing (2026-11-03, phase 1; history added 2026-11-13). Reads the same
 * server-side policy the providers enforce. This page reports the policy; it cannot change it,
 * so no browser interaction can switch protection off.
 *
 * The change history below is read with the signed-in staff member's own session, so the
 * database's own policy - not this page - decides who may see it.
 */
export default async function OwnerSecurityPage() {
  const { supabase } = await requireOwnerPage();
  const charges = noUnexpectedCharges(paidAllowed(readAiEnv()));
  const roster = await loadOwnerRoster(supabase);
  const names = new Map<string, string>(
    roster.members.map((m) => [m.user_id, m.display_name || m.email || "A member"]),
  );
  const audit = await loadRoleAudit(supabase, names, HISTORY_LIMIT);

  return (
    <AppShell title="Security and Billing" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Protection against surprise charges</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Sophira is built so an unattended setting cannot start costing money. This page shows
              the rule currently in force, and the changes made to people&apos;s access.
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

        <section aria-labelledby="security-history">
          <h3 id="security-history" className="mb-2 text-sm font-semibold text-ink">Changes to access</h3>
          <p className="mb-3 max-w-2xl text-sm text-ink-soft">
            Every role change Sophira has recorded, newest first, including the ones it refused.
            Search it whenever something about someone&apos;s access does not look right.
          </p>
          <SecurityHistory entries={audit.changes} available={audit.available} />
        </section>

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
