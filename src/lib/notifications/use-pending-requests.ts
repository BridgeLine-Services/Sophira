"use client";

/**
 * WHAT IS WAITING FOR A STAFF DECISION (2026-11-13).
 *
 * The owner's spec: "when a request arrives, the staff member who is allowed to decide it must
 * be able to know that it needs attention". A Co-Owner cannot see the Owner's dashboard action
 * list, so before this the only way to find a waiting request was to open the requests page and
 * hope one was there. This gives the sidebar the count.
 *
 * It is a count of PENDING requests only, read through the same protected API the page uses,
 * and only for the roles that may decide one - a plain member never triggers the read at all.
 * A failed read reports "not known", which draws no number: an unavailable count must never be
 * shown as zero waiting work.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface PendingRequests {
  pending: number;
  /** TRUE only after a read genuinely succeeded. */
  known: boolean;
  refresh: () => void;
}

export function usePendingRequests(role: string | null | undefined, intervalMs = 60_000): PendingRequests {
  const staff = role === "owner" || role === "co_owner";
  const [pending, setPending] = useState(0);
  const [known, setKnown] = useState(false);
  const mounted = useRef(true);

  const read = useCallback(async () => {
    if (!staff) return;
    try {
      const res = await fetch("/api/invitation-requests", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
      const rows = Array.isArray(body?.data) ? (body!.data as Array<{ status?: unknown }>) : null;
      if (!mounted.current || !rows) return;
      setPending(rows.filter((row) => row.status === "pending").length);
      setKnown(true);
    } catch {
      /* offline: the last verified number stands, and no number is invented */
    }
  }, [staff]);

  useEffect(() => {
    mounted.current = true;
    if (!staff) {
      setPending(0);
      setKnown(false);
      return;
    }
    void read();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void read();
    }, Math.max(20_000, intervalMs));
    const onBack = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void read();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("online", onBack);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("online", onBack);
    };
  }, [staff, intervalMs, read]);

  return { pending, known, refresh: read };
}
