import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { canUseTesterFeatures } from "@/lib/auth/permissions";
import { AppShell } from "@/components/app/AppShell";
import { QaTriage, type QaRow } from "@/components/owner/QaTriage";

export const dynamic = "force-dynamic";

/**
 * Staff QA triage. The tester workspace files reports; this is where staff
 * move them (RLS lets staff read all reports and update status only).
 */
export default async function OwnerQaPage() {
  const supabase = createClient();
  const user = await requireUser(supabase);
  const { profile } = await readProfileWithRepair(supabase, user.id);
  if (!profile || !canUseTesterFeatures(profile.role)) redirect("/dashboard");

  const { data } = await supabase
    .from("qa_reports")
    .select("id, user_id, kind, title, area, severity, status, steps, expected, actual, resolution_note, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <AppShell title="QA reports">
      <div className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Tester reports</h2>
        <QaTriage rows={(data as QaRow[] | null) ?? []} />
      </div>
    </AppShell>
  );
}
