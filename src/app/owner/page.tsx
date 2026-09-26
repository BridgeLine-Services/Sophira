import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import { OwnerDashboard } from "@/components/app/OwnerDashboard";
import { Badge, Button } from "@/components/ui";
import type { Invitation, InvitationRequest, NetworkMemberStats } from "@/lib/types";
import Link from "next/link";
import { Briefcase } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Owner Dashboard (workflow §23: authenticated + owner → Owner Dashboard).
 * Server-side authorization: a non-owner who types /owner by hand is sent
 * back to the user dashboard — this is a redirect, not hidden UI.
 */
export default async function OwnerPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/login");
  if (profile.status === "revoked") redirect("/access-denied");
  if (profile.role !== "owner") redirect("/dashboard");

  const [{ data: members, error: mErr }, { data: invitations }, { data: requests }] = await Promise.all([
    supabase.rpc("network_stats"),
    supabase.from("invitations").select("*").order("created_at", { ascending: false }),
    supabase.from("invitation_requests").select("*").order("created_at", { ascending: false }),
  ]);
  if (mErr || !members) {
    return (
      <AppShell title="Owner Dashboard">
        <p className="text-sm text-ink-soft">
          Statistics are unavailable: {mErr?.message || "unknown error"}. Run migration 0005 in Supabase.
        </p>
      </AppShell>
    );
  }

  const hdrs = await headers();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${hdrs.get("x-forwarded-proto") || "http"}://${hdrs.get("host")}`;

  return (
    <AppShell
      title="Owner Dashboard"
      actions={
        <Link href="/dashboard?view=workspace">
          <Button size="sm" variant="secondary">My workspace</Button>
        </Link>
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-sm text-ink-soft">
          <Briefcase className="h-4 w-4 text-accent" />
          You manage this private network.
        </span>
        <Badge>owner</Badge>
      </div>
      <OwnerDashboard
        initialMembers={members as NetworkMemberStats[]}
        initialInvitations={(invitations || []) as Invitation[]}
        initialRequests={(requests || []) as InvitationRequest[]}
        siteUrl={siteUrl}
      />
    </AppShell>
  );
}
