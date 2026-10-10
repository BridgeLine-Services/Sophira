import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";

/**
 * Foreign Language preferences (nav spec): a functioning selector persisted
 * per the existing settings architecture — subject_preferences rows owned
 * by the authenticated user only (migration 0030, RLS enforced server-side).
 *
 *   GET  /api/preferences/foreign-language  → the caller's saved preference
 *   POST /api/preferences/foreign-language  → upsert the caller's preference
 */

const LANGUAGES = new Set([
  "Spanish", "French", "German", "Italian", "Portuguese", "Japanese",
  "Chinese (Mandarin)", "Korean", "Arabic", "Russian", "Latin", "American Sign Language",
]);
const PROFICIENCY = new Set(["Beginner", "Intermediate", "Advanced"]);

export async function GET() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { data } = await supabase
    .from("subject_preferences")
    .select("target_language, explanation_language, proficiency")
    .eq("user_id", guard.data.user.id)
    .eq("subject", "foreign-language")
    .maybeSingle();
  return NextResponse.json({ preference: data ?? null });
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  let body: { target_language?: string; explanation_language?: string; proficiency?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const target = typeof body.target_language === "string" ? body.target_language.trim() : null;
  const explanation = typeof body.explanation_language === "string" ? body.explanation_language.trim() : null;
  const proficiency = typeof body.proficiency === "string" ? body.proficiency.trim() : null;

  if (target && !LANGUAGES.has(target)) {
    return NextResponse.json({ error: "Unsupported target language." }, { status: 400 });
  }
  if (proficiency && !PROFICIENCY.has(proficiency)) {
    return NextResponse.json({ error: "Invalid proficiency level." }, { status: 400 });
  }
  if (explanation && explanation.length > 40) {
    return NextResponse.json({ error: "Invalid explanation language." }, { status: 400 });
  }
  if (!target && !explanation && !proficiency) {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("subject_preferences")
    .upsert(
      {
        user_id: guard.data.user.id,
        subject: "foreign-language",
        target_language: target,
        explanation_language: explanation,
        proficiency,
      },
      { onConflict: "user_id,subject" }
    )
    .select("target_language, explanation_language, proficiency")
    .single();

  if (error) {
    return NextResponse.json({ error: "Could not save the preference." }, { status: 500 });
  }
  return NextResponse.json({ preference: data });
}
