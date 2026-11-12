"use client";

/**
 * THE UNREAD BELL (2026-11-13).
 *
 * Counts the signed-in member's OWN unread notices. Three things it must never do:
 *
 *  1. read anyone else's rows - every read goes through /api/notifications, which scopes the
 *     query to the session's user AND is backed by RLS;
 *  2. show a number it could not verify - a failed check keeps the last known count rather
 *     than becoming "0 unread";
 *  3. announce zero - the caller only draws a badge when the count is known and above zero,
 *     because "0 unread" is not an alert.
 *
 * Live updates come from the existing Supabase realtime connection, filtered to this
 * member's rows. When realtime is unavailable a slow fallback read covers it, paused while
 * the tab is hidden so a background tab costs nothing. The subscription is removed on
 * unmount (and on navigation, since every page mounts its own shell), so route changes
 * cannot stack channels.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface NotificationBell {
  unread: number;
  /** TRUE once a read has genuinely succeeded at least once. */
  known: boolean;
  refresh: () => void;
}

export function useNotificationBell(
  userId: string | null,
  options: { intervalMs?: number; realtime?: boolean } = {},
): NotificationBell {
  const { intervalMs = 60_000, realtime = true } = options;
  const [unread, setUnread] = useState(0);
  const [known, setKnown] = useState(false);
  const mounted = useRef(true);

  const read = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return; // keep the last verified number
      const body = (await res.json().catch(() => null)) as { unread?: unknown } | null;
      if (!mounted.current) return;
      if (typeof body?.unread === "number" && Number.isFinite(body.unread)) {
        setUnread(Math.max(0, Math.trunc(body.unread)));
        setKnown(true);
      }
    } catch {
      /* offline: the previous verified number stands */
    }
  }, [userId]);

  useEffect(() => {
    mounted.current = true;
    if (!userId) {
      setUnread(0);
      setKnown(false);
      return;
    }

    void read();

    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void read();
    }, Math.max(15_000, intervalMs));

    const onBack = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void read();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("online", onBack);

    let client: ReturnType<typeof createClient> | null = null;
    let channel: { unsubscribe: () => void } | null = null;
    if (realtime) {
      try {
        client = createClient();
        const ch = client
          .channel(`sophira-notifications-${userId}`)
          .on(
            // The payload is only a signal to re-read the verified count; it is not rendered.
            "postgres_changes" as never,
            { event: "*", schema: "public", table: "member_notifications", filter: `user_id=eq.${userId}` } as never,
            () => {
              void read();
            },
          )
          .subscribe();
        channel = ch as unknown as { unsubscribe: () => void };
      } catch {
        channel = null; // no realtime client: the interval above is already covering it
      }
    }

    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("online", onBack);
      try {
        if (client && channel) void client.removeChannel(channel as never);
      } catch {
        /* already closed */
      }
    };
  }, [userId, intervalMs, realtime, read]);

  return { unread, known, refresh: read };
}
