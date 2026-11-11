"use client";

/**
 * DATABASE UPDATES — the owner-facing control (2026-11-11).
 *
 * Deliberately calm and explicit: what the database has, what is missing, one
 * button, and a plain-English result. No SQL is ever shown or asked for, and the
 * button cannot apply a partial or out-of-order set: the server decides what is
 * missing and applies it in order.
 */
import { useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from "@/components/ui";

export interface DatabaseState {
  reachable: boolean;
  channel: "direct-postgres" | "management-api" | "none";
  total: number;
  applied: number;
  pendingCount: number;
  pending: string[];
  unverifiableCount: number;
  upToDate: boolean;
}

export default function DatabaseUpdates({ initial }: { initial: DatabaseState }) {
  const [state, setState] = useState<DatabaseState>(initial);
  const [busy, setBusy] = useState<"check" | "update" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function call(method: "GET" | "POST") {
    setBusy(method === "GET" ? "check" : "update");
    setResult(null);
    try {
      const res = await fetch("/api/owner/migrations", { method, cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        database?: DatabaseState;
        error?: string;
      };
      if (json.database) setState(json.database);
      if (method === "POST") {
        setResult({
          ok: Boolean(json.ok),
          message: json.message ?? json.error ?? "The update could not be completed.",
        });
      } else if (!res.ok) {
        setResult({ ok: false, message: json.error ?? "Could not check the database right now." });
      } else {
        setResult({
          ok: true,
          message: json.database?.upToDate
            ? "Your database is up to date."
            : `${json.database?.pendingCount ?? 0} update${(json.database?.pendingCount ?? 0) === 1 ? "" : "s"} waiting.`,
        });
      }
    } catch {
      setResult({ ok: false, message: "Sophira could not be reached. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  const channelMissing = state.channel === "none";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Your database today</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {state.upToDate ? (
              <Badge tone="success">Up to date</Badge>
            ) : (
              <Badge tone="warn">
                {state.pendingCount} update{state.pendingCount === 1 ? "" : "s"} missing
              </Badge>
            )}
            <span className="text-sm text-ink-soft">
              {state.applied} of {state.total} pieces are in place
            </span>
          </div>

          {state.pending.length > 0 && (
            <div>
              <p className="text-sm font-medium text-ink">Waiting to be added</p>
              <ul className="mt-1 space-y-1 text-sm text-ink-soft">
                {state.pending.map((label) => (
                  <li key={label}>· {label}</li>
                ))}
              </ul>
            </div>
          )}

          {state.unverifiableCount > 0 && (
            <p className="text-sm text-warn">
              {state.unverifiableCount} piece{state.unverifiableCount === 1 ? "" : "s"} of the database
              cannot be checked automatically, so Sophira will not guess. Nothing will be changed until
              that is fixed (it is a bug on our side, not yours).
            </p>
          )}

          {channelMissing && (
            <p className="text-sm text-warn">
              This deployment has no server-side path to its database, so updates cannot be applied from
              here. Reconnecting the Vercel project to its Supabase project restores it automatically.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void call("POST")}
              disabled={busy !== null || state.upToDate || channelMissing || state.unverifiableCount > 0}
            >
              {busy === "update" ? (
                <>
                  <Spinner className="h-4 w-4" /> Updating…
                </>
              ) : (
                "Update database"
              )}
            </Button>
            <Button variant="secondary" onClick={() => void call("GET")} disabled={busy !== null}>
              {busy === "check" ? (
                <>
                  <Spinner className="h-4 w-4" /> Checking…
                </>
              ) : (
                "Check again"
              )}
            </Button>
          </div>

          <p className="text-xs text-ink-soft">
            Updates only add what is missing. Nothing existing is replaced or removed, and members can
            keep working while it runs.
          </p>

          {result && (
            <p
              role="status"
              className={`rounded border px-3 py-2 text-sm ${
                result.ok ? "border-line text-ink" : "border-warn/40 text-warn"
              }`}
            >
              {result.message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
