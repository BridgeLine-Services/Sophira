/**
 * SHARED ACADEMIC CONTEXT (2026-11-13, Phase 2).
 *
 * WHY THIS EXISTS
 * Every AI path must see the same student. The main solver already retrieves
 * course, teacher, approved writing profile, structured learning patterns and
 * scope-filtered long-term memory (src/app/api/ai/solve/route.ts). The other
 * paths did not:
 *
 *   - POST /api/tutor retrieved NONE of it (no memory, no patterns, no teacher).
 *   - POST /api/math/prepare and POST /api/writing/plan retrieved subject memory
 *     ONLY when no course was selected (`if (!body.course_id) subjectPromptContext(...)`),
 *     so selecting a course silently dropped the student's learning history at the
 *     exact moment the context was richest.
 *
 * This module assembles that context ONCE, for those paths, from the SAME
 * tables and the SAME pure selectors the solver uses. It extends the existing
 * system; it does not replace it, and the solver is deliberately left untouched.
 *
 * RULES BAKED IN
 *   1. Relevance, never a dump: memories and patterns are scope-filtered and
 *      capped exactly as the solver does (MAX_PROMPT_MEMORIES, PatternContext).
 *   2. Scope isolation: a memory or pattern tied to a different course, teacher
 *      or assignment is excluded, not merely down-ranked - the same rule as
 *      src/lib/memory/engine.ts and src/lib/learning/patterns.ts.
 *   3. Precedence: assignment requirements > teacher requirements > course
 *      requirements > approved student preferences. Stated in the prompt so the
 *      model cannot silently prefer a personal habit over a teacher's rule.
 *   4. Never a guess, never a crash: a failed read is skipped and reported in
 *      `degraded`; nothing is invented to fill the gap.
 *   5. Privacy: every read is filtered by the signed-in user's id, and RLS is
 *      still the authority behind that filter.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { closenessDirective, contextRegisterRules, parseWritingContext, type WritingContext } from "./writing-contexts";
import { loadApprovedProfile } from "./writing-profiles";
import {
  selectRelevantMemories,
  RETRIEVABLE_STATUSES,
  MAX_PROMPT_MEMORIES,
  type StudentMemory,
} from "@/lib/memory/engine";
import type { LearningPattern } from "@/lib/learning/patterns";
import { selectApplicablePatternsAdaptive } from "@/lib/learning/evidence";

/** The columns this module reads from `courses` (never more than it needs). */
export interface CourseRow {
  name?: string | null;
  subject?: string | null;
  academic_level?: string | null;
  instructions?: string | null;
  teacher_id?: string | null;
}

export interface AcademicContextRequest {
  /** AI mode or route name, used for relevance ranking and diagnostics. */
  mode: string;
  subject?: string | null;
  courseId?: string | null;
  teacherId?: string | null;
  assignmentId?: string | null;
  taskType?: string | null;
  /** Approved writing profile applies to writing work only. */
  isWritingTask?: boolean;
  /**
   * WHICH kind of writing (2026-11-13, directive Part 5). Unset means academic, which is
   * what migration 0058 made every existing profile, so every current caller keeps its
   * behaviour without changing.
   */
  writingContext?: string | null;
}

export interface AcademicContextResult {
  /** Ordered prompt sections. Empty when there is genuinely nothing to add. */
  sections: string[];
  /** Memory ids actually used (caller records last_used_at like the solver does). */
  memoryIds: string[];
  patternTitles: string[];
  /** Human-readable reasons a source contributed nothing. Never leaks secrets. */
  degraded: string[];
  /** Which writing context's profile was considered (directive Part 5). */
  writingContext?: string;
  /** The closeness setting applied to it, 0-100. */
  writingCloseness?: number;
}

export const MAX_CONTEXT_CHARS = 4000;
export const MAX_PATTERNS = 5;
const MAX_COURSE_CHARS = 800;
const MAX_TEACHER_CHARS = 900;
const MAX_PROFILE_CHARS = 600;
const MAX_PATTERN_CHARS = 200;

const AUTHORITY_LINE =
  "ORDER OF AUTHORITY for this answer (never silently resolve a conflict - follow the higher rule AND tell the student about the conflict): " +
  "1. the current assignment's own instructions; 2. this course's teacher requirements/rubric; 3. course requirements; " +
  "4. approved student preferences and learning history. A teacher's rule always beats a student habit.";

