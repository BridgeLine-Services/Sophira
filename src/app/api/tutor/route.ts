import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { AiNotConfiguredError, aiChat, aiConfigured } from "@/lib/ai/client";
import { AI_NOT_CONFIGURED_MESSAGE } from "@/lib/ai/provider";
import { loadAcademicContext, contextPrompt } from "@/lib/ai/academic-context";
import { classifyEngine } from "@/lib/courses/engines";
import { evaluateInformationRequest } from "@/lib/research/policy";

/** Phase 2F (2026-11-09): wording-level boundary BEFORE any model call.
 *  Prompt text is not enforcement - this runs in code on every request. */
function screenRequest(text: string): { message: string; alternative?: string; code: string } | null {
  const d = evaluateInformationRequest(text);
  return d.blocked ? { message: d.message, alternative: d.alternative, code: d.code } : null;
}


export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * SUBJECT AI ENGINE (Biology / Chemistry / Physics / Humanities /
 * Programming / General): one shared AI service, specialized per course.
 * The engine retrieves ONLY the signed-in student's own course context and
 * materials — RLS enforces isolation; nothing crosses users or subjects.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  if (!aiConfigured()) {
    return NextResponse.json(
      { error: AI_NOT_CONFIGURED_MESSAGE },
      { status: 503 }
    );
  }

  let body: { question?: string; course_id?: string | null; subject?: string | null; teacher_id?: string | null; assignment_id?: string | null } = {};
  try { body = await request.json(); } catch { /* empty */ }
  const question = (body.question ?? "").trim();
  if (!question) return NextResponse.json({ error: "Ask a question about this subject." }, { status: 400 });
  const screen = screenRequest(question);
  if (screen) return NextResponse.json({ error: screen.message + (screen.alternative ? " " + screen.alternative : ""), blocked: true, code: screen.code }, { status: 422 });

  const enginePrompts: Record<string, string> = {
    biology: "You are a biology tutor. Help with concepts, terminology, processes, experiments, and diagrams (describe them in text).",
    chemistry: "You are a chemistry tutor. Help with concepts, reactions, formulas, equations, calculations, and laboratory concepts.",
    physics: "You are a physics tutor. Help with concepts, formulas, units, calculations, and step-by-step explanations.",
    humanities: "You are a history and social-science tutor. Help with historical analysis, chronology, source evaluation, and social-science concepts.",
    programming: "You are a programming tutor. Explain code, help debug, review code, and teach algorithms. Preserve code formatting in fenced blocks, keep examples learning-oriented, and never just hand over an answer the student is supposed to produce themselves without explaining the concepts behind it.",
    general: "You are a general academic tutor for the subject named in the course context.",
  };

  let courseContext = "";
  let engine: string = "general";
  let courseSubject: string | null = null;
  if (body.course_id) {
    const { data: course } = await supabase.from("courses").select("name, subject, academic_level, instructions").eq("id", body.course_id).single();
    if (course) {
      courseSubject = course.subject ?? null;
      engine = classifyEngine(course.subject);
      courseContext = `Course: ${course.name}. Subject: ${course.subject ?? "unspecified"}. Level: ${course.academic_level ?? "unspecified"}.${course.instructions ? ` Course instructions: ${course.instructions.slice(0, 2000)}` : ""}`;
    }
  }
  const { data: profile } = await supabase.from("profiles").select("explanation_level, preferred_language").eq("id", guard.data.user.id).single();

  // PHASE 2 (2026-11-13): the tutor now sees the same student the main solver sees.
  // Before this it retrieved no memory, no learning patterns and no teacher rules at
  // all, so the same student got a personalised answer in one screen and a generic one
  // here. Scope-filtered, relevance-capped, and read with the student's own id.
  const academic = await loadAcademicContext(supabase, guard.data.user.id, {
    mode: "tutor",
    subject: courseSubject ?? body.subject ?? null,
    courseId: body.course_id ?? null,
    teacherId: body.teacher_id ?? null,
    assignmentId: body.assignment_id ?? null,
  });

  try {
    const answer = await aiChat([
      { role: "system", content: `${enginePrompts[engine] ?? enginePrompts.general} ${courseContext} Adapt explanations to a ${profile?.explanation_level ?? "standard"} level${profile?.preferred_language ? `, in ${profile.preferred_language}` : ""}. If something cannot be known from the given material, say so honestly instead of inventing facts.${contextPrompt(academic)}` },
      { role: "user", content: question },
    ]);
    return NextResponse.json({ data: { answer } });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: "The AI provider is unavailable right now. Try again in a moment." }, { status: 503 });
    }
    return NextResponse.json({ error: "The tutor could not answer. Try again." }, { status: 500 });
  }
}
