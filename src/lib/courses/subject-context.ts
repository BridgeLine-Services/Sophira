import type { SupabaseClient } from "@supabase/supabase-js";
import { subjectBySlug } from "@/lib/courses/engines";

/**
 * SUBJECT PROMPT CONTEXT (gap-closure 2026-10-10): when a shared tool is
 * opened from a SUBJECT workspace (no specific course), the AI must not
 * silently operate as an unscoped generic tool. This resolves the subject
 * slug to an honest prompt context: the subject label, its engine
 * description, and — for Foreign Language — the user's saved language
 * preference. Invalid slugs resolve to "" (never invented).
 */
export async function subjectPromptContext(
  supabase: SupabaseClient,
  userId: string,
  slug: string | null | undefined
): Promise<string> {
  if (!slug) return "";
  const node = subjectBySlug(slug);
  if (!node) return "";
  let context = `\nSubject: ${node.label} — work is for this subject's coursework.`;
  // SCIENCE REASONING (2026-10-10 audit): the Science parent and its
  // children carry explicit scientific-reasoning expectations, mirrored
  // from the real workflow definitions in lib/ai/subjects.ts — the SAME
  // AI backend, no separate model is claimed or used.
  if (slug === "science" || slug.startsWith("science/")) {
    context += ` Apply scientific reasoning: identify knowns/unknowns and assumptions, use correct scientific terminology and units, distinguish established fact from inference, and never fabricate observations, data, or sources.`;
    if (slug === "science/physics" || slug === "science/chemistry") {
      context += ` Show substitutions with units and check dimensional consistency; sanity-check magnitudes.`;
    }
  }
  if (slug === "foreign-language") {
    const { data: pref } = await supabase
      .from("subject_preferences")
      .select("target_language, explanation_language, proficiency")
      .eq("user_id", userId)
      .eq("subject", "foreign-language")
      .maybeSingle();
    if (pref) {
      const bits = [
        pref.target_language ? `target language: ${pref.target_language}` : null,
        pref.explanation_language ? `explanations in ${pref.explanation_language}` : null,
        pref.proficiency ? `proficiency: ${pref.proficiency}` : null,
      ].filter(Boolean);
      if (bits.length) context += ` The student's language setup — ${bits.join(", ")}.`;
    }
  }
  return context;
}
