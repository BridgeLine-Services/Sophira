"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * THE LIST REFRESHES ITSELF (2026-11-13).
 *
 * The centre is rendered on the server, so before this a member sitting on the page never saw a
 * notice arrive and had to reload to trust what they were reading. This component owns no markup
 * and no styling: it listens to the existing realtime connection, filtered to this member's own
 * rows, and asks the server to render the list again.
 *
 * It renders nothing at all, so an unreachable realtime service simply means the list stays as
 * it was - which is the honest state - rather than a spinner over content that already loaded.
 * Marking something read still refreshes through the existing actions. The subscription is
 * removed on unmount so visiting the page twice cannot stack a second listener.
 */

export default function NotificationsLive({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!userId) return;
    let client: ReturnType<typeof createClient> | null = null;
    let channel: { unsubscribe: () => void } | null = null;
    try {
      client = createClient();
      channel = client
        .channel(`sophira-notification-centre-${userId}`)
        .on(
          "postgres_changes" as never,
          { event: "*", schema: "public", table: "member_notifications", filter: `user_id=eq.${userId}` } as never,
          () => router.refresh(),
        )
        .subscribe() as unknown as { unsubscribe: () => void };
    } catch {
      channel = null;
    }

    // Coming back to the tab is the moment the list is most likely stale.
    const onBack = () => {
      if (typeof document !== "undefined" && !document.hidden) router.refresh();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("online", onBack);

    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("online", onBack);
      try {
        if (client && channel) void client.removeChannel(channel as never);
      } catch {
        /* already closed */
      }
    };
  }, [userId, router]);

  return null;
}
