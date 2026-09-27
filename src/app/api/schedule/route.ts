import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { planSchedule, type Urgency } from "@/lib/scheduler";
import { estimateWorkMinutes, parseEstimatedWorkMinutes } from "@/lib/workload";
import type { Mode } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Deadline-aware work/break scheduling (spec §11) on top of the existing
 * deterministic scheduler (src/lib/scheduler.ts — never a random delay).
 *
 *  POST  /api/schedule  { assignment_id, due_at, estimated_work_minutes?, urgency? }
 *        → plans with the SERVER clock, persists one work_schedule per
 *          assignment (re-planning replaces it), and stores the deadline
 *          on the assignment itself. Timezone-safe: due_at is ISO-8601 UTC.
 *  GET   /api/schedule?assignment_id=…
 *        → the persisted schedule (or null).
 *  PATCH /api/schedule  { schedule_id, action: start|pause|resume|next_session|complete }
 *        → session control; the plan itself never changes while running.
 *
 * All rows are RLS-scoped to the requesting user (migration 0010).
 */

const URGENCIES: Urgency[] = ["relaxed", "normal", "urgent", "extreme"];

function badAction(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  let body: {
    assignment_id?: string;
    due_at?: string;
    estimated_work_minutes?: number;
    urgency?: string;
    word_count_target?: number;
    requires_research?: boolean;
    has_rubric?: boolean;
    source_count?: number;
  };
  try {
    body = await request.json();
  } catch {
    return badAction("Invalid request body.");
  }

  const assignmentId = (body.assignment_id || "").trim();
  if (!assignmentId) return badAction("Missing assignment id.");

  const dueMs = Date.parse(body.due_at || "");
  if (!Number.isFinite(dueMs)) {
    return badAction("Please provide a valid due date and time.");
  }
  const urgency: Urgency = URGENCIES.includes(body.urgency as Urgency) ? (body.urgency as Urgency) : "normal";

  // The assignment must belong to the user (RLS enforces the filter anyway).
  const { data: assignment, error: aErr } = await supabase
    .from("assignments")
    .select("id, mode, task_type, output_type, instructions_text")
    .eq("id", assignmentId)
    .single();
  if (aErr || !assignment) return badAction("Assignment not found.", 404);

  // Workload: the user's own estimate always wins; otherwise estimate.
  let workMinutes = parseEstimatedWorkMinutes(body.estimated_work_minutes);
  let basis: string[] | null = null;
  if (workMinutes === null) {
    const est = estimateWorkMinutes({
      mode: assignment.mode as Mode,
      task_type: assignment.task_type,
      output_type: assignment.output_type,
      word_count_target: body.word_count_target ?? null,
      requires_research: body.requires_research,
      has_rubric: body.has_rubric,
      source_count: body.source_count ?? null,
    });
    workMinutes = est.minutes;
    basis = est.basis;
  }

  // Plan with the SERVER clock; breaks are hard-bounded [10s, 6h] and the
  // plan is deterministic — never a random delay.
  const plan = planSchedule({
    nowMs: Date.now(),
    deadlineMs: dueMs,
    estimatedWorkMinutes: workMinutes,
    urgency,
  });

  const { data: schedule, error: sErr } = await supabase
    .from("work_schedules")
    .upsert(
      {
        user_id: user.id,
        assignment_id: assignmentId,
        deadline: new Date(dueMs).toISOString(),
        urgency,
        estimated_work_minutes: workMinutes,
        plan,
        status: "planned",
        session_index: 0,
        work_started_at: null,
        paused_at: null,
      },
      { onConflict: "assignment_id" }
    )
    .select()
    .single();
  if (sErr || !schedule) return badAction("Could not save the schedule: " + (sErr?.message ?? "unknown error"), 500);

  const { error: updErr } = await supabase
    .from("assignments")
    .update({
      due_at: new Date(dueMs).toISOString(),
      estimated_work_minutes: workMinutes,
      urgency,
    })
    .eq("id", assignmentId);
  if (updErr) return badAction("Schedule saved, but the assignment deadline could not be updated: " + updErr.message, 500);

  return NextResponse.json({ data: { schedule, workload_basis: basis } });
}

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const assignmentId = request.nextUrl.searchParams.get("assignment_id");
  if (!assignmentId) return badAction("Missing assignment id.");

  const { data: schedule } = await supabase
    .from("work_schedules")
    .select("*")
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  return NextResponse.json({ data: { schedule: schedule ?? null } });
}

export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  let body: { schedule_id?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return badAction("Invalid request body.");
  }
  const id = (body.schedule_id || "").trim();
  const action = body.action || "";
  if (!id) return badAction("Missing schedule id.");

  const { data: schedule, error } = await supabase.from("work_schedules").select("*").eq("id", id).single();
  if (error || !schedule) return badAction("Schedule not found.", 404);

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  const plan = schedule.plan as { sessions?: unknown[] };
  const sessionCount = Array.isArray(plan?.sessions) ? plan.sessions.length : 0;

  switch (action) {
    case "start":
      patch.status = "running";
      patch.work_started_at = nowIso;
      patch.paused_at = null;
      break;
    case "pause":
      patch.status = "paused";
      patch.paused_at = nowIso;
      break;
    case "resume":
      patch.status = "running";
      patch.paused_at = null;
      break;
    case "next_session":
      patch.session_index = Math.min(schedule.session_index + 1, Math.max(0, sessionCount - 1));
      break;
    case "complete":
      patch.status = "done";
      break;
    default:
      return badAction("Unknown action. Use start, pause, resume, next_session, or complete.");
  }

  const { data: updated, error: uErr } = await supabase
    .from("work_schedules")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (uErr || !updated) return badAction("Could not update the schedule: " + (uErr?.message ?? "unknown error"), 500);
  return NextResponse.json({ data: { schedule: updated } });
}
