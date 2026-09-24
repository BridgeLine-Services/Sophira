import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import { ProposalsPanel } from "@/components/app/ProposalsPanel";
import { EmptyState } from "@/components/ui";
import { ClipboardCheck } from "lucide-react";

/**
 * Dedicated pending-profile-changes area (spec §30): every AI-proposed
 * Teacher/Writing profile update waits here for the student's decision.
 */
export default async function ProposalsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { count } = await supabase
    .from("profile_update_proposals")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return (
    <AppShell title="Pending profile changes" backHref="/dashboard">
      {(count ?? 0) === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-6 w-6" />}
          title="No pending changes"
          description="When Sophira learns something from your feedback or documents, proposed profile updates appear here. Nothing is ever changed without your approval."
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            {count} proposed update{count === 1 ? "" : "s"}. Nothing changes until you approve.
          </p>
          <ProposalsPanel />
        </div>
      )}
    </AppShell>
  );
}
