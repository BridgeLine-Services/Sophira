"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Spinner, useToast } from "@/components/ui";
import { ListChecks, Play, RotateCw, X, AlertCircle } from "lucide-react";

/**
 * AUTONOMOUS ASSIGNMENT RUNS (directive 2026-11-15, Part 4 and Part 7).
 *
 * The runner, the state machine and the routes existed before this screen, which meant a
 * student had no way to start a run or see one progress. This is that way in.
 *
 * Four rules the screen keeps:
 *  - Progress is the runner's stored progress. A run is never shown as finished unless the
 *    server says `completed` AND hands back a completion claim; nothing is rounded up.
 *  - Anything the runner could not do is shown as a limitation, not smoothed over.
 *  - It says where the work continues: while a page is open, or on a schedule, in the
 *    server's own words.
 *  - Switched off is shown as switched off, with the manual workflow named as still working.
 */

interface RunProgressView {
  percent: number;
  drafted: number;
  total: number;
  label: string;
  measured: boolean;
}

interface RunView {
  id: string;
  state: string;
  stateLabel: string;
  progress: RunProgressView;
  continuation: { mode: string; detail: string };
  completionClaim: string | null;
  findings: { stage: string; severity: "note" | "limitation"; text: string }[];
  lastError: string | null;
  canRetry: boolean;
  feasibility: { feasible: boolean; verdict: string; remainingSteps: number; estimatedSeconds: number };
  sectionCount: number;
  createdAt: string;
  updatedAt: string;
}

const TERMINAL = ["completed", "failed", "cancelled"];

function minutes(seconds: number): string {
  if (seconds < 60) return "less than a minute";
  const m = Math.round(seconds / 60);
  return m === 1 ? "about a minute" : `about ${m} minutes`;
}

export function AutonomousRuns() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [runs, setRuns] = useState<RunView[]>([]);
  const [question, setQuestion] = useState("");
  const [starting, setStarting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/essay/autonomous", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast("error", json.error || "Your assignment runs could not be loaded just now.");
        return;
      }
      setRuns((json.data?.runs ?? []) as RunView[]);
      setEnabled(Boolean(json.data?.flag?.enabled));
    } catch {
      toast("error", "Your assignment runs could not be loaded just now.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function start() {
    const text = question.trim();
    if (!text) {
      toast("error", "Describe the assignment first, in your own words.");
      return;
    }
    setStarting(true);
    try {
      const res = await fetch("/api/essay/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast("error", json.error || "The assignment run could not be started.");
        return;
      }
      if (json.data?.duplicate) {
        toast("info", "You already started this exact assignment, so Sophira carried on with that run instead of starting a second one.");
      } else {
        toast("success", "Started. Sophira recorded the run and will work through it one step at a time.");
      }
      setQuestion("");
      await load();
    } catch {
      toast("error", "The assignment run could not be started.");
    } finally {
      setStarting(false);
    }
  }

  async function advance(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/essay/autonomous/${id}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: 2 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast("error", json.error || "Sophira could not take the next step just now. Your run is saved where it stopped.");
        return;
      }
      await load();
    } catch {
      toast("error", "Sophira could not take the next step just now. Your run is saved where it stopped.");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/essay/autonomous/${id}/cancel`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast("error", json.error || "That run could not be cancelled.");
        return;
      }
      await load();
    } catch {
      toast("error", "That run could not be cancelled.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <ListChecks className="h-4 w-4" /> Start an assignment and let Sophira work through it
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {enabled === false ? (
            <p className="text-sm text-ink-soft">
              This is switched off in this deployment. Your manual essay workflow is unchanged: build
              the plan, approve or edit the outline, then write one section at a time. An administrator
              turns this on when it is ready.
            </p>
          ) : (
            <>
              <p className="text-sm text-ink-soft">
                Describe the assignment the way your teacher set it. Sophira reads it, builds a plan,
                writes the sections, checks citations and your rubric, then verifies the result. You
                can stop it at any point and pick up where it stopped.
              </p>
              <label htmlFor="autonomous-question" className="text-sm font-medium text-ink">
                What is the assignment?
              </label>
              <textarea
                id="autonomous-question"
                className="min-h-24 w-full rounded-lg border border-line bg-card p-3 text-sm text-ink"
                placeholder="e.g. A 1,500-word essay for my history course on why the Berlin Wall fell in 1989, with at least four sources."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={8000}
              />
              <Button type="button" onClick={() => void start()} disabled={starting || enabled === null}>
                {starting ? <Spinner /> : <Play className="h-4 w-4" />}{" "}
                {starting ? "Starting…" : "Start the run"}
              </Button>
              <p className="text-xs text-ink-soft">
                Starting a run records the request and does not produce a draft on its own. Nothing is
                ever called finished until the work is actually stored and checked.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your assignment runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : runs.length === 0 ? (
            <p className="text-sm text-ink-soft">
              No runs yet. When you start one it appears here with exactly how far it has really got.
            </p>
          ) : (
            runs.map((run) => {
              const done = run.state === "completed";
              const terminal = TERMINAL.includes(run.state);
              return (
                <div key={run.id} className="panel-flat space-y-2 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{run.stateLabel}</span>
                    <Badge tone={done ? "success" : run.state === "blocked" ? "warn" : run.state === "failed" ? "danger" : "neutral"}>
                      {done ? "Finished" : terminal ? "Stopped" : "In progress"}
                    </Badge>
                    <span className="text-xs text-ink-soft">
                      {run.progress.measured
                        ? `${run.progress.drafted} of ${run.progress.total} sections written`
                        : "Measured progress starts once the plan exists"}
                    </span>
                  </div>

                  <div
                    role="progressbar"
                    aria-valuenow={run.progress.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Progress: ${run.progress.percent}%`}
                    className="h-2 w-full overflow-hidden rounded-full bg-line"
                  >
                    <div className="h-full rounded-full bg-accent" style={{ width: `${run.progress.percent}%` }} />
                  </div>
                  <p className="text-xs text-ink-soft">{run.progress.percent}% · {run.progress.label}</p>

                  {run.completionClaim ? (
                    <p className="text-xs text-ink-soft">{run.completionClaim}</p>
                  ) : done ? (
                    <p className="text-xs text-ink-soft">
                      The run finished, but Sophira will not call the piece verified without the stored
                      verification result.
                    </p>
                  ) : null}

                  {run.findings.map((finding, i) => (
                    <p key={`${run.id}-f${i}`} className="flex items-start gap-1 text-xs text-ink-soft">
                      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                      {finding.severity === "limitation" ? "Not done: " : ""}
                      {finding.text}
                    </p>
                  ))}

                  {run.lastError && (
                    <p className="flex items-start gap-1 text-xs text-ink-soft">
                      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {run.lastError}
                    </p>
                  )}

                  {!terminal && (
                    <p className="text-xs text-ink-soft">
                      {run.feasibility.verdict} About {minutes(run.feasibility.estimatedSeconds)} of work
                      remains ({run.feasibility.remainingSteps} steps).
                    </p>
                  )}

                  <p className="text-xs text-ink-soft">{run.continuation.detail}</p>

                  {!terminal && (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" onClick={() => void advance(run.id)} disabled={busyId === run.id}>
                        {busyId === run.id ? <Spinner /> : <RotateCw className="h-4 w-4" />} Take the next step
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => void cancel(run.id)} disabled={busyId === run.id}>
                        <X className="h-4 w-4" /> Stop this run
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
