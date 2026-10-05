import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import {
  applyExecutionAction, createExecutionRow, executionView, isTerminal,
  reconcileExecution, type ExecutionAction, type ExecutionRow,
} from "@/lib/schedule-execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PERSISTENT SCHEDULE EXECUTION STATE MACHINE (2026-10-05).
 *
 *   GET   /api/schedule/executions?assignment_id=…
 *         → RESTORE: reconciles the persisted state against the server
 *           clock (refresh, browser close, reconnect — no progress lost,
 *           no incorrect restart) and returns the state + view.
 *   POST  /api/schedule/executions { assignment_id }
 *         → START: creates the execution from the persisted plan and
 *           begins the first work session. If a live execution already
 *           exists it is RECONCILED AND RETURNED (already_active: true) —
 *           duplicate work sessions are prevented here AND by a partial
 *           unique index (migration 0017).
 *   PATCH /api/schedule/executions { execution_id, action }
 *         → start | pause | resume | begin_break | end_break |
 *           next_session | complete. Every transition is validated by
 *           the pure state machine (src/lib/schedule-execution.ts) and
 *           persisted server-side.
 *
 * HONESTY: nothing computes while the app is closed. State is restored
 * from persisted timestamps on reconnect — the response says so.
 */

const ACTIONS: ExecutionAction[] = ["start", "pause", "resume", "begin_break", "end_break", "next_session", "complete"];
const LIVE_FILTER = ["WORKING", "BREAK_PENDING", "BREAKING", "NEXT_WORK_SESSION", "PAUSED"];

const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

async function loadSchedule(supabase: ReturnType<typeof createClient>, assignmentId: string, userId: string) {
  const { data: schedule } = await supabase
    .from("work_schedules")
    .select("*")
    .eq("assignment_id", assignmentId)
    .eq("user_id", userId)
    .maybeSingle();
  return schedule ?? null;
}

/** Persist a reconciled/actioned row; returns the fresh DB row. */
async function persistRow(supabase: ReturnType<typeof createClient>, row: ExecutionRow) {
  const { id, ...patch } = row;
  const { data: updated, error } = await supabase
    .from("schedule_executions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !updated) return null;
  return updated as ExecutionRow;
}

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  const assignmentId = request.nextUrl.searchParams.get("assignment_id");
  if (!assignmentId) return bad("Missing assignment id.");

  const schedule = await loadSchedule(supabase, assignmentId, user.id);
  const { data: live } = await supabase
    .from("schedule_executions")
    .select("*")
    .eq("assignment_id", assignmentId)
    .eq("user_id", user.id)
    .in("state", LIVE_FILTER)
    .order("updated_at", { ascending: false })
    .maybeSingle();

  if (!schedule || !live) {
    return NextResponse.json({ data: { execution: null, view: null, restored: false } });
  }

  // RESTORE: reconcile the persisted schedule against the server clock.
  const rec = reconcileExecution(live as ExecutionRow, schedule.plan, Date.now());
  let row = live as ExecutionRow;
  if (rec.changes.length > 0) {
    const saved = await persistRow(supabase, rec.row);
    if (saved) row = saved;
  }
  return NextResponse.json({
    data: {
      execution: row,
      view: executionView(row, schedule.plan, Date.now()),
      restored: rec.changes.length > 0,
      restore_explanation: rec.explanation,
      honesty_note: "Nothing computes while the app is closed — state is timestamped and restored on reconnect.",
    },
  });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  let body: { assignment_id?: string };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request body.");
  }
  const assignmentId = (body.assignment_id || "").trim();
  if (!assignmentId) return bad("Missing assignment id.");

  const schedule = await loadSchedule(supabase, assignmentId, user.id);
  if (!schedule) return bad("Plan a schedule for this assignment first (POST /api/schedule).", 404);

  // DUPLICATE PREVENTION: an existing live execution is reconciled and
  // returned as-is — a second work session is never created.
  const { data: live } = await supabase
    .from("schedule_executions")
    .select("*")
    .eq("assignment_id", assignmentId)
    .eq("user_id", user.id)
    .in("state", LIVE_FILTER)
    .order("updated_at", { ascending: false })
    .maybeSingle();

  if (live) {
    const rec = reconcileExecution(live as ExecutionRow, schedule.plan, Date.now());
    let row = live as ExecutionRow;
    if (rec.changes.length > 0) {
      const saved = await persistRow(supabase, rec.row);
      if (saved) row = saved;
    }
    return NextResponse.json({
      data: {
        execution: row,
        view: executionView(row, schedule.plan, Date.now()),
        already_active: true,
        message: "A work session already exists for this assignment — its state was restored, not duplicated.",
      },
    });
  }

  // Create the execution row from the persisted plan, then start session 1.
  const base = createExecutionRow({
    id: crypto.randomUUID(),
    user_id: user.id,
    assignment_id: assignmentId,
    schedule_id: schedule.id,
    deadline: schedule.deadline,
    urgency: schedule.urgency,
    plan: schedule.plan,
  });
  const started = applyExecutionAction(base, "start", schedule.plan, Date.now());
  if (started.error) return bad(started.error, 409);

  const { id, ...insert } = started.row;
  const { data: created, error } = await supabase
    .from("schedule_executions")
    .insert({ id, ...insert })
    .select("*")
    .single();
  if (error || !created) {
    // The partial unique index is the structural backstop under races.
    return bad("A live execution already exists for this assignment — reload to restore it.", 409);
  }
  return NextResponse.json({
    data: {
      execution: created as ExecutionRow,
      view: executionView(created as ExecutionRow, schedule.plan, Date.now()),
      already_active: false,
    },
  }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  let body: { execution_id?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request body.");
  }
  const id = (body.execution_id || "").trim();
  const action = body.action || "";
  if (!id || !ACTIONS.includes(action as ExecutionAction)) {
    return bad(`Missing execution id or valid action (${ACTIONS.join(", ")}).`);
  }

  const { data: row } = await supabase
    .from("schedule_executions")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!row) return bad("Execution not found.", 404);

  const schedule = await loadSchedule(supabase, (row as ExecutionRow).assignment_id, user.id);
  if (!schedule) return bad("The persisted schedule is gone — plan again.", 404);

  const outcome = applyExecutionAction(row as ExecutionRow, action as ExecutionAction, schedule.plan, Date.now());
  if (outcome.error) {
    return NextResponse.json({ error: outcome.error, data: { execution: row } }, { status: 409 });
  }

  const saved = await persistRow(supabase, outcome.row);
  if (!saved) return bad("Could not persist the new execution state.", 500);

  // Keep the legacy work_schedules status roughly in sync for older readers.
  const legacyStatus = isTerminal(outcome.row.state)
    ? "done"
    : outcome.row.state === "PAUSED" ? "paused" : "running";
  await supabase
    .from("work_schedules")
    .update({ status: legacyStatus, session_index: outcome.row.session_index })
    .eq("id", schedule.id)
    .then(() => undefined);

  return NextResponse.json({
    data: {
      execution: saved,
      view: executionView(saved, schedule.plan, Date.now()),
      explanation: outcome.explanation,
    },
  });
}
