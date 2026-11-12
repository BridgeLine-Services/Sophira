import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { noUnexpectedCharges } from "@/lib/ai/capabilities";
import { readAiEnv, paidAllowed } from "@/lib/ai/provider";
import { loadOwnerRoster } from "@/lib/owner/roster";
import { loadAuditPage, parseAuditFilters } from "@/lib/owner/audit-page";
import { SecurityHistory } from "@/components/app/SecurityHistory";

export const dynamic = "force-dynamic";

/**
 * Security and Billing (2026-11-03, phase 1; history added 2026-11-13). Reads the same
 * server-side policy the providers enforce. This page reports the policy; it cannot change it,
 * so no browser interaction can switch protection off.
 *
 * The change history below is read with the signed-in staff member's own session, so the
 * database's own policy - not this page - decides who may see it.
 */
export default async function OwnerSecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requireOwnerPage();
  const charges = noUnexpectedCharges(paidAllowed(readAiEnv()));
  const roster = await loadOwnerRoster(supabase);
  const names = new Map<string, string>(
    roster.members.map((m) => [m.user_id, m.display_name || m.email || "A member"]),
  );
  const filters = parseAuditFilters(await searchParams);
  // ONE PAGE AT A TIME (2026-11-11): the filters and the paging are applied by the database, so
  // the browser never receives a history it has to filter itself.
  const audit = await loadAuditPage(supabase, names, filters);
  const people = roster.members
    .map((m) => ({ id: m.user_id, name: m.display_name || m.email || "A member" }))
    .sort((a, b) => a.name.localeCompare(b.name));

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
            Everything Sophira has recorded about access and invitations, newest first, including
            the actions it refused. Search it whenever something about someone&apos;s access does
            not look right.
          </p>
          <SecurityHistory result={audit} filters={filters} people={people} />
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

        <Card>
          <CardContent className="space-y-2 p-4 text-sm text-ink-soft">
            <p className="font-medium text-ink">What this history does and does not contain</p>
            <p>
              Recorded here, with who did it, who it was about, whether it worked and the moment it
              happened: role changes and the changes Sophira refused; invitations created, emailed,
              cancelled, deleted and accepted; decisions about invitation requests; access suspended
              and restored; members removed; whether a member may request invitations; and
              integrations connected or disconnected.
            </p>
            <p>
              If your database has not taken the newest update yet, only role changes appear below.
              The <Link href="/owner/database" className="text-accent hover:underline">Database updates</Link>
              {" "}page says whether anything is missing, and pressing Update database adds it without
              replacing anything.
            </p>
            <p>
              Not recorded: failed sign-in attempts. Sophira&apos;s sign-in service does not give
              the application a reliable, safe report of them, and inventing one from an ordinary
              error would be a security feature that is not true. Everything else above is the
              complete record, so an empty result really does mean nothing happened.
            </p>
            <p>
              This page is Owner-only. A Co-Owner can manage members but cannot open this page.
              Members cannot read it, and it never contains a password, a sign-in link, an
              invitation link or anyone&apos;s academic work.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
