/**
 * PERSISTENT SCHEDULE EXECUTION STATE MACHINE (2026-10-05).
 *
 * Server-side execution state on TOP of the existing deadline scheduler
 * (src/lib/scheduler.ts — planSchedule, clampBreak, the 10-second minimum
 * and 6-hour maximum break bounds are ALL unchanged and still the only
 * place break durations are computed).
 *
 * States: WORKING → BREAK_PENDING → BREAKING → NEXT_WORK_SESSION → …
 *         PAUSED (from WORKING or BREAKING, frozen)
 *         COMPLETED / FAILED (terminal)
 *
 * HONESTY CONTRACT — no background computing:
 *   There is no timer, worker or AI running while the app is closed.
 *   The machine is TIMESTAMP-driven: every state lives in the database
 *   (schedule_executions), and on reconnect `reconcileExecution`
 *   deterministically replays what the PERSISTED SCHEDULE says happened
 *   (a work session that ended while away consumed its planned work; a
 *   break that elapsed was taken). It never claims work was done that
 *   was not scheduled, and it never restarts a schedule mid-session.
 *
 * Pure functions only — offline-testable with an injected clock (spec §34).
 */

import { clampBreak, MIN_BREAK_SECONDS, MAX_BREAK_SECONDS, type SchedulePlan, type Urgency } from "./scheduler";

export type ExecutionState =
  | "WORKING"
  | "BREAK_PENDING"
  | "BREAKING"
  | "NEXT_WORK_SESSION"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED";

export const TERMINAL_STATES: ExecutionState[] = ["COMPLETED", "FAILED"];
export const LIVE_STATES: ExecutionState[] = [
  "WORKING", "BREAK_PENDING", "BREAKING", "NEXT_WORK_SESSION", "PAUSED",
];

export interface PlanSession {
  startMs: number;
  workSeconds: number;
  breakSeconds: number;
}

/** The persisted row (migration 0017). */
export interface ExecutionRow {
  id: string;
  user_id: string;
  assignment_id: string;
  schedule_id: string;
  state: ExecutionState;
  session_index: number;
  started_at: string | null;
  expected_end_at: string | null;
  break_started_at: string | null;
  break_end_at: string | null;
  paused_at: string | null;
  paused_from: ExecutionState | null;
  current_session_remaining_seconds: number;
  accumulated_work_time: number;
  accumulated_break_time: number;
  remaining_work: number;
  deadline: string;
  urgency: string;
  schedule_version: number;
  completed_at: string | null;
  failure_reason: string;
}

export type ExecutionAction =
  | "start"
  | "pause"
  | "resume"
  | "begin_break"
  | "end_break"
  | "next_session"
  | "complete";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function planSessionsOf(plan: unknown): PlanSession[] {
  const p = plan as { sessions?: unknown };
  if (!p || !Array.isArray(p.sessions)) return [];
  return p.sessions.filter(
    (s): s is PlanSession =>
      !!s && typeof s === "object" &&
      typeof (s as PlanSession).workSeconds === "number" &&
      typeof (s as PlanSession).breakSeconds === "number" &&
      typeof (s as PlanSession).startMs === "number"
  );
}

export const totalWorkSeconds = (sessions: PlanSession[]): number =>
  sessions.reduce((n, s) => n + s.workSeconds, 0);

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (v: string | null | undefined) => (v ? Date.parse(v) : NaN);
const elapsedSec = (fromMs: number, toMs: number) => Math.max(0, (toMs - fromMs) / 1000);

/** The break window for a session — re-asserts the existing 10s–6h bounds. */
export function breakWindowFor(session: PlanSession, startMs: number): { start: string; end: string; seconds: number } {
  const seconds = clampBreak(session.breakSeconds); // existing bounds, defensively re-applied
  return { start: iso(startMs), end: iso(startMs + seconds * 1000), seconds };
}

export function isTerminal(state: ExecutionState): boolean {
  return TERMINAL_STATES.includes(state);
}

