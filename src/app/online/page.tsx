"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner, useToast } from "@/components/ui";
import { offlineStack } from "@/lib/offline/client";
import { Wifi, WifiOff, RefreshCw, CloudOff } from "lucide-react";

interface Health { ok?: boolean; services?: Record<string, boolean> }

export default function OnlinePage() {
  const { toast } = useToast();
  const [online, setOnline] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [conflicts, setConflicts] = useState(0);
  const [syncBusy, setSyncBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const probe = useCallback(async () => {
    setOnline(navigator.onLine !== false);
    setHealthBusy(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      setHealth({ ok: res.ok, services: null, ...(await res.json().catch(() => ({}))) });
    } catch {
      setHealth(null);
    } finally { setHealthBusy(false); }
    try {
      const s = offlineStack();
      await s.ensure();
      setPending(await s.queue.count());
      const conflictRows = await s.store.list("conflicts").catch(() => [] as never[]);
      setConflicts(conflictRows.length);
    } catch { setPending(null); }
  }, []);

  useEffect(() => {
    probe();
    const up = () => { setOnline(true); probe(); };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, [probe]);

  async function syncNow() {
    setSyncBusy(true);
    try {
      const s = offlineStack();
      await s.ensure();
      const report = await s.sync.run();
      setLastSync(new Date().toLocaleTimeString());
      setPending(await s.queue.count().catch(() => 0));
      const conflictsNow = report?.conflicts ?? 0;
      setConflicts(conflictsNow);
      const failed = report?.failures ?? 0;
      if (report?.revoked) {
        toast("error", "This account's access was revoked. Synchronization is sealed — sign out is required.");
      } else if (failed > 0) {
        toast("error", `Uploaded ${report?.uploaded ?? 0} change(s); ${failed} need a retry — they stay safely queued.`);
      } else {
        toast("success", `Uploaded ${report?.uploaded ?? 0} change(s); pulled ${report?.pulled ?? 0}.${conflictsNow > 0 ? ` ${conflictsNow} conflict(s) need attention.` : ""}`);
      }
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Synchronization failed. Your changes are still queued safely.");
    } finally { setSyncBusy(false); }
  }

  return (
    <AppShell title="Online">
      <div className="mx-auto max-w-2xl space-y-4">
        <p className="text-sm text-ink-soft">
          Live connectivity and synchronization status. This page never shows a false online or
          offline state — it reports exactly what it can verify.
        </p>

        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              {online ? <Wifi className="h-5 w-5 text-emerald-600" /> : <WifiOff className="h-5 w-5 text-amber-600" />}
              <div>
                <p className="text-sm font-medium text-ink">{online ? "Connected to the internet" : "No internet connection"}</p>
                <p className="text-xs text-ink-soft">Device network status (browser-reported).</p>
              </div>
            </div>
            <Badge tone={online ? "success" : "warn"}>{online ? "Online" : "Offline"}</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              {healthBusy ? <Spinner /> : health ? <Wifi className="h-5 w-5 text-emerald-600" /> : <CloudOff className="h-5 w-5 text-amber-600" />}
              <div>
                <p className="text-sm font-medium text-ink">
                  {healthBusy ? "Checking Sophira service…" : health ? "Sophira service reachable" : "Sophira service unreachable"}
                </p>
                <p className="text-xs text-ink-soft">Application server availability, measured by a live request.</p>
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={probe} disabled={healthBusy}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Re-check
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Unsynchronized changes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink-soft">
              {pending === null
                ? "Offline storage could not be opened on this device."
                : pending === 0
                  ? "No local changes waiting. Everything you changed is synchronized."
                  : `${pending} local change${pending === 1 ? "" : "s"} waiting to synchronize.`}
              {conflicts > 0 && ` ${conflicts} conflict${conflicts === 1 ? "" : "s"} need your attention.`}
            </p>
            {lastSync && <p className="text-xs text-ink-soft">Last sync attempt: {lastSync}</p>}
            <Button onClick={syncNow} disabled={syncBusy || pending === 0}>
              {syncBusy ? <Spinner /> : pending === 0 ? "Nothing to sync" : "Synchronize now"}
            </Button>
            <p className="text-xs text-ink-soft">
              Failed changes stay safely queued and retry on the next sync — nothing is lost by
              retrying. The <a href="/offline" className="text-accent underline">Offline page</a>{" "}
              explains what works without a connection.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
