import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { AiNotConfiguredError, aiChat, aiConfigured, parseJsonLoose } from "@/lib/ai/client";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * PLANNING ENGINE: helps the student plan an assignment WITHOUT completing
 * it. The response contains steps, outline points, research questions, a
 * checklist — and never a finished draft of the assignment.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "AI is not configured yet. An administrator needs to set the OPENAI_API_KEY environment variable." },
      { status: 503 }
    );
  }

  let body: { instructions?: string; topic?: string; deadline?: string | null; course_id?: string | null } = {};
  try { body = await request.json(); } catch { /* empty */ }
  const instructions = (body.instructions ?? "").trim();
  const topic = (body.topic ?? "").trim();
  if (!instructions && !topic) {
    return NextResponse.json({ error: "Give me the assignment instructions or at least a topic before I plan it." }, { status: 400 });
  }

  let courseContext = "";
  let materials = "";
  if (body.course_id) {
    const { data: course } = await supabase.from("courses").select("name, subject, academic_level, instructions").eq("id", body.course_id).single();
    if (course) courseContext = `\nCourse: ${course.name} (${course.subject ?? "unspecified"}, ${course.academic_level ?? "unspecified level"}).${course.instructions ? `\nCourse instructions: ${course.instructions}` : ""}`;
    const { data: docs } = await supabase
      .from("study_materials")
      .select("title, content")
      .eq("course_id", body.course_id)
      .order("created_at", { ascending: false })
      .limit(3);
    if (docs?.length) materials = `\nRelevant saved materials the student provided: ${docs.map((d) => (d.title || "untitled").slice(0, 80)).join(", ")}.`;
  }

  try {
    const raw = await aiChat([
      { role: "system", content: `You are a PLANNING assistant. You help the student understand and organize an assignment. You NEVER write the assignment, any section of it, or any finished prose. No draft paragraphs, no model answers, no quotable sentences — only planning material: steps, outline points, research questions, evidence to gather, and a completion checklist. If asked to write the assignment, refuse and return to planning.${courseContext}${materials}` },
      { role: "user", content: `Help me plan this assignment. Return ONLY JSON: {"understanding": "what the assignment is actually asking, 1-2 sentences, honestly flagging anything ambiguous", "steps": [{"step": 1, "title": "short step name", "detail": "what to do in this step, planning guidance only"}], "outline": ["outline point 1", "..."], "research_questions": ["question 1", "..."], "evidence_needed": ["what evidence or sources to gather", "..."], "checklist": ["checkbox item", "..."]}. Keep it practical and specific to the instructions.\n\nInstructions: ${instructions || "(none provided)"}\nTopic: ${topic || "(none provided)"}${body.deadline ? `\nDeadline: ${body.deadline}` : ""}` },
    ], { jsonMode: true });

    const parsed = parseJsonLoose<{ understanding?: string; steps?: { step: number; title: string; detail?: string }[]; outline?: string[]; research_questions?: string[]; evidence_needed?: string[]; checklist?: string[] }>(raw);
    if (!parsed) return NextResponse.json({ error: "The AI response could not be parsed. Try again — nothing was saved." }, { status: 502 });
    return NextResponse.json({ data: parsed });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: "The AI provider is unavailable right now. Try again in a moment." }, { status: 503 });
    }
    return NextResponse.json({ error: "Planning failed unexpectedly. Nothing was saved." }, { status: 500 });
  }
}
