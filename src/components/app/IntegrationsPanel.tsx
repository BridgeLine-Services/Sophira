"use client";
/**
 * INTEGRATIONS PANEL (2026-10-11): honest connection states for Microsoft
 * Word and Google Docs. States come from the real status routes: not
 * configured (deployment missing credentials), not connected, connected +
 * verified by a REAL provider call, or expired (reconnect needed). A
 * configured variable alone NEVER shows as connected.
 */
import { useCallback, useEffect, useState } from "react";

type Status = {
  configured: boolean;
  connected: boolean;
  verified: boolean;
  expired?: boolean;
  account?: string | null;
};

const card = "rounded-lg border border-ink/15 p-4";
const btn = "rounded-md border border-ink/15 px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-ink/5 disabled:opacity-50";

function ProviderCard({
  name,
  status,
  busy,
  onConnect,
  onDisconnect,
}: {
  name: "microsoft" | "google";
  status: Status | null;
  busy: boolean;
  onConnect: (p: "microsoft" | "google") => void;
  onDisconnect: (p: "microsoft" | "google") => void;
}) {
  const title = name === "microsoft" ? "Microsoft Word" : "Google Docs";
  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-ink">{title}</p>
          <p className="text-xs text-ink-soft">
            {!status
              ? "Checking…"
              : !status.configured
                ? "Not set up yet — this deployment is missing the server-side credentials (see the setup guide)."
                : !status.connected
                  ? "Not connected."
                  : status.verified
                    ? `Connected${status.account ? ` as ${status.account}` : ""} and verified.`
                    : status.expired
                      ? "Access expired — reconnect to continue."
                      : "Connected, but the live check just failed. Retry or reconnect."}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {status?.connected ? (
            <button type="button" className={btn} disabled={busy} onClick={() => onDisconnect(name)}>
              Disconnect
            </button>
          ) : (
            <button type="button" className={btn} disabled={busy || !status?.configured} onClick={() => onConnect(name)}>
              {status?.connected ? "Reconnect" : "Connect"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function IntegrationsPanel() {
  const [ms, setMs] = useState<Status | null>(null);
  const [gg, setGg] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [a, b] = await Promise.all([
        fetch("/api/integrations/microsoft/status").then((r) => r.json() as Promise<Status>),
        fetch("/api/integrations/google/status").then((r) => r.json() as Promise<Status>),
      ]);
      setMs(a);
      setGg(b);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const q = new URLSearchParams(window.location.search);
    const result = q.get("microsoft") ?? q.get("google");
    if (result) window.history.replaceState({}, "", "/settings/integrations");
  }, [refresh]);

  const connect = useCallback(async (p: "microsoft" | "google") => {
    setBusy(true);
    try {
      const res = await fetch(`/api/integrations/${p}/authorize`, { method: "POST" });
      const json = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (json.url) {
        window.location.href = json.url;
      } else {
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const disconnect = useCallback(async (p: "microsoft" | "google") => {
    setBusy(true);
    try {
      await fetch(`/api/integrations/${p}/disconnect`, { method: "POST" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <div className="mt-4 space-y-3">
      <ProviderCard name="microsoft" status={ms} busy={busy} onConnect={connect} onDisconnect={disconnect} />
      <ProviderCard name="google" status={gg} busy={busy} onConnect={connect} onDisconnect={disconnect} />
    </div>
  );
}
