import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { AppShell } from "@/components/app/AppShell";
import { SystemHealthPanel } from "@/components/app/SystemHealthPanel";

export const dynamic = "force-dynamic";

/**
 * Owner System Health page (2026-10-11, phase 6). Server-side owner
 * authorization: a non-owner who types /owner/health is redirected to
 * /owner, never shown owner data.
 */
export default async function OwnerHealthPage() {
  const supabase = createClient();
  const user = await requireUser(supabase);
  const { profile } = await readProfileWithRepair(supabase, user.id);
  if (!profile || profile.role !== "owner") redirect("/owner");
  return (
    <AppShell title="System Health" variant="owner">
      <SystemHealthPanel />
    </AppShell>
  );
}
