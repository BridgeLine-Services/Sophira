import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { AppShell } from "@/components/app/AppShell";
import { isStaff, normalizeRole } from "@/lib/roles";
import { AnnouncementComposer } from "@/components/owner/AnnouncementComposer";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  const supabase = createClient();
  const user = await requireUser(supabase);
  const { profile } = await readProfileWithRepair(supabase, user.id);
  if (!isStaff(normalizeRole(profile?.role))) redirect("/dashboard");

  const { data: rows } = await supabase
    .from("announcements")
    .select("id, title, body, status, published_at, created_at, author_id")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <AppShell title="Announcements" backHref="/co-owner">
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
