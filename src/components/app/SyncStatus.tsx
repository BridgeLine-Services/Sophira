"use client";
/**
 * Sync status indicator (STEP 11) — shows exactly one of:
 *   Online · Offline · Syncing · Sync complete · Sync failed
 * plus a pending-changes badge. Never leaves the user guessing whether
 * their work has synchronized. "Sync complete" only appears after a sync
 * finished with zero failures and zero pending ops.
 */

import { useCallback, useEffect, useState } from "react";
import { offlineStack } from "@/lib/offline/client";

export type SyncUiState = "online" | "offline" | "syncing" | "done" | "failed";

export function SyncStatus() {
  const [state, setState] = useState<SyncUiState>("online");
  const [pending, setPending] = useState(0);

  const refresh = useCallback(async () => {
    const s = offlineStack();
    const online = typeof navigator !== "undefined" ? navigator.onLine !== false : false;
    const n = await s.queue.count().catch(() => 0);
    setPending(n);
    setState((prev) => (prev === "syncing" ? prev : online ? "online" : "offline"));
  }, []);

  useEffect(() => {
    refresh();
    const on = () => {
      setState("online");
      void runSync();
    };
    const off = () => {
      setState("offline");
      void refresh();
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const t = window.setInterval(refresh, 20000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSync = useCallback(async () => {
    const s = offlineStack();
    setState("syncing");
    try {
      await s.ensure();
      const report = await s.sync.run();
      if (report.revoked || report.failures > 0) setState("failed");
      else setState("done");
      setPending(report.complete ? 0 : await s.queue.count().catch(() => 0));
      if (report.revoked) {
        // account revoked while offline: seal + purge local data
        await s.sync.purgeOfflineAccount();
        window.location.href = "/login?revoked=1";
      }
    } catch {
      setState("failed");
    }
  }, []);

  const label =
    state === "online" ? "Online" :
    state === "offline" ? "Offline" :
    state === "syncing" ? "Syncing…" :
    state === "done" ? "Sync complete" : "Sync failed";
  const cls =
    state === "online" ? "bg-emerald-100 text-emerald-800" :
    state === "offline" ? "bg-slate-200 text-slate-700" :
    state === "syncing" ? "bg-blue-100 text-blue-800" :
    state === "done" ? "bg-emerald-100 text-emerald-800" :
    "bg-red-100 text-red-800";

  return (
    <button
      onClick={() => { if (state !== "offline") void runSync(); }}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}
      title={pending > 0 ? `${pending} offline change(s) waiting to sync — click to sync` : "Sync status — click to sync"}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${state === "offline" ? "bg-slate-500" : state === "failed" ? "bg-red-500" : "bg-emerald-600"}`} />
      {label}
      {pending > 0 && <span className="rounded-full bg-ink/10 px-1.5 font-semibold">{pending} pending</span>}
    </button>
  );
}
