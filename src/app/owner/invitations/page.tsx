import Link from "next/link";
import { headers } from "next/headers";
import { AppShell } from "@/components/app/AppShell";
import { InvitationsPanel } from "@/components/app/InvitationsPanel";
import { requireStaffPage } from "@/lib/owner/page-context";
import { loadOwnerRoster } from "@/lib/owner/roster";

export const dynamic = "force-dynamic";

/**
 * Invitations (2026-11-03, phase 1). One page for issuing and managing invitations, using the
 * existing /api/invitations contract and the shared action module. Delivery is reported exactly
 * as the provider reported it, with the copy-link fallback always available.
 */
export default async function OwnerInvitationsPage() {
  const { supabase } = await requireStaffPage();
  const { invitations, members } = await loadOwnerRoster(supabase);
  const hdrs = await headers();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
    || `${hdrs.get("x-forwarded-proto") || "http"}://${hdrs.get("host")}`;

  return (
    <AppShell title="Invitations" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Invite someone to Sophira</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              They receive a single-use link tied to their email address. It expires automatically,
              and you can revoke it at any time before it is used.
            </p>
          </div>
          <div className="flex gap-3 text-sm font-medium">
            <Link href="/owner/requests" className="text-accent hover:underline">Requests</Link>
            <Link href="/owner/members" className="text-accent hover:underline">Members</Link>
            <Link href="/owner" className="text-accent hover:underline">Back to overview</Link>
          </div>
        </div>
        <InvitationsPanel initialInvitations={invitations} members={members} siteUrl={siteUrl} />
      </div>
    </AppShell>
  );
}
