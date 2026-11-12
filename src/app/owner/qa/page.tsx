import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { canUseTesterFeatures } from "@/lib/auth/permissions";
import { environmentFor, staffBackHrefFor } from "@/lib/navigation/role-home";
import { AppShell } from "@/components/app/AppShell";
import { QaTriage, type QaRow } from "@/components/owner/QaTriage";
import { needsDatabaseUpdate } from "@/lib/supabase/missing-object";
import { DatabaseUpdateNotice } from "@/components/system/DatabaseUpdateNotice";

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

  const { data, error } = await supabase
    .from("qa_reports")
    .select("id, user_id, kind, title, area, severity, status, steps, expected, actual, resolution_note, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  /*
   * 2026-11-12: this page is staff triage, so it renders in the ADMINISTRATIVE environment for
   * the Owner and a Co-Owner (whose dashboard links straight here) with their own home as the
   * way back. A Tester may also open it - it is gated by canUseTesterFeatures - and for them
   * the ordinary workspace is the right frame, because they have no administrative menu.
   */
  /*
   * 2026-11-12: an unread table used to look like "no tester reports yet", which a staff
   * member would read as "nobody has filed anything". Say what is actually true instead.
   */
  if (needsDatabaseUpdate(error)) {
    return (
      <AppShell title="QA reports" variant={environmentFor(profile.role)} role={profile.role} backHref={staffBackHrefFor(profile.role)}>
        <DatabaseUpdateNotice feature="tester reports" error={error} canUpdate={profile.role === "owner"} />
      </AppShell>
    );
  }

  return (
    <AppShell title="QA reports" variant={environmentFor(profile.role)} role={profile.role} backHref={staffBackHrefFor(profile.role)}>
      <div className="space-y-4">
        <h2 className="meta-strong">Tester reports</h2>
        <QaTriage rows={(data as QaRow[] | null) ?? []} />
      </div>
    </AppShell>
  );
}
