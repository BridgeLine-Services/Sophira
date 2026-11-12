import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { RequestsPanel } from "@/components/app/RequestsPanel";
import { requireStaffPage } from "@/lib/owner/page-context";
import { loadOwnerRoster } from "@/lib/owner/roster";

export const dynamic = "force-dynamic";

/**
 * Invitation Requests (2026-11-03, phase 1). Preserves the existing contract: only the owner
 * approves or rejects, and a member's request never creates an invitation by itself.
 */
export default async function OwnerRequestsPage() {
  const { supabase } = await requireStaffPage();
  const { requests, members } = await loadOwnerRoster(supabase);

  return (
    <AppShell
      subtitle="Requests to join the network, waiting for a decision." title="Invitation Requests" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">People your members have suggested</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Approving creates a real invitation and gives you the link. Rejecting leaves no record
              of access and tells nobody. Nothing happens until you choose.
            </p>
          </div>
          <div className="flex gap-3 text-sm font-medium">
            <Link href="/owner/invitations" className="text-accent hover:underline">Invitations</Link>
            <Link href="/owner" className="text-accent hover:underline">Back to overview</Link>
          </div>
        </div>
        <RequestsPanel initialRequests={requests} members={members} />
      </div>
    </AppShell>
  );
}
