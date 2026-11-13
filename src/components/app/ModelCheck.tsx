"use client";
import { useState } from "react";
import { Badge, Button, Spinner } from "@/components/ui";
import { stateLabel, stateTone, type FeatureState } from "@/lib/owner/feature-catalog";
import { CheckCircle2, MinusCircle, XCircle } from "lucide-react";

/**
 * MODEL CHECK (Phase 2, 2026-11-13) — the owner's one button for "can my own model actually
 * do the work?".
 *
 * It runs the four fixed checks in lib/ai/benchmark.ts against the self-hosted model and
 * reports what happened. Nothing here claims more than the run proved:
 *   - before the run it says "not measured yet" rather than showing an empty 0;
 *   - each check shows its own sentence, so a half-working model is visibly half-working;
 *   - a provider that is not connected says so, calmly, and points at the offline help that
 *     still works;
 *   - a failed request never renders a green tick.
 */

interface RunRow {
  id: string;
  label: string;
  ms: number;
  passed: boolean | null;
  note: string;
}

interface Result {
  state: FeatureState;
  headline: string;
  detail: string;
  measured?: boolean;
  median_ms?: number | null;
  runs: RunRow[];
}

export function ModelCheck() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/owner/ai-benchmark", { method: "POST" });
      if (!res.ok) {
        setError("That check could not run just now. Nothing about your model has changed.");
        return;
      }
      setResult((await res.json()) as Result);
    } catch {
      setError("That check could not run just now. Nothing about your model has changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        Four short checks: explaining, showing working, returning usable structure, and not
        inventing an answer. It asks your own model only, so it never spends money or sends a
        member&apos;s work anywhere.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={run} disabled={busy}>
          {busy ? <><Spinner className="h-4 w-4" /> Checking your model…</> : result ? "Check again" : "Check my model"}
        </Button>
        {result && <Badge tone={stateTone(result.state)}>{stateLabel(result.state)}</Badge>}
        {!result && !busy && !error && <span className="text-xs text-ink-soft">Not measured yet.</span>}
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">{result.headline}</p>
          <p className="text-sm text-ink-soft">{result.detail}</p>
          {result.measured && typeof result.median_ms === "number" && (
            <p className="text-xs text-ink-soft">
              Typical answer time: about {(result.median_ms / 1000).toFixed(1)}s
              {result.runs.length > 1 ? `, across ${result.runs.length} checks` : ""}.
            </p>
          )}
          {result.runs.length > 0 && (
            <ul className="mt-1 space-y-1.5">
              {result.runs.map((r) => (
                <li key={r.id} className="flex items-start gap-2 text-sm">
                  {r.passed === true ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Passed" />
                  ) : r.passed === false ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-label="Failed" />
                  ) : (
                    <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" aria-label="No answer" />
                  )}
                  <span>
                    <span className="font-medium text-ink">{r.label}</span>
                    <span className="text-ink-soft">: {r.note}</span>
                    {r.ms > 0 && <span className="text-ink-soft"> ({(r.ms / 1000).toFixed(1)}s)</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
