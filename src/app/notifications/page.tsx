import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import LocalDateTime from "@/components/app/LocalDateTime";
import { MarkAllReadButton, MarkReadButton } from "@/components/app/NotificationActions";
import {
  listNotifications,
  safeLink,
  presentationGroup,
  presentationLabel,
  type NotificationRow,
  type PresentationGroup,
} from "@/lib/notifications/store";

export const dynamic = "force-dynamic";

/**
 * NOTIFICATION CENTRE (2026-11-02, grouped 2026-11-13).
 *
 * Durable, per-member, and quiet: unread is first-class, nothing is deleted by opening the
 * page, and no notification ever becomes a redirect (links are validated in-app paths).
 *
 * New here: notices are grouped under readable headings, so an invitation decision is not
 * buried among Canvas updates, and each one states whether it is read or unread in words
 * rather than only with a colour. The grouping is presentation only - it comes from the
 * event kind and changes nothing about what a member receives or what is stored.
 */
export default async function NotificationsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { items, unread } = await listNotifications(supabase, user.id);

  // Newest-first order is preserved: a heading appears where its newest notice would have.
  const order: PresentationGroup[] = [];
  const grouped = new Map<PresentationGroup, NotificationRow[]>();
  for (const item of items) {
    const group = presentationGroup(item.kind);
    if (!grouped.has(group)) {
      grouped.set(group, []);
      order.push(group);
    }
    grouped.get(group)!.push(item);
  }

  return (
    <AppShell title="Notifications" backHref="/dashboard">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-ink-soft">
          {unread > 0 ? `${unread} unread` : "You're all caught up"} — {items.length} notification
          {items.length === 1 ? "" : "s"} in total.
        </p>
        <MarkAllReadButton disabled={unread === 0} />
      </div>

      <p className="mt-2 text-sm text-ink-soft">
        Choose what Sophira tells you about in{" "}
        <Link href="/settings" className="font-medium text-accent hover:underline">
          Settings
        </Link>
        .
      </p>

      {items.length === 0 ? (
        <p className="mt-6 rounded-xl border p-5 text-sm text-ink-soft">
          Nothing here yet. When an invitation request is decided, your role changes, or a Canvas
          assignment arrives, it will appear here so you can find it again later.
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {order.map((group) => (
            <section key={group} aria-labelledby={`notifications-${group}`}>
              <h2
                id={`notifications-${group}`}
                className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-soft"
              >
                {presentationLabel(grouped.get(group)![0].kind)}
              </h2>
              <ul className="space-y-3">
                {grouped.get(group)!.map((item) => {
                  const href = safeLink(item.link);
                  return (
                    <li
                      key={item.id}
                      className={`rounded-xl border p-4 ${item.read_at ? "" : "bg-accent/5"}`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">{item.title}</p>
                        <p className="text-xs text-ink-soft">
                          <LocalDateTime iso={item.created_at} />
                        </p>
                      </div>
                      {item.body && <p className="mt-1 text-sm text-ink-soft">{item.body}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-4">
                        <span className="text-xs font-medium text-ink-soft">
                          {item.read_at ? "Read" : "Unread"}
                        </span>
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
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