/* ------------------------------------------------------------------ */
/* Creation                                                            */
/* ------------------------------------------------------------------ */

export function createExecutionRow(input: {
  id: string;
  user_id: string;
  assignment_id: string;
  schedule_id: string;
  deadline: string;
  urgency: string;
  plan: unknown;
}): ExecutionRow {
  const sessions = planSessionsOf(input.plan);
  const total = totalWorkSeconds(sessions);
  return {
    id: input.id,
    user_id: input.user_id,
    assignment_id: input.assignment_id,
    schedule_id: input.schedule_id,
    state: sessions.length === 0 ? "COMPLETED" : "NEXT_WORK_SESSION",
    session_index: 0,
    started_at: null,
    expected_end_at: null,
    break_started_at: null,
    break_end_at: null,
    paused_at: null,
    paused_from: null,
    current_session_remaining_seconds: sessions[0]?.workSeconds ?? 0,
    accumulated_work_time: 0,
    accumulated_break_time: 0,
    remaining_work: total,
    deadline: input.deadline,
    urgency: input.urgency,
    schedule_version: 1,
    completed_at: sessions.length === 0 ? new Date().toISOString() : null,
    failure_reason: "",
  };
}

/* ------------------------------------------------------------------ */
/* Reconciliation — the reconnect/refresh path (no background computing) */
/* ------------------------------------------------------------------ */

export interface ReconcileResult {
  row: ExecutionRow;
  /** Deterministic change log — non-empty means state was restored. */
  changes: string[];
  explanation: string;
}

/**
 * Replays the persisted schedule against `nowMs`. Deterministic and
 * idempotent: reconciling twice changes nothing the second time, and
 * PAUSED time never advances anything (paused_at is the freeze point).
 * Crossing a boundary while away consumes ONLY what the persisted plan
 * scheduled — being away 5 hours mid-session counts at most the session's
 * planned minutes, never the wall-clock gap.
 */
