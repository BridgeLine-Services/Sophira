import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { AppShell } from "@/components/app/AppShell";
import { isStaff, normalizeRole } from "@/lib/roles";
import { staffBackHrefFor } from "@/lib/navigation/role-home";
import { AnnouncementComposer } from "@/components/owner/AnnouncementComposer";
import { needsDatabaseUpdate } from "@/lib/supabase/missing-object";
import { DatabaseUpdateNotice } from "@/components/system/DatabaseUpdateNotice";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  const supabase = createClient();
  const user = await requireUser(supabase);
  const { profile } = await readProfileWithRepair(supabase, user.id);
  const role = normalizeRole(profile?.role);
  if (!isStaff(role)) redirect("/dashboard");

  const { data: rows, error } = await supabase
    .from("announcements")
    .select("id, title, body, status, published_at, created_at, author_id")
    .order("created_at", { ascending: false })
    .limit(50);

  /*
   * 2026-11-12: the composer below writes to this table, so an unread table must never be
   * shown as "no announcements yet": a staff member would type an announcement, press send,
   * and only then be refused. The notice comes before the composer, not after a failure.
   */
  if (needsDatabaseUpdate(error)) {
    return (
      <AppShell title="Announcements" variant="owner" role={role} backHref={staffBackHrefFor(role)}>
        <DatabaseUpdateNotice feature="announcements" error={error} canUpdate={role === "owner"} />
      </AppShell>
    );
  }

  return (
    /*
   * 2026-11-12: Announcements is a staff function, not an academic destination, so it renders
   * inside the ADMINISTRATIVE environment for whichever staff rank opened it - and "back" goes
   * to that rank's own home (Owner -> /owner, Co-Owner -> /co-owner) instead of always to
   * /co-owner. The rank comes from the server-read profile, so refreshing or opening the URL
   * directly cannot put anyone in the other rank's environment.
   */
  <AppShell title="Announcements" variant="owner" role={role} backHref={staffBackHrefFor(role)}>
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">
          Network-wide updates for everyone in Sophira. Drafts stay private to staff; published
          announcements appear in every member&apos;s notifications.
        </p>
        <AnnouncementComposer rows={rows ?? []} authorId={user.id} />
      </div>
    </AppShell>
  );
}
