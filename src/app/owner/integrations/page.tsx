import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { AppShell } from "@/components/app/AppShell";
import { IntegrationsPanel } from "@/components/app/IntegrationsPanel";

export const dynamic = "force-dynamic";

/**
 * OWNER INTEGRATIONS (2026-10-13, navigation-defect fix): the Owner
 * Dashboard's Integrations entry previously linked to the user Settings
 * integrations page, which renders in the personal-workspace shell — the
 * owner reported "clicking Integrations opens user Settings". This page is
 * the same panel, but owner-guarded (non-owners are redirected away) and
 * rendered inside the OWNER shell so the owner dashboard navigation stays
 * visible. The user route /settings/integrations is unchanged.
 */
export default async function OwnerIntegrationsPage() {
  const supabase = createClient();
  const user = await requireUser(supabase);
  const { profile } = await readProfileWithRepair(supabase, user.id);
  if (!profile || profile.role !== "owner") redirect("/owner");
  return (
    <AppShell title="Integrations" variant="owner">
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm text-ink-soft">
          Connect a Microsoft or Google account to save documents directly into it.
          Your downloads (DOCX, PDF, PPTX) always work without a connection.
        </p>
        <IntegrationsPanel />
      </div>
    </AppShell>
  );
}
