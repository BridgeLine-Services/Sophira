import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { flagDisabledMessage, flagEnabled } from "@/lib/features/flags";
import { idempotencyKey, runView, type RunRequest } from "@/lib/essay/autonomous";
import { createRun, listRuns } from "@/lib/essay/run-store";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/essay/autonomous — start an autonomous assignment run.
 *
 * This is the ONLY way a run is created. It does not draft anything: it records the request and
 * returns the run, because claiming a draft exists before a token has been generated is exactly
 * the lie the directive forbids (Part 4.4). The client — or a scheduled sweep — then calls
 * /advance once per step.
 *
 * The manual workflow (POST /api/essay/plan, POST /api/essay/draft-section) is a different path
 * and is not modified by this route.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  if (!flagEnabled("autonomous_essay")) {
    return NextResponse.json({ error: flagDisabledMessage("autonomous_essay"), flag: "autonomous_essay" }, { status: 503 });
  }

  let body: {
    question?: string; title?: string | null; genre?: string | null;
    course_id?: string | null; subject?: string | null; teacher_id?: string | null;
    assignment_id?: string | null; research_project_id?: string | null; deadline?: string | null;
  };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const question = (body.question || "").trim();
  if (!question) return NextResponse.json({ error: "Describe the assignment first." }, { status: 400 });
  if (question.length > 8000) return NextResponse.json({ error: "That assignment description is too long to work with." }, { status: 400 });

  // Ownership is checked before a run exists: a course, teacher or assignment that is not the
  // signed-in student's is not a run this student can start.
  if (body.course_id) {
    const { data } = await supabase.from("courses").select("id").eq("id", body.course_id).eq("user_id", user.id).maybeSingle();
    if (!data) return NextResponse.json({ error: "That course is not in your list." }, { status: 400 });
  }
  if (body.teacher_id) {
    const { data } = await supabase.from("teachers").select("id").eq("id", body.teacher_id).eq("user_id", user.id).is("archived_at", null).maybeSingle();
    if (!data) return NextResponse.json({ error: "That teacher is not in your list." }, { status: 400 });
  }
  if (body.assignment_id) {
    const { data } = await supabase.from("assignments").select("id").eq("id", body.assignment_id).eq("user_id", user.id).maybeSingle();
    if (!data) return NextResponse.json({ error: "That assignment is not in your list." }, { status: 400 });
  }
  if (body.research_project_id) {
    const { data } = await supabase.from("research_projects").select("id").eq("id", body.research_project_id).eq("user_id", user.id).maybeSingle();
    if (!data) return NextResponse.json({ error: "That research project is not in your list." }, { status: 400 });
  }

  const runRequest: RunRequest = {
    question,
    title: body.title ?? null,
    genre: body.genre ?? null,
    courseId: body.course_id ?? null,
    subject: body.subject ?? null,
    teacherId: body.teacher_id ?? null,
    assignmentId: body.assignment_id ?? null,
    researchProjectId: body.research_project_id ?? null,
    deadline: body.deadline ?? null,
  };

  const nowMs = Date.now();
  const key = idempotencyKey(runRequest);
  const outcome = await createRun(supabase, user.id, runRequest, key, nowMs);

  if (outcome.error) {
    return NextResponse.json({ error: "The assignment run could not be started." }, { status: 500 });
  }
  if (outcome.existing) {
    // A second click must not start a second run (and never a second draft).
    return NextResponse.json({ data: { run: runView(outcome.existing, nowMs), duplicate: true } });
  }
  if (!outcome.record) {
    return NextResponse.json({ error: "The assignment run could not be started." }, { status: 500 });
  }
  return NextResponse.json({ data: { run: runView(outcome.record, nowMs), duplicate: false } }, { status: 201 });
}

/** GET /api/essay/autonomous — this student's runs, newest first. */
export async function GET() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const rows = await listRuns(supabase, guard.data.user.id, 20);
  const nowMs = Date.now();
  return NextResponse.json({
    data: {
      runs: rows.map((r) => runView(r, nowMs)),
      flag: { enabled: flagEnabled("autonomous_essay") },
    },
  });
}
