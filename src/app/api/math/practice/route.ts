import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { subjectPromptContext } from "@/lib/courses/subject-context";
import { AiNotConfiguredError, aiChat, aiConfigured, parseJsonLoose } from "@/lib/ai/client";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * MATH PRACTICE ENGINE: generates practice problems from material the
 * student provides (their own notes, worksheets, textbooks, study guides).
 * Two modes:
 *  - "generate": create problems in the style of the provided material
 *  - "check": feedback on the student's own attempt, then targeted follow-ups
 * Answers are returned but the UI lets the student attempt first.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  if (!aiConfigured()) return NextResponse.json({ error: "AI is not configured yet. An administrator needs to set the OPENAI_API_KEY environment variable." }, { status: 503 });

  let body: {
    mode?: "generate" | "check";
    topic?: string;
    count?: number;
    material_ids?: string[];
    course_id?: string | null;
    subject?: string | null;
    problem?: string;
    student_answer?: string;
    past_problems?: string[];
  } = {};
  try { body = await request.json(); } catch { /* empty */ }

  if (body.mode === "check") {
    if (!body.problem || !body.student_answer) {
      return NextResponse.json({ error: "Give me the problem and your attempt before I check it." }, { status: 400 });
    }
    try {
      const raw = await aiChat([
        { role: "system", content: "You are a math practice tutor checking a student's OWN attempt. Judge the attempt fairly and honestly — do not inflate. Point to the exact step where it went wrong (if it did), explain the correct approach, and suggest one targeted follow-up problem on the demonstrated weakness. Verify arithmetic carefully before concluding." },
        { role: "user", content: `Problem: ${body.problem}\nStudent's attempt: ${body.student_answer}\n\nReturn ONLY JSON: {"correct": true|false, "where": "the exact step where it went wrong, or where it is correct", "explanation": "clear explanation of the correct approach", "follow_up": "one similar practice problem targeting the demonstrated weakness, solvable with the same method"}` },
      ], { jsonMode: true });
      const parsed = parseJsonLoose<{ correct?: boolean; where?: string; explanation?: string; follow_up?: string }>(raw);
      if (!parsed) return NextResponse.json({ error: "The AI response could not be parsed. Try again." }, { status: 502 });
      return NextResponse.json({ data: parsed });
    } catch (e) {
      if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: "The AI provider is unavailable right now. Try again in a moment." }, { status: 503 });
      return NextResponse.json({ error: "Checking failed unexpectedly. Try again." }, { status: 500 });
    }
  }

  // generate mode
  const count = Math.min(Math.max(body.count ?? 5, 1), 10);
  let materialText = "";
  if (body.material_ids?.length) {
    const { data } = await supabase.from("study_materials").select("title, content").in("id", body.material_ids);
    materialText = (data ?? []).map((m) => `--- ${m.title || "untitled"} ---\n${(m.content ?? "").slice(0, 7000)}`).join("\n\n").slice(0, 20000);
  }
  if (!materialText && !body.topic) {
    return NextResponse.json({ error: "Attach material from your Library, or name a topic, before I generate practice problems." }, { status: 400 });
  }
  let courseContext = "";
  if (body.course_id) {
    const { data: course } = await supabase.from("courses").select("name, subject, academic_level").eq("id", body.course_id).single();
    if (course) courseContext = ` Course: ${course.name} (${course.subject ?? "math"}, ${course.academic_level ?? "unspecified level"}).`;
  }
  // Subject workspace context: practice honors the selected subject.
  if (!body.course_id) {
    courseContext += await subjectPromptContext(supabase, guard.data.user.id, body.subject);
  }

  try {
    const past = body.past_problems?.length ? `\nDo not repeat these earlier problems: ${body.past_problems.slice(-15).join(" | ")}` : "";
    const raw = await aiChat([
      { role: "system", content: `You generate math practice problems in the style and difficulty of the student's own material. Problems must be ORIGINAL (not copied from the material), solvable with the methods it covers, and have exact worked answers. ${courseContext}${past}` },
      { role: "user", content: `${materialText ? `Base the problems on this material:\n${materialText}` : `Topic: ${body.topic}`}\n\nGenerate exactly ${count} practice problem(s). Return ONLY JSON: {"problems": [{"id": 1, "problem": "the problem statement", "answer": "the exact final answer", "steps": ["worked solution steps, concise"], "concept": "the concept being practiced"}]}` },
    ], { jsonMode: true });
    const parsed = parseJsonLoose<{ problems?: { id: number; problem?: string; answer?: string; steps?: string[]; concept?: string }[] }>(raw);
    if (!parsed || !parsed.problems?.length) return NextResponse.json({ error: "The AI response could not be parsed. Try again." }, { status: 502 });
    return NextResponse.json({ data: { problems: parsed.problems.filter((p) => p.problem && p.answer) } });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: "The AI provider is unavailable right now. Try again in a moment." }, { status: 503 });
    return NextResponse.json({ error: "Generating practice problems failed. Try again." }, { status: 500 });
  }
}
