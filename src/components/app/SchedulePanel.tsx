"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Spinner, useToast } from "@/components/ui";
import { CalendarClock, Pause, Play, SkipForward, CheckCircle2, AlertTriangle } from "lucide-react";

export interface SchedulePlanShape {
  feasible?: boolean;
  warning?: string | null;
  sessions?: { startMs: number; workSeconds: number; breakSeconds: number }[];
  estimatedCompletionMs?: number;
  timeRemainingMs?: number;
  explanation?: string;
}

export interface WorkScheduleRow {
  id: string;
  assignment_id: string;
  deadline: string;
  urgency: "relaxed" | "normal" | "urgent" | "extreme";
  estimated_work_minutes: number;
  plan: SchedulePlanShape;
  status: "planned" | "running" | "paused" | "done";
  session_index: number;
  work_started_at: string | null;
  paused_at: string | null;
}

function fmtRemaining(ms: number): string {
  if (ms <= 0) return "past due";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

/**
 * Deadline-aware work/break scheduling UI (spec §11), wired to the existing
 * deterministic scheduler through /api/schedule (server-side planning with
 * the server clock; breaks hard-bounded 10s–6h; no random delays).
 *
 * The scheduler manages WORK SESSIONS; the pacing engine separately
 * controls how finished text is revealed during active work — they
 * cooperate and never conflict. The plan is persisted per assignment with
 * pause/resume state.
 */
export function SchedulePanel({ assignmentId }: { assignmentId: string }) {
  const { toast } = useToast();
  const [schedule, setSchedule] = useState<WorkScheduleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [dueLocal, setDueLocal] = useState("");
  const [urgency, setUrgency] = useState("normal");
  const [estimate, setEstimate] = useState("");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/schedule?assignment_id=${assignmentId}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setSchedule(json.data.schedule ?? null);
      else toast("error", json.error || "Could not load the schedule.");
    } catch {
      toast("error", "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [assignmentId, toast]);

  useEffect(() => { load(); }, [load]);

  // Live "time remaining" ticker.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = schedule ? Date.parse(schedule.deadline) - now : 0;
  const sessions = schedule?.plan?.sessions ?? [];
  const current = schedule && sessions.length ? sessions[Math.min(schedule.session_index, sessions.length - 1)] : null;

  const view = useMemo(() => {
    if (!schedule || !current) return null;
    const workLeftThisSessionMs =
      schedule.status === "running" && schedule.work_started_at
        ? Math.max(0, current.workSeconds * 1000 - (now - Date.parse(schedule.work_started_at)))
        : current.workSeconds * 1000;
    return {
      workLeft: fmtClock(workLeftThisSessionMs),
      nextBreak: current.breakSeconds > 0 ? fmtClock(current.breakSeconds * 1000) : "none (final session)",
      completion: schedule.plan?.estimatedCompletionMs ? new Date(schedule.plan.estimatedCompletionMs).toLocaleString() : "—",
    };
  }, [schedule, current, now]);

  async function act(action: string) {
    if (!schedule) return;
    setBusy(true);
    try {
      const res = await fetch("/api/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule_id: schedule.id, action }),
      });
      const json = await res.json();
      if (res.ok) setSchedule(json.data.schedule);
      else toast("error", json.error || "Could not update the schedule.");
    } catch {
      toast("error", "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function createPlan(e: React.FormEvent) {
    e.preventDefault();
    if (!dueLocal) {
      toast("error", "Pick a due date and time first.");
      return;
    }
    setPlanning(true);
    try {
      const dueIso = new Date(dueLocal).toISOString();
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: assignmentId,
          due_at: dueIso,
          urgency,
          estimated_work_minutes: estimate ? Number(estimate) : undefined,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setSchedule(json.data.schedule);
        if (json.data.workload_basis) {
          toast("info", "Workload estimated: " + json.data.workload_basis.join(" · "));
        }
        toast("success", json.data.schedule.plan?.feasible ? "Schedule saved." : "Schedule saved — with a feasibility warning.");
      } else {
        toast("error", json.error || "Could not plan the schedule.");
      }
    } catch {
      toast("error", "Could not reach the server.");
    } finally {
      setPlanning(false);
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-ink-soft"><Spinner className="h-4 w-4" /> Loading your schedule…</div>;
  }

  if (!schedule) {
    return (
      <form onSubmit={createPlan} className="space-y-3">
        <p className="text-sm text-ink-soft">
          Set a deadline and Sophira will plan work sessions with breaks (breaks are always at least 10 seconds,
          at most 6 hours, and shrink as the deadline gets tight). If you don&apos;t give an estimate, one is
          estimated from the assignment and shown to you.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="due">Due date &amp; time</Label>
            <Input id="due" type="datetime-local" className="mt-1.5" value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="urgency">Urgency</Label>
            <Select id="urgency" className="mt-1.5" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              <option value="relaxed">Relaxed — plenty of time</option>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent — minimal breaks</option>
              <option value="extreme">Extreme — no breaks if possible</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="estimate">Est. minutes (optional)</Label>
            <Input id="estimate" type="number" min={1} max={600} className="mt-1.5" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="Sophira estimates" />
          </div>
        </div>
        <Button type="submit" disabled={planning}>{planning ? <Spinner className="h-4 w-4" /> : <><CalendarClock className="mr-1.5 h-4 w-4" /> Plan the schedule</>}</Button>
      </form>
    );
  }

  const p = schedule.plan;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={remainingMs > 24 * 3600000 ? "neutral" : remainingMs > 3600000 ? "accent" : "warn"}>
          <CalendarClock className="mr-1 h-3 w-3" /> Due {new Date(schedule.deadline).toLocaleString()} — {fmtRemaining(remainingMs)} left
        </Badge>
        <Badge tone={schedule.status === "running" ? "success" : schedule.status === "paused" ? "warn" : schedule.status === "done" ? "success" : "neutral"}>
          {schedule.status === "running" ? "Working" : schedule.status === "paused" ? "Paused" : schedule.status === "done" ? "Done" : "Planned"}
        </Badge>
        <Badge tone="neutral">~{schedule.estimated_work_minutes} min of work · urgency: {schedule.urgency}</Badge>
      </div>

      {p?.feasible === false && p.warning && (
        <p className="flex items-start gap-2 rounded-lg bg-danger/10 p-3 text-sm text-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span><strong>This assignment can&apos;t realistically finish in time.</strong> {p.warning}</span>
        </p>
      )}

      {view && (
        <ul className="space-y-1 text-sm text-ink">
          <li>Next work session: {view.workLeft} of work{schedule.session_index > 0 ? ` (session ${schedule.session_index + 1} of ${sessions.length})` : ""}</li>
          <li>Next break: {view.nextBreak}</li>
          <li>Estimated completion: {view.completion}</li>
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {schedule.status === "running" ? (
          <Button size="sm" variant="secondary" onClick={() => act("pause")} disabled={busy}>
            <Pause className="h-3.5 w-3.5" /> Pause work
          </Button>
        ) : schedule.status !== "done" ? (
          <Button size="sm" onClick={() => act(schedule.status === "paused" ? "resume" : "start")} disabled={busy}>
            <Play className="h-3.5 w-3.5" /> {schedule.status === "paused" ? "Resume work" : "Start work session"}
          </Button>
        ) : null}
        {schedule.status !== "done" && schedule.session_index < sessions.length - 1 && (
          <Button size="sm" variant="ghost" onClick={() => act("next_session")} disabled={busy}>
            <SkipForward className="h-3.5 w-3.5" /> Move to next session
          </Button>
        )}
        {schedule.status !== "done" && (
          <Button size="sm" variant="ghost" onClick={() => act("complete")} disabled={busy}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Mark done
          </Button>
        )}
      </div>
      <p className="text-xs text-ink-soft">
        The schedule controls work/break sessions; paced writing separately reveals finished text at your calibrated speed during active work.
      </p>
    </div>
  );
}
