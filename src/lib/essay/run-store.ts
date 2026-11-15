/**
 * AUTONOMOUS RUN STORAGE (2026-11-15).
 *
 * Every member-facing function here takes the USER-SCOPED Supabase client and filters by
 * `user_id` explicitly, so RLS is a second lock rather than the only one. There is exactly one
 * privileged function — `resumableRuns` — used by the scheduled sweep, and it is:
 *   - never imported by a member route,
 *   - matched by an explicit ownership check inside the runner before any write,
 *   - read-only by itself.
 *
 * The columns are the ones migration 0059 creates. Nothing is stored that the table does not
 * declare, and no provider key or token is ever written here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  newRun,
  type CapturedContext,
  type FinalVerification,
  type RunFinding,
  type RunRecord,
  type RunRequest,
  type RunSection,
  type RunState,
} from "./autonomous";

/** The row shape of public.assignment_runs. */
export interface RunRow {
  id: string;
  user_id: string;
  state: RunState;
  step_index: number;
  total_steps: number;
  attempt: number;
  max_attempts: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  plan: RunRecord["plan"];
  outline: RunRecord["outline"];
  outline_approved: boolean;
  sections: RunSection[];
  final_verification: FinalVerification | null;
  findings: RunFinding[];
  progress: { context?: CapturedContext | null } | null;
  request: RunRequest;
  last_error: string | null;
  completion_claim: string | null;
  deadline: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancelled_at: string | null;
  created_date: string;
  updated_date: string;
}

export function toRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    state: row.state,
    step_index: row.step_index ?? 0,
    total_steps: row.total_steps ?? 0,
    attempt: row.attempt ?? 0,
    max_attempts: row.max_attempts ?? 3,
    lease_token: row.lease_token,
    lease_expires_at: row.lease_expires_at,
    plan: row.plan ?? null,
    outline: Array.isArray(row.outline) ? row.outline : [],
    outline_approved: row.outline_approved === true,
    sections: Array.isArray(row.sections) ? row.sections : [],
    final_verification: row.final_verification ?? null,
    findings: Array.isArray(row.findings) ? row.findings : [],
    request: (row.request ?? { question: "" }) as RunRequest,
    context: row.progress?.context ?? null,
    last_error: row.last_error,
    completion_claim: row.completion_claim,
    deadline: row.deadline,
    started_at: row.started_at,
    finished_at: row.finished_at,
    cancelled_at: row.cancelled_at,
    created_date: row.created_date,
    updated_date: row.updated_date,
  };
}

export function toRowPatch(run: RunRecord): Record<string, unknown> {
  return {
    state: run.state,
    step_index: run.step_index,
    total_steps: run.total_steps,
    attempt: run.attempt,
    lease_token: run.lease_token,
    lease_expires_at: run.lease_expires_at,
    plan: run.plan,
    outline: run.outline,
    outline_approved: run.outline_approved,
    sections: run.sections,
    final_verification: run.final_verification,
    findings: run.findings,
    progress: { context: run.context ?? null },
    last_error: run.last_error,
    completion_claim: run.completion_claim,
    started_at: run.started_at,
    finished_at: run.finished_at,
    cancelled_at: run.cancelled_at,
    updated_date: new Date().toISOString(),
  };
}

const COLUMNS =
  "id, user_id, state, step_index, total_steps, attempt, max_attempts, lease_token, lease_expires_at, plan, outline, outline_approved, sections, final_verification, findings, progress, request, last_error, completion_claim, deadline, started_at, finished_at, cancelled_at, created_date, updated_date";

export async function loadRun(
  supabase: SupabaseClient,
  userId: string,
  runId: string,
): Promise<RunRecord | null> {
  const { data } = await supabase
    .from("assignment_runs")
    .select(COLUMNS)
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? toRecord(data as RunRow) : null;
}

