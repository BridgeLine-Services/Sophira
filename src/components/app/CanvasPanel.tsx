"use client";
/**
 * CANVAS PANEL (2026-11-02, Stage 2).
 *
 * Written for students, not developers: every state is a plain sentence, and no
 * Canvas API error text or status code ever reaches the screen. The states come
 * from /api/integrations/canvas/status, which reflects the real stored token and a
 * real Canvas call, so a configured deployment alone never shows as connected.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Change = {
  canvasId: string;
  title: string;
  courseName: string | null;
  kind: "new" | "updated" | "restored" | "missing";
  dueAt: string | null;
  assignmentId: string | null;
};

type Status = {
  configured: boolean;
  connected: boolean;
  verified: boolean;
  expired?: boolean;
  accountLabel?: string | null;
  courses?: number;
  assignments?: number;
  lastSyncAt?: string | null;
  linked?: boolean;
  message?: string;
};

type SyncResult = {
  ok: boolean;
  message?: string;
  error?: string;
  summary?: { created: number; updated: number; missing: number; restored: number };
  changes?: Change[];
};

const card = "panel-flat p-4";
const btn =
  "rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-ink/5 disabled:opacity-50 min-h-[36px]";

const KIND_LABEL: Record<Change["kind"], string> = {
  new: "New assignment",
  updated: "Instructions changed",
  restored: "Available again",
  missing: "No longer in Canvas",
};

function when(value: string | null | undefined): string {
  if (!value) return "not yet";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "not yet";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CanvasPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/canvas/status");
      const json = (await res.json()) as Status;
      setStatus(json);
    } catch {
      setProblem("Sophira could not check your Canvas connection just now. Check your internet connection and try again.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const q = new URLSearchParams(window.location.search);
    if (q.get("canvas")) {
      setNote(
        q.get("canvas") === "connected"
          ? "Your Canvas account is connected."
          : "That Canvas connection did not finish. You can try again."
      );
      window.history.replaceState({}, "", "/settings/integrations");
    }
  }, [refresh]);

  const connect = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/integrations/canvas/authorize", { method: "POST" });
      const json = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (json.url) {
        window.location.href = json.url;
        return;
      }
      setProblem(json.error ?? "Sophira could not start the Canvas connection. Please try again.");
    } catch {
      setProblem("Sophira could not reach the Canvas connection service. Please try again in a moment.");
    } finally {
      setBusy(false);
    }
  }, []);

  const sync = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    setNote(null);
    try {
      const res = await fetch("/api/integrations/canvas/sync", { method: "POST" });
      const json = (await res.json()) as SyncResult;
      if (!res.ok || !json.ok) {
        setProblem(json.error ?? "Sophira could not check Canvas for assignments just now. Please try again.");
        return;
      }
      setNote(json.message ?? null);
      setChanges(json.changes ?? []);
      await refresh();
    } catch {
      setProblem("Sophira could not finish checking Canvas. Your saved work is unaffected.");
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const disconnect = useCallback(async () => {
    if (!window.confirm("Disconnect Canvas? Sophira will stop checking for new assignments. Work already found stays in your workspace.")) {
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/integrations/canvas/disconnect", { method: "POST" });
      const json = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      setNote(json.message ?? null);
      setChanges([]);
      await refresh();
    } catch {
      setProblem("Sophira could not disconnect Canvas just now. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const line = !status
    ? "Checking your Canvas connection…"
    : !status.configured
      ? "Canvas is not available in this copy of Sophira yet. An administrator needs to add the Canvas settings."
      : !status.connected
        ? "Connect your Canvas account so Sophira can find your assignments automatically."
        : status.verified
          ? `Your Canvas account is connected${status.accountLabel ? ` as ${status.accountLabel}` : ""}. Sophira checked it ${when(status.lastSyncAt)}.`
          : status.expired
            ? "Your Canvas access has expired. Reconnect to keep syncing assignments."
            : "Canvas is connected, but the last check failed. Try syncing again or reconnect.";

  return (
    <div className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">Canvas</p>
          <p className="text-xs text-ink-soft">{line}</p>
          {status?.connected ? (
            <p className="mt-1 text-xs text-ink-soft">
              {status.courses ?? 0} course{(status.courses ?? 0) === 1 ? "" : "s"} found ·{" "}
              {status.assignments ?? 0} assignment{(status.assignments ?? 0) === 1 ? "" : "s"} tracked
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {status?.connected ? (
            <>
              <button type="button" className={btn} disabled={busy} onClick={() => void sync()}>
                {busy ? "Checking…" : "Check for assignments"}
              </button>
              <button type="button" className={btn} disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </button>
            </>
          ) : (
            <button type="button" className={btn} disabled={busy || !status?.configured} onClick={() => void connect()}>
              {busy ? "Opening Canvas…" : status?.connected ? "Reconnect" : "Connect your Canvas account"}
            </button>
          )}
        </div>
      </div>

      {note ? (
        <p role="status" className="mt-3 rounded-md bg-accent-soft/60 px-3 py-2 text-xs text-ink">
          {note}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-3 rounded-md border border-danger/30 px-3 py-2 text-xs text-danger">
          {problem}
        </p>
      ) : null}

      {changes.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {changes.map((c) => (
            <li key={`${c.kind}-${c.canvasId}`} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
                {KIND_LABEL[c.kind]}
              </span>
              {c.assignmentId ? (
                <Link href={`/assignments/${c.assignmentId}`} className="font-medium text-accent hover:underline">
                  {c.title}
                </Link>
              ) : (
                <span className="font-medium text-ink">{c.title}</span>
              )}
              <span className="text-ink-soft">
                {c.courseName ? `${c.courseName} · ` : ""}
                {c.dueAt ? `due ${when(c.dueAt)}` : "no due date"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
