/**
 * Learning patterns — structured personal academic knowledge (workflow §9–§12).
 *
 * This is STATE, not chat history. Every learned fact about how a student
 * works academically (a recurring mistake, a preferred method, a confirmed
 * correction) is a scoped record with:
 *   - a lifecycle status (candidate → active → corrected/inactive → recurring)
 *   - confidence that grows only with repeated observation or user/teacher
 *     confirmation
 *   - an applicability scope so a calculus pattern never leaks into biology
 *
 * Pure functions only — unit-testable without a database (spec §34).
 */

export type PatternKind = "mistake" | "method" | "preference" | "correction";
export type PatternStatus =
  | "candidate"
  | "active"
  | "corrected"
  | "inactive"
  | "recurring"
  | "temporary"
  | "teacher_required";
export type PatternScope = "global" | "subject" | "course" | "teacher" | "assignment" | "task_type";
export type PatternSource = "ai_observation" | "user" | "teacher";

export interface LearningPattern {
  id: string;
  user_id: string;
  kind: PatternKind;
  scope: PatternScope;
  subject: string | null;
  course_id: string | null;
  teacher_id: string | null;
  assignment_id: string | null;
  task_type: string | null;
  description: string;
  examples: { content: string; date?: string }[];
  status: PatternStatus;
  first_observed: string;
  last_observed: string;
  observation_count: number;
  confidence: number;
  source: PatternSource;
  correction_source: string;
  created_at: string;
  updated_at: string;
}

/** Statuses that make a pattern eligible for use in the AI context. */
export const APPLYABLE_STATUSES: PatternStatus[] = [
  "candidate",
  "active",
  "recurring",
  "temporary",
  "teacher_required",
];

/** Statuses that mean "no longer happening" (must not be applied). */
export const RESOLVED_STATUSES: PatternStatus[] = ["corrected", "inactive"];

export interface PatternContext {
  subject?: string | null;
  course_id?: string | null;
  teacher_id?: string | null;
  assignment_id?: string | null;
  task_type?: string | null;
}

const norm = (s: string | null | undefined) => (s || "").trim().toLowerCase();

/**
 * Scope matching (workflow §28 learning scopes). A pattern applies only when
 * its own scope matches the current task context:
 *   global        → always
 *   subject       → same subject (case-insensitive)
 *   course        → same course
 *   teacher       → same teacher (Teacher A's rule must never reach Teacher B)
 *   assignment    → same assignment only
 *   task_type     → same task type
 */
export function scopeMatches(p: Pick<LearningPattern, "scope" | "subject" | "course_id" | "teacher_id" | "assignment_id" | "task_type">, ctx: PatternContext): boolean {
  switch (p.scope) {
    case "global":
      return true;
    case "subject":
      return !!p.subject && norm(p.subject) === norm(ctx.subject);
    case "course":
      return !!p.course_id && p.course_id === ctx.course_id;
    case "teacher":
      return !!p.teacher_id && p.teacher_id === ctx.teacher_id;
    case "assignment":
      return !!p.assignment_id && p.assignment_id === ctx.assignment_id;
    case "task_type":
      return !!p.task_type && norm(p.task_type) === norm(ctx.task_type);
    default:
      return false;
  }
}

/**
 * Selects the patterns that may enter the AI context for this task:
 * applyable status AND matching scope. Resolved (corrected/inactive)
 * patterns are excluded — an old fixed mistake must not be reproduced.
 */
export function selectApplicablePatterns(patterns: LearningPattern[], ctx: PatternContext): LearningPattern[] {
  return patterns.filter(
    (p) => APPLYABLE_STATUSES.includes(p.status) && scopeMatches(p, ctx)
  );
}

/** Confidence grows with repeated observation, capped below certainty. */
export function bumpedConfidence(current: number, observations: number): number {
  const base = Math.min(0.95, Math.max(current, 0) + 0.15);
  // A pattern seen many times never carries less than a moderate confidence.
  return Math.min(0.95, Math.max(base, Math.min(0.9, 0.25 + observations * 0.1)));
}

/** Normalizes the model's self-reported observed mistakes; never trusts blindly. */
export function normalizeObservedMistakes(raw: unknown): { description: string; subject: string | null }[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map((m) => {
      if (typeof m === "string") return { description: m, subject: null as string | null };
      if (m && typeof m === "object") {
        const o = m as { description?: unknown; mistake?: unknown; subject?: unknown };
        const d = typeof o.description === "string" ? o.description : typeof o.mistake === "string" ? o.mistake : "";
        return {
          description: d.trim().slice(0, 400),
          subject: typeof o.subject === "string" ? o.subject.trim().slice(0, 80) || null : null,
        };
      }
      return { description: "", subject: null as string | null };
    })
    .filter((m) => m.description.length >= 8) // ignore empty/vague reports
    .slice(0, 6);
}

