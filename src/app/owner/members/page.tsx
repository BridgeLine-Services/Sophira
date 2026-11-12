import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { MembersPanel } from "@/components/app/MembersPanel";
import { PresenceSettings } from "@/components/app/PresenceSettings";
import { RoleChangeLog } from "@/components/app/RoleChangeLog";
import { requireStaffPage } from "@/lib/owner/page-context";
import { loadOwnerRoster } from "@/lib/owner/roster";
import { isRole } from "@/lib/roles";
import { DEFAULT_THRESHOLDS } from "@/lib/presence/thresholds";

export const dynamic = "force-dynamic";

/**
 * Members (2026-11-03, phase 1). The owner's member directory: identity, phone, role, status and
 * the existing management actions, with the server-side owner check applied before any data loads.
 */
export default async function OwnerMembersPage() {
  const { supabase, user, profile } = await requireStaffPage();
  const { members, statsError, thresholds, presenceAvailable, roleChanges, roleAuditAvailable } =
    await loadOwnerRoster(supabase);

  return (
    <AppShell
      subtitle="Everyone with access, and the role each one holds." title="Members" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Everyone in your network</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Revoke access to switch someone off temporarily; you can restore them later. Removing
              an account permanently is a separate action and asks for confirmation. Owners and
              Co-Owners can grant, revoke or reinstate access for Users and Testers; only an Owner
              can manage another Owner or change an administrator&apos;s role.
            </p>
          </div>
          <div className="flex gap-3 text-sm font-medium">
            <Link href="/owner/invitations" className="text-accent hover:underline">Invite someone</Link>
            <Link href={profile.role === "owner" ? "/owner" : "/dashboard"} className="text-accent hover:underline">
              {profile.role === "owner" ? "Back to overview" : "Back to my workspace"}
            </Link>
          </div>
        </div>

        {profile.role === "owner" && (
          <PresenceSettings
            initial={thresholds ?? DEFAULT_THRESHOLDS}
            available={presenceAvailable}
          />
        )}

        <MembersPanel
          initialMembers={members}
          viewerId={user.id}
          viewerRole={isRole(profile.role) ? profile.role : "user"}
          thresholds={thresholds}
          presenceAvailable={presenceAvailable}
          initialNotice={statsError}
        />

        <RoleChangeLog changes={roleChanges} available={roleAuditAvailable} />
      </div>
    </AppShell>
  );
}
