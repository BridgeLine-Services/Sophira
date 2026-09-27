"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner, useToast } from "@/components/ui";
import { Gauge, RefreshCw, Target } from "lucide-react";

export interface TypingAttemptRow {
  id: string;
  test_date: string;
  duration_ms: number;
  characters_typed: number;
  wpm: number;
  accuracy: number;
  net_wpm: number;
  valid_attempt: boolean;
  flags: string[];
  is_baseline: boolean;
  notes: string;
}

interface Passage { id: string; text: string }

/**
 * Typing calibration test (spec §9).
 *
 * Shows a controlled passage from the server, times the attempt, records
 * the typed content, and stores the attempt via /api/typing — the SERVER
 * recomputes gross WPM / accuracy / net WPM and flags invalid or
 * suspicious attempts (too short, implausibly fast, incomplete). Only a
 * valid attempt can be chosen as the baseline, and the choice is always
 * the user's. Never invents a speed when calibration hasn't happened.
 */
export function TypingTest({ onBaselineChange }: { onBaselineChange?: (baseline: TypingAttemptRow | null) => void }) {
  const { toast } = useToast();
  const [passage, setPassage] = useState<Passage | null>(null);
  const [attempts, setAttempts] = useState<TypingAttemptRow[]>([]);
  const [baseline, setBaseline] = useState<TypingAttemptRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const startRef = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/typing", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        setPassage(json.data.passage);
        setAttempts(json.data.attempts ?? []);
        setBaseline(json.data.baseline ?? null);
        onBaselineChange?.(json.data.baseline ?? null);
      } else {
        toast("error", json.error || "Could not load the typing test.");
      }
    } catch {
      toast("error", "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [onBaselineChange, toast]);

  useEffect(() => { load(); }, [load]);

  function onStart() {
    if (!passage) return;
    setTyped("");
    startRef.current = null;
    setTyping(true);
  }

  function onChange(v: string) {
    if (!typing) return;
    if (startRef.current === null) startRef.current = Date.now();
    setTyped(v.slice(0, (passage?.text.length ?? 200) + 80));
  }

  async function submit() {
    if (!passage || startRef.current === null) return;
    setBusy(true);
    try {
      const res = await fetch("/api/typing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passage_id: passage.id,
          typed,
          started_at_ms: startRef.current,
          ended_at_ms: Date.now(),
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast(json.data.valid ? "success" : "info", json.data.message);
        setTyping(false);
        await load();
      } else {
        toast("error", json.error || "The attempt was not recorded.");
      }
    } catch {
      toast("error", "Could not reach the server — the attempt was not recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function makeBaseline(id: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/typing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attempt_id: id }),
      });
      const json = await res.json();
      if (res.ok) {
        toast("success", "Baseline updated — paced writing will use this speed.");
        await load();
      } else {
        toast("error", json.error || "Could not select that baseline.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-ink-soft"><Spinner className="h-4 w-4" /> Loading the typing test…</div>;
  }

  const baselineWpm = baseline ? Math.round(Number(baseline.wpm)) : null;

  return (
    <div className="space-y-4">
      {baseline ? (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
          <strong>Your paced-writing baseline: {baselineWpm} net-adjusted WPM</strong> (from {new Date(baseline.test_date).toLocaleDateString()}).
          Retake any time — the baseline only changes when you choose an attempt.
        </p>
      ) : (
        <p className="rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink-soft">
          No baseline yet. Take the test and pick an attempt — paced writing uses your chosen speed, and until then it stays honest and uses instant mode.
        </p>
      )}

      {!typing ? (
        <Button onClick={onStart} disabled={!passage}>
          <Gauge className="mr-1.5 h-4 w-4" /> {attempts.length ? "Retake the typing test" : "Start the typing test"}
        </Button>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-accent" /> Type the passage below
              <span className="ml-auto text-xs font-normal text-ink-soft">Timing starts on your first keystroke</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="whitespace-pre-wrap rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 font-mono text-sm text-ink">{passage?.text}</p>
            <textarea
              className="w-full rounded-lg border border-ink/20 p-3 font-mono text-sm focus:border-accent focus:outline-none"
              rows={5}
              value={typed}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Start typing here…"
              aria-label="Typing test input"
              spellCheck={false}
              autoComplete="off"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={submit} disabled={busy || !typed.trim()}>
                {busy ? <Spinner className="h-4 w-4" /> : "Record attempt"}
              </Button>
              <Button variant="ghost" onClick={() => { setTyping(false); setTyped(""); }} disabled={busy}>Cancel</Button>
              <span className="text-xs text-ink-soft">{typed.length} / {passage?.text.length ?? 0} characters</span>
            </div>
          </CardContent>
        </Card>
      )}

      {attempts.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-ink">Your attempts</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink-soft">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Gross WPM</th>
                  <th className="py-2 pr-3">Accuracy</th>
                  <th className="py-2 pr-3">Net WPM</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Baseline</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id} className="border-b border-ink/5">
                    <td className="py-2 pr-3 text-ink-soft">{new Date(a.test_date).toLocaleString()}</td>
                    <td className="py-2 pr-3">{Number(a.wpm).toFixed(0)}</td>
                    <td className="py-2 pr-3">{(Number(a.accuracy) * 100).toFixed(1)}%</td>
                    <td className="py-2 pr-3">{Number(a.net_wpm).toFixed(0)}</td>
                    <td className="py-2 pr-3">
                      {a.valid_attempt ? <Badge tone="success">Valid</Badge> : <Badge tone="warn">Flagged: {a.flags.join(", ")}</Badge>}
                    </td>
                    <td className="py-2 pr-3">
                      {a.is_baseline ? (
                        <Badge tone="accent">Baseline</Badge>
                      ) : a.valid_attempt ? (
                        <Button size="sm" variant="ghost" onClick={() => makeBaseline(a.id)} disabled={busy}>
                          <RefreshCw className="mr-1 h-3 w-3" /> Make baseline
                        </Button>
                      ) : (
                        <span className="text-xs text-ink-soft">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
