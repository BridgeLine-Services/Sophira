import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { MembersPanel } from "@/components/app/MembersPanel";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { loadOwnerRoster } from "@/lib/owner/roster";

export const dynamic = "force-dynamic";

/**
 * Members (2026-11-03, phase 1). The owner's member directory: identity, phone, role, status and
 * the existing management actions, with the server-side owner check applied before any data loads.
 */
export default async function OwnerMembersPage() {
  const { supabase } = await requireOwnerPage();
  const { members, statsError } = await loadOwnerRoster(supabase);

  return (
    <AppShell title="Members" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Everyone in your network</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Revoke access to switch someone off temporarily; you can restore them later. Removing
              an account permanently is a separate action and asks for confirmation.
            </p>
          </div>
          <div className="flex gap-3 text-sm font-medium">
            <Link href="/owner/invitations" className="text-accent hover:underline">Invite someone</Link>
            <Link href="/owner" className="text-accent hover:underline">Back to overview</Link>
          </div>
        </div>

        {statsError && (
          <div role="status" className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm text-ink">{statsError}</div>
        )}

        <MembersPanel initialMembers={members} />
      </div>
    </AppShell>
  );
}
