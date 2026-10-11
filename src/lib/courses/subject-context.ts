import type { SupabaseClient } from "@supabase/supabase-js";
import { subjectBySlug } from "@/lib/courses/engines";
import { selectRelevantMemories, RETRIEVABLE_STATUSES, type StudentMemory } from "@/lib/memory/engine";

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
  slug: string | null | undefined,
  opts: { courseId?: string | null } = {},
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
  // Shared course-aware memory: subject-scoped + course-scoped rows.
  context += await sharedMemoryContext(supabase, userId, slug, opts.courseId);
  return context;
}

/**
 * SHARED COURSE-AWARE MEMORY (2026-10-11): every subject workspace engine
 * (Essay, Short Writing, Planning, Grammar, Math practice/prepare) shares
 * the SAME memory system — subject-tagged and course-scoped student
 * memories from student_memories (RLS: strictly the authenticated user's
 * own rows). Retrieved here, relevance-selected and capped exactly like
 * the main assistant path (lib/memory/engine.ts), so an English essay and
 * the Grammar engine see the same English writing preferences, while a
 * Biology lab report never receives English-specific essay rules.
 */
export async function sharedMemoryContext(
  supabase: SupabaseClient,
  userId: string,
  slug: string | null | undefined,
  courseId?: string | null,
): Promise<string> {
  if (!slug) return "";
  const subject = slug.split("/").pop() || slug;
  const { data } = await supabase
    .from("student_memories")
    .select("id, user_id, category, statement, details, subject, subject_tags, course_id, confidence, status, improvement_trend, origin, source, first_observed, last_observed, last_used_at, created_at, updated_at")
    .eq("user_id", userId)
    .in("status", RETRIEVABLE_STATUSES);
  const memories = (data ?? []) as StudentMemory[];
  const selection = selectRelevantMemories(memories, { subject, courseId: courseId ?? null });
  if (selection.decisions.length === 0) return "";
  const nowISO = new Date().toISOString();
  await supabase
    .from("student_memories")
    .update({ last_used_at: nowISO })
    .in("id", selection.decisions.map((d) => d.id));
  return `\nShared subject memory (student-approved, relevance-selected):\n${selection.lines.join("\n")}`;
}
