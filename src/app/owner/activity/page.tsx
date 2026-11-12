import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent } from "@/components/ui/Card";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { loadOwnerRoster } from "@/lib/owner/roster";
import { loadAuditPage, parseAuditFilters } from "@/lib/owner/audit-page";
import { SecurityHistory } from "@/components/app/SecurityHistory";

export const dynamic = "force-dynamic";

/**
 * STAFF ACTIVITY (2026-11-12, phase 2 of the engineering directive).
 *
 * This page used to derive a feed from stored timestamps (when a member was created, when an
 * invitation was accepted). That shows DATES, not ACTIONS: it could not tell a refused role
 * change from a quiet week, and it silently omitted everything the audit system records.
 *
 * It now reads the same authoritative administrative history as the security page, through
 * the same server-side reader (loadAuditPage): membership_audit, written only by the closed
 * set of SECURITY DEFINER functions in migrations 0048 and 0053. Filtering, search and
 * pagination all happen in the database, and a refused action is a record rather than a gap.
 *
 * Nothing here exposes member coursework, notes, answers, tokens or documents - the audit
 * vocabulary cannot contain them.
 */
export default async function OwnerActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requireOwnerPage();
  const roster = await loadOwnerRoster(supabase);
  const names = new Map<string, string>(
    roster.members.map((m) => [m.user_id, m.display_name || m.email || "A member"]),
  );
  const people = roster.members.map((m) => ({
    id: m.user_id,
    name: m.display_name || m.email || "A member",
  }));
  const filters = parseAuditFilters(await searchParams);
  const result = await loadAuditPage(supabase, names, filters);

  return (
    <AppShell
      subtitle="What has happened across the network, newest first." title="Recent Activity" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">What staff have done in your network</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Every administrative action Sophira recorded, newest first: people joining,
              invitations sent and accepted, roles changed, access suspended or restored, and the
              actions it refused. Search it, filter it, and page through it. This is the same
              record the Security page keeps - not a second copy.
            </p>
          </div>
          <Link href="/owner" className="text-sm font-medium text-accent hover:underline">Back to overview</Link>
        </div>

        <SecurityHistory result={result} filters={filters} people={people} />

        <Card>
          <CardContent className="p-4">
            <p className="font-medium text-ink">What this history never contains</p>
            <p className="mt-1 text-sm text-ink-soft">
              Passwords, invitation links, uploaded documents, assignments, notes, private
              conversations or anything a member wrote. The record is append-only, so an entry
              never disappears when the person or invitation it describes is removed.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