export async function listRuns(
  supabase: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<RunRecord[]> {
  const { data } = await supabase
    .from("assignment_runs")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_date", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));
  return (data ?? []).map((r) => toRecord(r as RunRow));
}

export interface CreateOutcome {
  record: RunRecord | null;
  /** The live run that already exists for this request, if any. */
  existing: RunRecord | null;
  error: string | null;
}

/**
 * Create a run, or return the live one that already covers this request.
 * The unique partial index is what actually decides; this function only explains it.
 */
export async function createRun(
  supabase: SupabaseClient,
  userId: string,
  request: RunRequest,
  key: string,
  nowMs: number,
): Promise<CreateOutcome> {
  const draft = newRun({ id: "pending", userId, request, nowMs });
  const { data, error } = await supabase
    .from("assignment_runs")
    .insert({
      user_id: userId,
      assignment_id: request.assignmentId ?? null,
      course_id: request.courseId ?? null,
      teacher_id: request.teacherId ?? null,
      research_project_id: request.researchProjectId ?? null,
      idempotency_key: key,
      request,
      state: "queued",
      total_steps: draft.total_steps,
      deadline: request.deadline ?? null,
      started_at: new Date(nowMs).toISOString(),
    })
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    // 23505 = unique violation: a live run for this request already exists.
    if (error.code === "23505") {
      const { data: live } = await supabase
        .from("assignment_runs")
        .select(COLUMNS)
        .eq("user_id", userId)
        .eq("idempotency_key", key)
        .not("state", "in", "(cancelled,failed)")
        .maybeSingle();
      return { record: null, existing: live ? toRecord(live as RunRow) : null, error: null };
    }
    return { record: null, existing: null, error: error.message };
  }
  return { record: data ? toRecord(data as RunRow) : null, existing: null, error: null };
}

export async function saveRun(
  supabase: SupabaseClient,
  userId: string,
  run: RunRecord,
): Promise<string | null> {
  const { error } = await supabase
    .from("assignment_runs")
    .update(toRowPatch(run))
    .eq("id", run.id)
    .eq("user_id", userId);
  return error ? error.message : null;
}

/**
 * Try to become the single writer for this run.
 * A held, unexpired lease makes this a no-op — that is what stops a repeated callback from
 * generating a second copy of a section.
 */
export async function takeLease(
  supabase: SupabaseClient,
  userId: string,
  runId: string,
  token: string,
  nowIso: string,
  expiresIso: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("assignment_runs")
    .update({ lease_token: token, lease_expires_at: expiresIso })
    .eq("id", runId)
    .eq("user_id", userId)
    .not("state", "in", "(completed,cancelled,failed,blocked)")
    .or(`lease_token.is.null,lease_expires_at.lt.${nowIso}`)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

export async function releaseLease(
  supabase: SupabaseClient,
  userId: string,
  runId: string,
  token: string,
): Promise<void> {
  await supabase
    .from("assignment_runs")
    .update({ lease_token: null, lease_expires_at: null })
    .eq("id", runId)
    .eq("user_id", userId)
    .eq("lease_token", token);
}

/**
 * PRIVILEGED, server-only: which runs are live but unheld.
 *
 * Used by the scheduled sweep (POST /api/essay/autonomous/tick) and by nothing member-facing.
 * It never writes, and the caller must validate ownership before acting on any id — the runner
 * does, by filtering every write on the run's own `user_id`.
 */
export async function resumableRuns(
  admin: SupabaseClient,
  nowIso: string,
  limit = 5,
): Promise<{ id: string; user_id: string }[]> {
  const { data } = await admin
    .from("assignment_runs")
    .select("id, user_id")
    .not("state", "in", "(completed,cancelled,failed,blocked)")
    .or(`lease_token.is.null,lease_expires_at.lt.${nowIso}`)
    .order("created_date", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 25));
  return (data ?? []) as { id: string; user_id: string }[];
}

/** Aggregate counts for the Owner dashboard. Staff-only; never returns student text. */
export interface RunAggregate {
  queued: number;
  running: number;
  completed: number;
  blocked: number;
  failed: number;
  cancelled: number;
  averageSeconds: number | null;
  retries: number;
}

export async function aggregateRuns(
  supabase: SupabaseClient,
  limit = 200,
): Promise<RunAggregate> {
  const { data } = await supabase
    .from("assignment_runs")
    .select("state, attempt, started_at, finished_at")
    .order("created_date", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as { state: RunState; attempt: number; started_at: string | null; finished_at: string | null }[];
  const counts: RunAggregate = { queued: 0, running: 0, completed: 0, blocked: 0, failed: 0, cancelled: 0, averageSeconds: null, retries: 0 };
  const spans: number[] = [];
  for (const r of rows) {
    if (r.state === "queued") counts.queued += 1;
    else if (r.state === "completed") counts.completed += 1;
    else if (r.state === "blocked") counts.blocked += 1;
    else if (r.state === "failed") counts.failed += 1;
    else if (r.state === "cancelled") counts.cancelled += 1;
    else counts.running += 1;
    counts.retries += Math.max(0, (r.attempt ?? 0));
    if (r.started_at && r.finished_at) {
      const s = (Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000;
      if (Number.isFinite(s) && s >= 0) spans.push(s);
    }
  }
  if (spans.length) counts.averageSeconds = Math.round(spans.reduce((a, b) => a + b, 0) / spans.length);
  return counts;
}
