/**
 * ACADEMIC-ONLY SELF-LEARNING (2026-10-28).
 *
 * Sophira may learn from study work, and only from study work. Before any
 * observation becomes a durable learning pattern, the content is checked
 * against this academic domain gate. Non-academic material (small talk,
 * entertainment, unrelated personal chat) never enters long-term memory.
 *
 * Design notes:
 *  - Deterministic keyword/domain matching: no extra network call, no extra
 *    cost, no model dependency, fully testable.
 *  - INCLUSIVE by intent: when a genuine academic signal exists (subject,
 *    assignment, teacher, study verb) the content is allowed. When nothing
 *    academic is present at all, learning is skipped - existing stored
 *    patterns are never modified or deleted by this gate.
 */

const ACADEMIC_TERMS = [
  // subjects and disciplines
  "math", "maths", "mathematics", "algebra", "geometry", "calculus", "statistics",
  "physics", "chemistry", "biology", "science", "anatomy", "astronomy",
  "english", "literature", "grammar", "essay", "writing", "reading", "poetry",
  "history", "geography", "civics", "economics", "psychology", "sociology",
  "philosophy", "language", "spanish", "french", "german", "latin", "mandarin",
  "computer science", "programming", "algorithm", "coding", "informatics",
  "art", "music theory", "theatre", "physical education",
  // academic structures
  "homework", "assignment", "course", "courses", "lesson", "lecture", "semester",
  "syllabus", "curriculum", "exam", "examination", "quiz", "test", "midterm",
  "final", "grade", "grading", "rubric", "teacher", "professor", "instructor",
  "class", "classroom", "student", "study", "studying", "revision", "revise",
  "notebook", "textbook", "chapter", "worksheet", "citation", "cite", "source",
  "thesis", "dissertation", "research", "report", "lab", "laboratory", "proof",
  "theorem", "equation", "formula", "derivative", "integral", "fraction",
  "denominator", "numerator", "variable", "hypothesis", "experiment", "analysis",
  "summary", "summarize", "outline", "paragraph", "sentence", "vocabulary",
  "spelling", "pronunciation", "translation", "definition", "concept",
  // study behaviours the assistant legitimately learns from
  "mistake", "misconception", "error", "practice", "solving", "solve",
  "step-by-step", "explanation", "example", "tutor", "academic", "school",
  "college", "university", "degree", "credit", "transcript",
] as const;

const NON_ACADEMIC_CUES = [
  "boyfriend", "girlfriend", "dating", "celebrity", "netflix", "tiktok",
  "meme", "gossip", "recipe", "workout plan", "shopping", "vacation",
] as const;

export interface AcademicGateResult {
  academic: boolean;
  /** longest academic term matched, for developer diagnostics only */
  matched: string | null;
  reason: "academic" | "non_academic_cue" | "no_academic_signal" | "empty";
}

/**
 * Deterministic academic-domain check for text about to become learning data.
 * A recognisable academic signal wins over a casual cue, so a study question
 * that mentions an unrelated word is still learned from.
 */
export function checkAcademicContent(text: string | null | undefined): AcademicGateResult {
  const raw = String(text ?? "").toLowerCase().trim();
  if (raw.length === 0) return { academic: false, matched: null, reason: "empty" };
  let matched: string | null = null;
  for (const term of ACADEMIC_TERMS) {
    if (raw.includes(term) && (matched === null || term.length > matched.length)) matched = term;
  }
  if (matched) return { academic: true, matched, reason: "academic" };
  for (const cue of NON_ACADEMIC_CUES) {
    if (raw.includes(cue)) return { academic: false, matched: null, reason: "non_academic_cue" };
  }
  return { academic: false, matched: null, reason: "no_academic_signal" };
}

/** Convenience boolean used by the learning pipeline. */
export function isAcademicContent(text: string | null | undefined): boolean {
  return checkAcademicContent(text).academic;
}