export function reconcileExecution(row: ExecutionRow, plan: unknown, nowMs: number): ReconcileResult {
  const sessions = planSessionsOf(plan);
  const changes: string[] = [];
  let r: ExecutionRow = { ...row };

  if (isTerminal(r.state)) {
    return { row: r, changes, explanation: r.state === "FAILED" ? r.failure_reason : "Completed — nothing to reconcile." };
  }
  if (sessions.length === 0) {
    r.state = "FAILED";
    r.failure_reason = "The persisted schedule has no sessions — the execution cannot continue.";
    changes.push("no sessions in the persisted plan — execution FAILED honestly");
    return { row: r, changes, explanation: r.failure_reason };
  }

  // PAUSED is frozen: reconnecting changes nothing until an explicit resume.
  if (r.state === "PAUSED") {
    return { row: r, changes, explanation: "Paused — the schedule is frozen at the pause point; resume to continue." };
  }

  // 1. Replay boundary crossings one at a time (bounded by session count).
  for (let guard = 0; guard < sessions.length + 2; guard++) {
    if (r.state === "WORKING") {
      const end = ms(r.expected_end_at);
      const session = sessions[Math.min(r.session_index, sessions.length - 1)];
      if (Number.isFinite(end) && nowMs >= end) {
        // The work session completed while away (or exactly now).
        const worked = session.workSeconds; // a completed session consumes its planned work — never the wall-clock gap
        r.accumulated_work_time += worked;
        r.current_session_remaining_seconds = 0;
        changes.push(`work session ${r.session_index + 1} completed at ${iso(end)} (${worked / 60} min of planned work consumed)`);
        if (session.breakSeconds > 0) {
          const w = breakWindowFor(session, end);
          r.state = "BREAKING";
          r.break_started_at = w.start;
          r.break_end_at = w.end;
          changes.push(`break began at ${w.start} per the persisted schedule (${w.seconds / 60} min)`);
        } else if (r.session_index >= sessions.length - 1) {
          r.state = "COMPLETED";
          r.completed_at = iso(end);
          r.remaining_work = 0;
          changes.push("final session completed — COMPLETED");
        } else {
          r.session_index += 1;
          r.current_session_remaining_seconds = sessions[r.session_index].workSeconds;
          r.state = "NEXT_WORK_SESSION";
          changes.push("moved to the next work session");
        }
        continue;
      }
      break;
    }
    if (r.state === "BREAKING") {
      const end = ms(r.break_end_at);
      const session = sessions[Math.min(r.session_index, sessions.length - 1)];
      if (Number.isFinite(end) && nowMs >= end) {
        r.accumulated_break_time += clampBreak(session.breakSeconds);
        changes.push(`break ended at ${iso(end)} (${clampBreak(session.breakSeconds)} min taken per the persisted schedule)`);
        r.break_started_at = null;
        r.break_end_at = null;
        if (r.session_index >= sessions.length - 1) {
          r.state = "COMPLETED"; // defensive: plans give the last session no break
          r.completed_at = iso(end);
          r.remaining_work = 0;
        } else {
          r.session_index += 1;
          r.current_session_remaining_seconds = sessions[r.session_index].workSeconds;
          r.state = "NEXT_WORK_SESSION";
          changes.push("next work session is ready");
        }
        continue;
      }
      break;
    }
    break; // NEXT_WORK_SESSION / BREAK_PENDING wait for explicit actions
  }

  // 2. Remaining work stays honest: planned total minus what was worked.
  const total = totalWorkSeconds(sessions);
  r.remaining_work = Math.max(0, total - r.accumulated_work_time);

  // 3. Deadline check LAST — completing on time is not a failure even if
  //    the user only reconnects after the deadline.
  const deadlineMs = ms(r.deadline);
  if (!isTerminal(r.state) && Number.isFinite(deadlineMs) && nowMs >= deadlineMs) {
    if (r.remaining_work > 0) {
      r.state = "FAILED";
      r.failure_reason = `The deadline passed with ${Math.ceil(r.remaining_work / 60)} minutes of planned work remaining.`;
      changes.push(r.failure_reason);
    }
  }

  const explanation = changes.length
    ? `Restored from the persisted schedule: ${changes.join("; ")}.`
    : "State restored exactly as persisted — the schedule is where you left it (no background computing happens while the app is closed).";
  return { row: r, changes, explanation };
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export interface ActionOutcome {
  row: ExecutionRow;
  error: string | null;
  explanation: string;
  changes: string[];
}

/**
 * Applies ONE user action. Invalid or duplicate transitions are REJECTED
 * with an honest error and an unchanged state (duplicate work sessions
 * are impossible by construction: `start` while WORKING fails).
 */
export function applyExecutionAction(
  row: ExecutionRow,
  action: ExecutionAction,
  plan: unknown,
  nowMs: number
): ActionOutcome {
  // Reconcile first — actions apply to the CURRENT truth, not stale rows.
  const rec = reconcileExecution(row, plan, nowMs);
  let r: ExecutionRow = { ...rec.row };
  const changes = [...rec.changes];
  const reject = (msg: string): ActionOutcome => ({
    row, error: msg, explanation: `Nothing changed: ${msg}`, changes,
  });

  const sessions = planSessionsOf(plan);
  const session = sessions.length ? sessions[Math.min(r.session_index, sessions.length - 1)] : null;

  switch (action) {
    case "start": {
      if (r.state === "WORKING") {
        return reject("a work session is already running — duplicate work sessions are prevented");
      }
      if (isTerminal(r.state)) return reject("this schedule execution has already ended");
      if (r.state === "BREAKING") return reject("finish the break (or skip it) before starting work");
      if (r.state === "PAUSED") return reject("use resume — the schedule is paused");
      if (!session) return reject("no sessions in the persisted plan");
      const workSec = r.state === "BREAK_PENDING"
        ? Math.max(0, r.current_session_remaining_seconds) // resumed early-ended session remainder
        : session.workSeconds;
      r.state = "WORKING";
      r.started_at = iso(nowMs);
      r.expected_end_at = iso(nowMs + workSec * 1000);
      r.current_session_remaining_seconds = workSec;
      changes.push(`work session ${r.session_index + 1} started at ${r.started_at} (${Math.round(workSec / 60)} min planned)`);
      break;
    }
    case "pause": {
      if (r.state !== "WORKING" && r.state !== "BREAKING") {
        return reject("only an active work session or break can be paused");
      }
      // Freeze bookkeeping at the pause point.
      if (r.state === "WORKING") {
        const started = ms(r.started_at);
        const worked = Number.isFinite(started)
          ? Math.min(r.current_session_remaining_seconds, elapsedSec(started, nowMs))
          : 0;
        r.accumulated_work_time += Math.round(worked);
        r.current_session_remaining_seconds = Math.max(0, r.current_session_remaining_seconds - Math.round(worked));
        changes.push(`paused mid-session — ${Math.round(worked / 60)} min worked so far, ${Math.round(r.current_session_remaining_seconds / 60)} min left in this session`);
      } else {
        const bStart = ms(r.break_started_at);
        const taken = Number.isFinite(bStart) ? Math.min(clampBreak(session?.breakSeconds ?? 0), elapsedSec(bStart, nowMs)) : 0;
        r.accumulated_break_time += Math.round(taken);
        changes.push(`paused mid-break — ${Math.round(taken)}s of break taken so far`);
      }
      r.paused_from = r.state;
      r.paused_at = iso(nowMs);
      r.state = "PAUSED";
      break;
    }
    case "resume": {
      if (r.state !== "PAUSED") return reject("the schedule is not paused");
      const pAt = ms(r.paused_at);
      const pausedMs = Number.isFinite(pAt) ? Math.max(0, nowMs - pAt) : 0;
      const back = r.paused_from === "BREAKING" ? "BREAKING" : "WORKING";
      if (back === "WORKING") {
        // Shift the session window by the pause duration: paused time is
        // NEVER counted as work. started_at moves so elapsed stays honest.
        const started = ms(r.started_at);
        if (Number.isFinite(started)) r.started_at = iso(started + pausedMs);
        const end = ms(r.expected_end_at);
        if (Number.isFinite(end)) r.expected_end_at = iso(end + pausedMs);
        changes.push(`resumed work after ${(pausedMs / 60000).toFixed(1)} min of pause — the session window shifted, pause time is not work time`);
      } else {
        const bStart = ms(r.break_started_at);
        if (Number.isFinite(bStart)) r.break_started_at = iso(bStart + pausedMs);
        const bEnd = ms(r.break_end_at);
        if (Number.isFinite(bEnd)) r.break_end_at = iso(bEnd + pausedMs);
        changes.push(`resumed the break after ${(pausedMs / 60000).toFixed(1)} min of pause — the break window shifted`);
      }
      r.state = back;
      r.paused_at = null;
      r.paused_from = null;
      break;
    }
    case "begin_break": {
      if (r.state === "BREAKING") return reject("a break is already running");
      if (r.state !== "BREAK_PENDING" && r.state !== "WORKING") {
        return reject("a break can only begin after the current work session (or from a pending break)");
      }
      if (r.state === "WORKING") {
        // Early end of the work session: count what was actually worked.
        const started = ms(r.started_at);
        const worked = Number.isFinite(started)
          ? Math.min(r.current_session_remaining_seconds, elapsedSec(started, nowMs))
          : 0;
        r.accumulated_work_time += Math.round(worked);
        r.current_session_remaining_seconds = Math.max(0, r.current_session_remaining_seconds - Math.round(worked));
        changes.push(`work session ended early — ${Math.round(worked / 60)} min worked, ${Math.round(r.current_session_remaining_seconds / 60)} min resume later`);
        r.state = "BREAK_PENDING";
      }
      if (!session) return reject("no sessions in the persisted plan");
      const w = breakWindowFor(session, nowMs);
      r.state = "BREAKING";
      r.break_started_at = w.start;
      r.break_end_at = w.end;
      changes.push(`break started at ${w.start}, persistently scheduled to end at ${w.end} (${w.seconds / 60} min — bounded ${MIN_BREAK_SECONDS}s–${MAX_BREAK_SECONDS / 3600}h)`);
      break;
    }
    case "end_break": {
      if (r.state !== "BREAKING") return reject("no break is running");
      const bStart = ms(r.break_started_at);
      const planned = clampBreak(session?.breakSeconds ?? 0);
      const taken = Number.isFinite(bStart) ? Math.min(planned, elapsedSec(bStart, nowMs)) : 0;
      r.accumulated_break_time += Math.round(taken);
      r.break_started_at = null;
      r.break_end_at = null;
      changes.push(`break ended at ${iso(nowMs)} — ${Math.round(taken)}s taken (early end recorded honestly)`);
      if (r.session_index >= sessions.length - 1) {
        r.state = "COMPLETED";
        r.completed_at = iso(nowMs);
        r.remaining_work = Math.max(0, totalWorkSeconds(sessions) - r.accumulated_work_time);
      } else {
        r.session_index += 1;
        r.current_session_remaining_seconds = sessions[r.session_index].workSeconds;
        r.state = "NEXT_WORK_SESSION";
      }
      break;
    }
    case "next_session": {
      if (isTerminal(r.state)) return reject("this schedule execution has already ended");
      if (r.state === "WORKING") return reject("finish or pause the work session before skipping to the next one");
      if (r.state === "BREAKING") {
        const bStart = ms(r.break_started_at);
        const planned = clampBreak(session?.breakSeconds ?? 0);
        const taken = Number.isFinite(bStart) ? Math.min(planned, elapsedSec(bStart, nowMs)) : 0;
        r.accumulated_break_time += Math.round(taken);
        changes.push(`break skipped early — ${Math.round(taken)}s taken`);
        r.break_started_at = null;
        r.break_end_at = null;
      }
      // The session's un-worked remainder is NOT counted as work — it is
      // skipped, and remaining_work keeps showing the truth.
      const total = totalWorkSeconds(sessions);
      r.remaining_work = Math.max(0, total - r.accumulated_work_time);
      if (r.session_index >= sessions.length - 1) {
        r.state = "COMPLETED";
        r.completed_at = iso(nowMs);
        changes.push("skipped past the final session — COMPLETED");
      } else {
        r.session_index += 1;
        r.current_session_remaining_seconds = sessions[r.session_index].workSeconds;
        r.state = "NEXT_WORK_SESSION";
        changes.push(`moved to work session ${r.session_index + 1}`);
      }
      break;
    }
    case "complete": {
      if (isTerminal(r.state)) return reject("this schedule execution has already ended");
      r.state = "COMPLETED";
      r.completed_at = iso(nowMs);
      r.remaining_work = Math.max(0, totalWorkSeconds(sessions) - r.accumulated_work_time);
      changes.push("marked COMPLETED by the user");
      break;
    }
    default:
      return reject("unknown action");
  }

  return { row: r, error: null, explanation: changes.join("; "), changes };
}

/* ------------------------------------------------------------------ */
/* Re-planning (deadline changes)                                      */
/* ------------------------------------------------------------------ */

/**
 * Adapts a LIVE execution to a re-planned schedule (deadline moved,
 * urgency changed, new estimate). The scheduling calculations are the
 * UNCHANGED planSchedule; this only re-bases the execution onto the new
 * plan: schedule_version bumps, accumulated history is preserved, the
 * state is kept and re-reconciled, and the next work session uses the
 * new plan's durations. The schedule NEVER restarts from zero.
 */
export function replanExecution(
  row: ExecutionRow,
  newPlan: unknown,
  newDeadlineIso: string,
  newUrgency: string,
  nowMs: number
): { row: ExecutionRow; changes: string[]; explanation: string } {
  const sessions = planSessionsOf(newPlan);
  const changes: string[] = [];
  if (isTerminal(row.state)) {
    return { row, changes, explanation: "The execution has ended — the new plan applies to any future start." };
  }
  const total = totalWorkSeconds(sessions);
  const next: ExecutionRow = {
    ...row,
    deadline: newDeadlineIso,
    urgency: newUrgency,
    schedule_version: row.schedule_version + 1,
    remaining_work: Math.max(0, total - row.accumulated_work_time),
  };
  // Clamp the cursor into the new plan and re-base the next session.
  next.session_index = Math.min(row.session_index, Math.max(0, sessions.length - 1));
  next.current_session_remaining_seconds = sessions[next.session_index]?.workSeconds ?? 0;
  if (next.state === "WORKING") {
    // Keep the CURRENT session running on its persisted window; the next
    // session uses the new plan. Reconciliation handles the boundary.
    changes.push(`re-planned to schedule v${next.schedule_version} — the active work session window is preserved, following sessions use the new plan`);
  } else {
    changes.push(`re-planned to schedule v${next.schedule_version} — state "${next.state}" preserved, next session uses the new plan`);
  }
  const rec = reconcileExecution(next, newPlan, nowMs);
  return { row: rec.row, changes: [...changes, ...rec.changes], explanation: changes.join("; ") + (rec.changes.length ? `; ${rec.changes.join("; ")}` : "") };
}

/* ------------------------------------------------------------------ */
/* The view the UI renders (honest, derived, never fabricated)         */
/* ------------------------------------------------------------------ */

export interface ExecutionView {
  state: ExecutionState;
  stateLabel: string;
  sessionNumber: number;
  totalSessions: number;
  /** ms of work left in the current session (0 when not working). */
  workLeftInSessionMs: number;
  /** ms until the persisted break ends (0 when not breaking). */
  breakLeftMs: number;
  accumulatedWorkMinutes: number;
  accumulatedBreakMinutes: number;
  remainingWorkMinutes: number;
  scheduleVersion: number;
  deadlineIso: string;
  urgency: string;
  failureReason: string | null;
  /** Always true — stated so the UI never implies background computing. */
  noBackgroundComputing: true;
}

export function executionView(row: ExecutionRow, plan: unknown, nowMs: number): ExecutionView {
  const sessions = planSessionsOf(plan);
  const session = sessions.length ? sessions[Math.min(row.session_index, sessions.length - 1)] : null;
  let workLeftMs = 0;
  let breakLeftMs = 0;
  if (row.state === "WORKING") {
    const end = ms(row.expected_end_at);
    workLeftMs = Number.isFinite(end) ? Math.max(0, end - nowMs) : 0;
  }
  if (row.state === "BREAKING") {
    const end = ms(row.break_end_at);
    breakLeftMs = Number.isFinite(end) ? Math.max(0, end - nowMs) : 0;
  }
  const labels: Record<ExecutionState, string> = {
    WORKING: "Working",
    BREAK_PENDING: "Break pending",
    BREAKING: "On break",
    NEXT_WORK_SESSION: "Next work session ready",
    PAUSED: "Paused",
    COMPLETED: "Completed",
    FAILED: "Failed — deadline passed",
  };
  const extraWork = row.state === "WORKING"
    ? Math.min(row.current_session_remaining_seconds, elapsedSec(ms(row.started_at), nowMs))
    : 0;
  return {
    state: row.state,
    stateLabel: labels[row.state],
    sessionNumber: Math.min(row.session_index + 1, Math.max(1, sessions.length)),
    totalSessions: sessions.length,
    workLeftInSessionMs: Math.round(workLeftMs),
    breakLeftMs: Math.round(breakLeftMs),
    accumulatedWorkMinutes: Math.round((row.accumulated_work_time + extraWork) / 60),
    accumulatedBreakMinutes: Math.round(row.accumulated_break_time / 60),
    remainingWorkMinutes: Math.ceil(row.remaining_work / 60),
    scheduleVersion: row.schedule_version,
    deadlineIso: row.deadline,
    urgency: row.urgency,
    failureReason: row.state === "FAILED" ? row.failure_reason : null,
    noBackgroundComputing: true,
  };
}
