"use client";

/**
 * LIVE PRESENCE FEED (2026-11-12).
 *
 * The Members page must not need a manual refresh, and it must not hammer the database
 * either. Three layers, cheapest first:
 *
 *   1. Supabase Realtime: a change to member_presence wakes the page and it re-reads.
 *   2. A slow interval at the owner's configured refresh rate, used when realtime is
 *      unavailable (self-hosted, disabled, or blocked by a proxy).
 *   3. A one-off refresh when the tab becomes visible again or the network returns, so a
 *      laptop reopened after lunch is correct immediately.
 *
 * The tab also STOPS polling while hidden: a background tab reporting in would make an
 * absent member look present, which is exactly the claim this feature must not make.
 *
 * When a read fails, the caller keeps the values it has and marks them unknown after the
 * connection timeout - it never invents a state.
 */

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export interface PresenceFeedOptions {
  /** Milliseconds between fallback reads. */
  intervalMs: number;
  /** Re-reads the directory. Must be stable (useCallback). */
  onRefresh: () => void | Promise<void>;
  /** Enables the realtime subscription. Off by default in tests and on failure. */
  realtime?: boolean;
}

export function usePresenceFeed({ intervalMs, onRefresh, realtime = true }: PresenceFeedOptions) {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let channel: { unsubscribe: () => void } | null = null;

    const tick = () => {
      if (disposed) return;
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshRef.current();
    };

    timer = setInterval(tick, Math.max(10_000, intervalMs));

    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) tick();
    };
    const onOnline = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    if (realtime) {
      try {
        const supabase = createClient();
        const ch = supabase.channel("sophira-member-presence");
        ch.on(
          // The payload is not trusted or rendered: it is only a signal to re-read the
          // server-computed directory, which is the single source of truth.
          "postgres_changes" as never,
          { event: "*", schema: "public", table: "member_presence" } as never,
          () => tick(),
        );
        ch.subscribe((status: string) => {
          // If realtime cannot connect, the interval above is already doing the work.
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            void refreshRef.current();
          }
        });
        channel = ch as unknown as { unsubscribe: () => void };
      } catch {
        channel = null; // no realtime client configured: polling continues
      }
    }

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      try {
        channel?.unsubscribe();
      } catch {
        /* already closed */
      }
    };
  }, [intervalMs, realtime]);
}
