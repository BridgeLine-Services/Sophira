import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { AiNotConfiguredError, aiChat, aiConfigured, parseJsonLoose } from "@/lib/ai/client";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GRAMMAR & SPELLING ENGINE: explains corrections and returns them
 * individually so the user can accept or reject each one. It preserves the
 * user's meaning and voice; it never rewrites the piece wholesale and it
 * never promises AI-detection bypass or misrepresents authorship.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const user = guard.data.user;

  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "AI is not configured yet. An administrator needs to set the OPENAI_API_KEY environment variable. Nothing was lost — your text was not changed." },
      { status: 503 }
    );
  }

  let body: { text?: string; course_id?: string | null } = {};
  try { body = await request.json(); } catch { /* empty */ }
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Paste or type the text you want checked." }, { status: 400 });
  if (text.length > 20000) return NextResponse.json({ error: "That text is too long for one check (20,000 characters max). Check it in parts." }, { status: 400 });

  let courseContext = "";
  if (body.course_id) {
    const { data: course } = await supabase.from("courses").select("name, subject, academic_level, instructions").eq("id", body.course_id).single();
    if (course) courseContext = `\nCourse: ${course.name} (${course.subject ?? "unspecified subject"}, ${course.academic_level ?? "unspecified level"}).`;
  }

  const { data: profile } = await supabase.from("profiles").select("explanation_level").eq("id", user.id).single();

  try {
    const raw = await aiChat([
      { role: "system", content: `You are a grammar, spelling, and clarity assistant for a student's OWN writing. Rules you must never break:
- Report each issue as a separate correction the student can accept or reject individually.
- NEVER rewrite the whole piece, NEVER change the student's meaning or voice, and NEVER add new content or claims.
- Explain each correction briefly so the student learns from it.
- If the text is already correct, return an empty list and say so honestly.
- Never claim or imply this helps bypass AI-detection or misrepresent authorship.${courseContext}` },
      { role: "user", content: `Check this text for grammar, spelling, punctuation, clarity, and sentence-structure issues. Return ONLY JSON: {"overall": "one short honest sentence about the writing", "corrections": [{"id": 1, "original": "exact text to replace", "suggestion": "corrected text", "kind": "grammar|spelling|punctuation|clarity|structure", "explanation": "why, one sentence"}]}. Order corrections by where they appear in the text. Each "original" must appear VERBATIM in the text — never invent text the student did not write.\n\n${text}` },
    ], { jsonMode: true });

    const parsed = parseJsonLoose<{ overall?: string; corrections?: { id: number; original: string; suggestion: string; kind?: string; explanation?: string }[] }>(raw);
    if (!parsed) return NextResponse.json({ error: "The AI response could not be parsed. Nothing was changed — try again." }, { status: 502 });

    // Verify every suggested "original" actually appears in the text (no invented quotes).
    const corrections = (parsed.corrections ?? []).filter((c) => c.original && c.suggestion && c.original !== c.suggestion && text.includes(c.original));

    return NextResponse.json({ data: { overall: parsed.overall ?? "", corrections } });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: "The AI provider is unavailable right now. Nothing was changed — try again in a moment." }, { status: 503 });
    }
    return NextResponse.json({ error: "The grammar check failed unexpectedly. Nothing was changed." }, { status: 500 });
  }
}
