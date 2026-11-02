import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import LocalDateTime from "@/components/app/LocalDateTime";
import { MarkAllReadButton, MarkReadButton } from "@/components/app/NotificationActions";
import { listNotifications, safeLink } from "@/lib/notifications/store";

export const dynamic = "force-dynamic";

/**
 * NOTIFICATION CENTRE (2026-11-02).
 *
 * Durable, per-member, and quiet: unread first-class, nothing deleted by opening the page,
 * and no notification ever becomes a redirect (links are validated as in-app paths).
 */
export default async function NotificationsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { items, unread } = await listNotifications(supabase, user.id);

  return (
    <AppShell title="Notifications" backHref="/dashboard">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-ink-soft">
          {unread > 0 ? `${unread} unread` : "You're all caught up"} — {items.length} notification
          {items.length === 1 ? "" : "s"} in total.
        </p>
        <MarkAllReadButton disabled={unread === 0} />
      </div>

      {items.length === 0 ? (
        <p className="mt-6 rounded-xl border p-5 text-sm text-ink-soft">
          Nothing here yet. When a Canvas assignment arrives, a due date gets close, or a save needs your
          attention, it will appear here so you can find it again later.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {items.map((item) => {
            const href = safeLink(item.link);
            return (
              <li
                key={item.id}
                className={`rounded-xl border p-4 ${item.read_at ? "" : "bg-accent/5"}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">
                    {item.read_at ? "" : <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent" aria-label="Unread" />}
                    {item.title}
                  </p>
                  <p className="text-xs text-ink-soft">
                    <LocalDateTime iso={item.created_at} />
                  </p>
                </div>
                {item.body && <p className="mt-1 text-sm text-ink-soft">{item.body}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  {href && (
                    <Link href={href} className="text-xs font-medium text-accent hover:underline">
                      Open
                    </Link>
                  )}
                  {!item.read_at && <MarkReadButton id={item.id} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