const normKey = (s: string) => norm(s).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Does a newly observed mistake match an existing pattern? Word-overlap
 * similarity — no fuzzy guessing on short descriptions.
 */
export function matchesExistingPattern(existing: Pick<LearningPattern, "description">, description: string): boolean {
  const a = normKey(existing.description);
  const b = normKey(description);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const wa = a.split(" ").filter((w) => w.length > 3);
  const wb = b.split(" ").filter((w) => w.length > 3);
  if (wa.length === 0 || wb.length === 0) return false;
  let overlap = 0;
  for (const w of wb) if (wa.indexOf(w) !== -1) overlap++;
  return overlap / Math.min(wa.length, wb.length) >= 0.7;
}

/**
 * Lifecycle transitions (workflow §10, §11):
 *   confirm        — user/teacher confirms the pattern is real
 *   mark_corrected — "I don't make this mistake anymore" → corrected
 *   reactivate     — a corrected mistake has been observed again → recurring
 *   mark_temporary — the pattern was a one-off / temporary
 */
export type PatternAction = "confirm" | "mark_corrected" | "reactivate" | "mark_temporary";

export function transitionPattern(
  p: Pick<LearningPattern, "status" | "confidence" | "observation_count">,
  action: PatternAction,
  opts?: { source?: PatternSource; correctionSource?: string }
): { status: PatternStatus; confidence: number; source?: PatternSource; correction_source?: string } {
  switch (action) {
    case "confirm": {
      // User/teacher confirmation makes the pattern established — but a
      // resolved pattern must be explicitly re-observed, not just confirmed.
      const status: PatternStatus =
        p.status === "corrected" || p.status === "inactive" ? "recurring" : "active";
      return { status, confidence: Math.max(p.confidence, 0.85), source: opts?.source };
    }
    case "mark_corrected":
      return {
        status: "corrected",
        confidence: p.confidence,
        source: opts?.source,
        correction_source: opts?.correctionSource || "user",
      };
    case "reactivate":
      return { status: "recurring", confidence: bumpedConfidence(p.confidence, p.observation_count) };
    case "mark_temporary":
      return { status: "temporary", confidence: Math.min(p.confidence, 0.5) };
    default:
      return { status: p.status, confidence: p.confidence };
  }
}

/* ------------------------------------------------------------------ */
/* Prompt construction — only APPLIED patterns enter the context.    */
/* ------------------------------------------------------------------ */

export interface PatternsForPrompt {
  /** Lines describing observed mistakes to WATCH FOR (never to introduce). */
  mistakeAwareness: string[];
  /** Lines describing learned methods/preferences to actually use. */
  methodPreferences: string[];
}

/**
 * Builds the honest, bounded prompt lines for applicable patterns.
 *
 * MISTAKES are never reproduced in fresh work (workflow §12): they are
 * listed as things to watch for when checking work, or — only for
 * established, confirmed mistakes in writing voice — noted as the student's
 * demonstrated habit WITHOUT being introduced into the answer.
 */
export function patternsForPrompt(patterns: LearningPattern[]): PatternsForPrompt {
  const mistakeAwareness: string[] = [];
  const methodPreferences: string[] = [];
  for (const p of patterns) {
    const seen = p.observation_count > 1 ? ` (observed ${p.observation_count} times)` : "";
    switch (p.kind) {
      case "mistake":
        mistakeAwareness.push(
          `- ${p.description}${seen}${
            p.status === "candidate" ? " [candidate — low confidence, do not treat as established]" : ""
          }`
        );
        break;
      case "method":
        methodPreferences.push(`- Learned method this student uses: ${p.description}${seen}`);
        break;
      case "correction":
        methodPreferences.push(`- Established correction: ${p.description}${seen}`);
        break;
      case "preference":
        methodPreferences.push(`- Personal preference: ${p.description}${seen}`);
        break;
    }
  }
  return {
    mistakeAwareness: mistakeAwareness.slice(0, 8),
    methodPreferences: methodPreferences.slice(0, 8),
  };
}

/** Human-readable explanation of what pattern state was applied to a response. */
export function describePatternStatus(status: PatternStatus): string {
  switch (status) {
    case "candidate": return "Observed but not yet confirmed — used cautiously";
    case "active": return "Confirmed and currently applied";
    case "corrected": return "You marked this corrected — no longer applied";
    case "inactive": return "Inactive — no longer applied";
    case "recurring": return "Returned after being corrected — applied again";
    case "temporary": return "Temporary one-off — used cautiously";
    case "teacher_required": return "Required by your teacher — always applied in scope";
  }
}
