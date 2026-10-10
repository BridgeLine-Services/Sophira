import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { subjectPromptContext } from "@/lib/courses/subject-context";
import { AiNotConfiguredError, aiChat, aiConfigured, parseJsonLoose } from "@/lib/ai/client";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * MATH TEST PREPARATION ENGINE: reviews relevant concepts, builds a study
 * plan, and prepares the student for an exam using THEIR selected topics and
 * materials. It never claims a guaranteed score and never fabricates material
 * the student did not provide.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  if (!aiConfigured()) {
    return NextResponse.json({ error: "AI is not configured yet. An administrator needs to set the OPENAI_API_KEY environment variable." }, { status: 503 });
  }

  let body: { topics?: string; exam_date?: string | null; material_ids?: string[]; course_id?: string | null; subject?: string | null } = {};
  try { body = await request.json(); } catch { /* empty */ }
  const topics = (body.topics ?? "").trim();
  if (!topics && !(body.material_ids?.length)) {
    return NextResponse.json({ error: "Tell me the topics, or attach material from your Library, before I build a study plan." }, { status: 400 });
  }

  let materialText = "";
  if (body.material_ids?.length) {
    const { data } = await supabase.from("study_materials").select("title, content").in("id", body.material_ids);
    materialText = (data ?? []).map((m) => `--- ${m.title || "untitled"} ---\n${(m.content ?? "").slice(0, 6000)}`).join("\n\n").slice(0, 18000);
  }
  let courseContext = "";
  if (body.course_id) {
    const { data: course } = await supabase.from("courses").select("name, subject, academic_level").eq("id", body.course_id).single();
    if (course) courseContext = ` Course: ${course.name} (${course.subject ?? "math"}, ${course.academic_level ?? "unspecified level"}).`;
  }
  // Subject workspace context: test preparation honors the selected subject.
  if (!body.course_id) {
    courseContext += await subjectPromptContext(supabase, guard.data.user.id, body.subject);
  }

  try {
    const raw = await aiChat([
      { role: "system", content: `You are a math test-preparation tutor. Build an honest, realistic study plan from the student's stated topics and their own materials. Base concept review ONLY on the topics and material given — if a topic is not covered by the material, say the student should gather material for it rather than inventing content. Never promise a score or outcome.${courseContext}` },
      { role: "user", content: `Help me prepare for a math exam.${body.exam_date ? ` The exam is on ${body.exam_date}.` : ""}\nTopics: ${topics || "(derive from the attached material)"}\n${materialText ? `My materials:\n${materialText}` : ""}\n\nReturn ONLY JSON: {"concepts": [{"concept": "name", "review": "2-3 sentence review based on the given topics/material"}], "study_plan": [{"session": 1, "focus": "what to cover", "activities": "what to actually do"}], "priority": "the single most important thing to study first and why", "weak_spots": "honest note about what could not be assessed from the given information (never invented)"}` },
    ], { jsonMode: true });

    const parsed = parseJsonLoose<{ concepts?: { concept: string; review?: string }[]; study_plan?: { session: number; focus?: string; activities?: string }[]; priority?: string; weak_spots?: string }>(raw);
    if (!parsed) return NextResponse.json({ error: "The AI response could not be parsed. Try again." }, { status: 502 });
    return NextResponse.json({ data: parsed });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: "The AI provider is unavailable right now. Try again in a moment." }, { status: 503 });
    return NextResponse.json({ error: "Test preparation failed unexpectedly. Try again." }, { status: 500 });
  }
}