function clip(text: string | null | undefined, max: number): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Assemble the academic context for one AI request.
 * Reads are sequential (a handful of indexed, user-filtered rows) and each is
 * isolated: one failing table degrades that section only.
 */
export async function loadAcademicContext(
  supabase: SupabaseClient,
  userId: string,
  req: AcademicContextRequest,
): Promise<AcademicContextResult> {
  const sections: string[] = [];
  const degraded: string[] = [];
  const memoryIds: string[] = [];
  const patternTitles: string[] = [];
  const initialContext: WritingContext = parseWritingContext(req.writingContext);
  let writingContext: WritingContext = initialContext;
  let writingCloseness = 70;
  if (!userId) return { sections, memoryIds, patternTitles, degraded: ["no signed-in student"], writingContext, writingCloseness };

  const subject = (req.subject ?? "").split("/").pop() || (req.subject ?? "") || null;
  let courseId = req.courseId ?? null;
  let teacherId = req.teacherId ?? null;
  let courseRow: CourseRow | null = null;

  // --- course + its teacher ------------------------------------------------
  if (courseId) {
    try {
      const { data, error } = await supabase
        .from("courses")
        .select("name, subject, academic_level, instructions, teacher_id")
        .eq("id", courseId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) degraded.push("course details were unavailable");
      courseRow = (data as CourseRow | null) ?? null;
      if (courseRow) {
        const bits = [
          courseRow.name ? `Course: ${courseRow.name}` : null,
          courseRow.subject ? `subject: ${courseRow.subject}` : null,
          courseRow.academic_level ? `level: ${courseRow.academic_level}` : null,
        ].filter(Boolean);
        let line = bits.join(", ");
        if (courseRow.instructions) line += `. Course instructions: ${clip(courseRow.instructions, MAX_COURSE_CHARS)}`;
        if (line) sections.push(line);
        if (!teacherId && courseRow.teacher_id) teacherId = courseRow.teacher_id;
      }
    } catch {
      degraded.push("course details were unavailable");
    }
  } else {
    courseId = null;
  }

  // --- this course's teacher requirements ----------------------------------
  if (teacherId) {
    try {
      const { data: teacher } = await supabase
        .from("teachers")
        .select("name")
        .eq("id", teacherId)
        .eq("user_id", userId)
        .maybeSingle();
      const { data: profile, error } = await supabase
        .from("teacher_profiles")
        .select("required_methods, required_steps, preferred_notation, units_sig_figs, formatting_requirements, citation_requirements, essay_structure")
        .eq("teacher_id", teacherId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) degraded.push("teacher requirements were unavailable");
      const p = (profile ?? {}) as Record<string, string | null>;
      const rules = [
        p.required_methods ? `required methods: ${clip(p.required_methods, MAX_TEACHER_CHARS)}` : null,
        p.required_steps ? `required steps: ${clip(p.required_steps, MAX_TEACHER_CHARS)}` : null,
        p.preferred_notation ? `notation: ${clip(p.preferred_notation, MAX_TEACHER_CHARS)}` : null,
        p.units_sig_figs ? `units/significant figures: ${clip(p.units_sig_figs, MAX_TEACHER_CHARS)}` : null,
        p.formatting_requirements ? `formatting: ${clip(p.formatting_requirements, MAX_TEACHER_CHARS)}` : null,
        p.citation_requirements ? `citations: ${clip(p.citation_requirements, MAX_TEACHER_CHARS)}` : null,
        p.essay_structure ? `essay structure: ${clip(p.essay_structure, MAX_TEACHER_CHARS)}` : null,
      ].filter(Boolean);
      const who = (teacher as { name?: string } | null)?.name;
      if (rules.length) sections.push(`Teacher requirements${who ? ` (${who})` : ""} - these override the student's own habits: ${rules.join("; ")}`);
    } catch {
      degraded.push("teacher requirements were unavailable");
    }
  } else {
    teacherId = null;
  }

  // --- approved writing profile, writing tasks only ------------------------
  // 2026-11-13 (directive Part 5): the profile is chosen BY CONTEXT, so a casual piece
  // never inherits academic habits, and the student's closeness dial decides whether the
  // guidance is applied at all and how strongly. The register rules for the context are
  // stated either way, because they describe the kind of document, not the student.
  if (req.isWritingTask) {
    try {
      const loaded = await loadApprovedProfile(supabase, userId, writingContext);
      writingContext = loaded.context;
      const decision = closenessDirective(loaded.profile ? loaded.profile.style_closeness : 70);
      writingCloseness = decision.closeness;
      degraded.push(...loaded.degraded);
      const guidance = clip(loaded.profile?.guidance, MAX_PROFILE_CHARS);
      if (guidance && decision.applyGuidance) {
        sections.push(
          `Approved ${writingContext} writing preferences (apply where they do not conflict with the assignment, this course's teacher requirements, or the register rules below): ${guidance}`,
        );
      }
      sections.push(
        `How closely to follow the student's own habits: ${decision.directive} Register rules for ${writingContext} writing - these hold regardless of that setting: ${contextRegisterRules(writingContext).join(" ")}`,
      );
    } catch {
      degraded.push("the approved writing profile was unavailable");
    }
  }

  const patternContext = {
    subject,
    course_id: courseId,
    teacher_id: teacherId,
    assignment_id: req.assignmentId ?? null,
    task_type: req.taskType ?? null,
  };

  // --- structured learning patterns (misconceptions, habits) ---------------
  try {
    const { data, error } = await supabase
      .from("learning_patterns")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["candidate", "active", "recurring", "temporary", "teacher_required"]);
    if (error) degraded.push("learning patterns were unavailable");
    const patterns = (data ?? []) as LearningPattern[];
    const applicable = selectApplicablePatternsAdaptive(patterns, patternContext).slice(0, MAX_PATTERNS);
    if (applicable.length) {
      const lines = applicable.map((p) => {
        patternTitles.push(p.description);
        const label = p.intentional ? "established (student kept this deliberately)" : p.status;
        return `- [${p.kind}, ${label}] ${clip(p.description, MAX_PATTERN_CHARS)}`;
      });
      sections.push(`Known learning patterns for this scope (evidence-based, not facts about the student's character):\n${lines.join("\n")}`);
    }
  } catch {
    degraded.push("learning patterns were unavailable");
  }

  // --- long-term memory, scope-filtered and capped --------------------------
  try {
    const { data, error } = await supabase
      .from("student_memories")
      .select("id, user_id, category, statement, details, subject, subject_tags, course_id, teacher_id, assignment_id, confidence, status, improvement_trend, origin, source, first_observed, last_observed, last_used_at, created_at, updated_at")
      .eq("user_id", userId)
      .in("status", RETRIEVABLE_STATUSES);
    if (error) degraded.push("the student's learning memory was unavailable");
    const memories = (data ?? []) as StudentMemory[];
    const selection = selectRelevantMemories(memories, {
      subject,
      task_type: req.taskType ?? null,
      mode: req.mode,
      courseId,
      teacherId,
      assignmentId: req.assignmentId ?? null,
    });
    if (selection.decisions.length) {
      for (const d of selection.decisions) memoryIds.push(d.id);
      sections.push(`What this student has shown before, in this scope only (student-approved, relevance-selected, max ${MAX_PROMPT_MEMORIES}):\n${selection.lines.join("\n")}`);
    }
  } catch {
    degraded.push("the student's learning memory was unavailable");
  }

  if (memoryIds.length) {
    try {
      await supabase
        .from("student_memories")
        .update({ last_used_at: new Date().toISOString() })
        .in("id", memoryIds)
        .eq("user_id", userId);
    } catch {
      /* usage bookkeeping is not worth failing an answer over */
    }
  }

  return { sections: bounded(sections), memoryIds, patternTitles, degraded, writingContext, writingCloseness };
}

/** Keep the assembled prompt under MAX_CONTEXT_CHARS, dropping whole trailing sections. */
export function bounded(sections: string[]): string[] {
  const kept: string[] = [];
  let total = AUTHORITY_LINE.length;
  for (const section of sections) {
    if (total + section.length + 1 > MAX_CONTEXT_CHARS) break;
    kept.push(section);
    total += section.length + 1;
  }
  // The authority line always goes first and always fits: it is the precedence
  // rule, not optional context.
  return [AUTHORITY_LINE, ...kept];
}

/** One string for a system prompt: sections joined with newlines. */
export function contextPrompt(result: AcademicContextResult): string {
  return result.sections.length ? `\n\n${result.sections.join("\n")}` : "";
}
