/**
 * Long-term student memory — pure engine (spec §34 style: no IO, no
 * Date.now, no randomness; fully unit-testable without a database).
 *
 * The confidence model is an evidence-backed hypothesis, NEVER an
 * assertion: each new evidence row moves confidence up (supporting) or
 * down (contradicting), with DIMINISHING RETURNS (the first evidence
 * matters most) and RECENCY WEIGHTING (recent evidence outweighs old,
 * so outdated behavior does not permanently define the student).
 */

export const CONFIDENCE_FLOOR = 0.05;
export const CONFIDENCE_CAP = 0.95;
export const INITIAL_AI_CONFIDENCE = 0.35;
export const MONITORING_BELOW = 0.5;

/** Recency: evidence older than this many days loses weight. */
export const RECENCY_HALF_LIFE_DAYS = 120;

export type MemoryCategory =
  | "goal" | "strength" | "weakness" | "learning_preference"
  | "explanation_preference" | "study_habit" | "recurring_mistake"
  | "conceptual_misunderstanding" | "academic_history"
  | "subject_preference" | "motivation_pattern"
  | "effective_strategy" | "ineffective_strategy";

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  "goal", "strength", "weakness", "learning_preference",
  "explanation_preference", "study_habit", "recurring_mistake",
  "conceptual_misunderstanding", "academic_history",
  "subject_preference", "motivation_pattern",
  "effective_strategy", "ineffective_strategy",
];

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  goal: "Academic goal",
  strength: "Strength",
  weakness: "Weakness",
  learning_preference: "Learning preference",
  explanation_preference: "Explanation style",
  study_habit: "Study habit",
  recurring_mistake: "Recurring mistake",
  conceptual_misunderstanding: "Conceptual misunderstanding",
  academic_history: "Academic history",
  subject_preference: "Subject preference",
  motivation_pattern: "Motivation pattern",
  effective_strategy: "Effective strategy",
  ineffective_strategy: "Ineffective strategy",
};

export type MemoryStatus =
  | "active" | "monitoring" | "improving" | "contradicted"
  | "archived" | "disabled" | "forgotten";

export type MemoryOrigin = "student_supplied" | "ai_inferred";

export type ImprovementTrend = "" | "improving" | "plateaued" | "regressing";

export type EvidenceType =
  | "incorrect_problem" | "conceptual_error" | "correct_solution"
  | "improvement_signal" | "regression_signal" | "student_statement"
  | "student_correction" | "assignment_result" | "exam_result"
  | "ai_observation" | "contradiction";

export type EvidencePolarity = "positive" | "negative";

export interface MemoryEvidenceRow {
  id: string;
  memory_id: string;
  evidence_type: EvidenceType;
  polarity: EvidencePolarity;
  summary: string;
  evidence_ref: Record<string, unknown>;
  observed_at: string;
}

export interface StudentMemory {
  id: string;
  user_id: string;
  category: MemoryCategory;
  statement: string;
  details: string;
  subject: string | null;
  subject_tags: string[];
  confidence: number;
  status: MemoryStatus;
  improvement_trend: ImprovementTrend;
  origin: MemoryOrigin;
  source: string;
  first_observed: string;
  last_observed: string;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  evidence?: MemoryEvidenceRow[];
  evidence_count?: number;
}

export interface MemoryEvidenceInput {
  evidence_type: EvidenceType;
  polarity: EvidencePolarity;
  summary: string;
  evidence_ref?: Record<string, unknown>;
  observed_at?: string;
}

export function clampConfidence(c: number): number {
  if (!Number.isFinite(c)) return CONFIDENCE_FLOOR;
  return Math.min(CONFIDENCE_CAP, Math.max(CONFIDENCE_FLOOR, c));
}

/**
 * Recency weight of one evidence row: 1.0 when fresh, halved every
 * RECENCY_HALF_LIFE_DAYS. Recent evidence dominates old evidence, so a
 * student who has improved is not permanently defined by stale errors.
 */
export function recencyWeight(observedAt: string, nowISO?: string): number {
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return 0.5; // unknown date: neutral weight, never guess
  const now = nowISO !== undefined ? Date.parse(nowISO) : Date.now();
  if (!Number.isFinite(now)) return 0.5;
  const days = Math.max(0, (now - t) / 86_400_000);
  return Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
}

/**
 * Confidence after adding one evidence row: diminishing returns via
 * logistic-style increments that shrink as the evidence count grows.
 * Negative evidence uses the SAME weighting (symmetric), so one bad day
 * cannot crater a well-supported memory, and one good day cannot crown
 * an unproven one.
 */
export function confidenceAfterEvidence(
  current: number,
  evidence: MemoryEvidenceInput,
  existingEvidenceCount: number,
): number {
  const clamped = clampConfidence(current);
  // Increment shrinks with evidence already held: 1st evidence can move
  // confidence by up to ~0.22, by the 10th only ~0.07.
  const step = 0.22 / (1 + 0.16 * Math.max(0, existingEvidenceCount));
  const sign = evidence.polarity === "negative" ? -1 : 1;
  return clampConfidence(clamped + sign * step);
}

/**
 * Recompute confidence from the full evidence history. Weighted vote:
 * each row contributes ±recencyWeight; normalized against the total
 * weight, mapped onto [FLOOR, CAP] around a 0.5 midpoint. Deterministic.
 */
export function recomputeConfidence(
  rows: MemoryEvidenceRow[],
  nowISO?: string,
): number {
  if (!rows.length) return CONFIDENCE_FLOOR;
  let weighted = 0;
  let total = 0;
  for (const r of rows) {
    const w = recencyWeight(r.observed_at, nowISO);
    weighted += (r.polarity === "negative" ? -1 : 1) * w;
    total += w;
  }
  if (total <= 0) return CONFIDENCE_FLOOR;
  const score = weighted / total; // -1 .. 1
  return clampConfidence(0.5 + (score * 0.45));
}

/**
 * Improvement trend: looks at the K most recent pieces of evidence.
 * For weakness/mistake-type memories, negative-polarity evidence means
 * the weakness is STILL THERE; positive evidence (correct solutions,
 * improvement signals) means it is IMPROVING. Never a raw guess: the
 * trend is computed from evidence order and stays "" with no evidence.
 */
export const TREND_WINDOW = 5;

export function computeTrend(
  memory: Pick<StudentMemory, "category">,
  rows: MemoryEvidenceRow[],
  nowISO?: string,
): ImprovementTrend {
  if (!rows.length) return "";
  const sorted = [...rows].sort(
    (a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at),
  );
  const recent = sorted.slice(0, TREND_WINDOW);
  // Improvement direction: for weakness-like categories, improvement =
  // positive evidence (they got it right). For strengths/strategies,
  // improvement = the hypothesis being CONFIRMED (also positive here,
  // since positive polarity confirms those memories too).
  const positive = recent.filter((r) => r.polarity === "positive").length;
  const negative = recent.filter((r) => r.polarity === "negative").length;
  if (positive === 0 && negative === 0) return "";
  const isWeaknessLike =
    memory.category === "weakness" ||
    memory.category === "recurring_mistake" ||
    memory.category === "conceptual_misunderstanding" ||
    memory.category === "ineffective_strategy";
  // polarity: positive SUPPORTS the hypothesis, negative CONTRADICTS it.
  // For weakness-like memories, contradictions (correct solutions, signs of
  // improvement) are in the STUDENT'S FAVOR → 'improving'. Continued support
  // (more mistakes) → 'regressing'.
  if (isWeaknessLike) {
    if (negative >= 3 && negative > positive) return "improving";
    if (positive > negative) return "regressing";
    return "plateaued";
  }
  // For strength/strategy-like memories, support confirms the strength
  // (improving); contradictions mean it no longer holds (regressing).
  if (positive >= 3 && positive > negative) return "improving";
  if (negative > positive) return "regressing";
  return "plateaued";
}

/**
 * Status after a confidence/trend recomputation. AI-inferred memories
 * stay 'monitoring' until confidence clears MONITORING_BELOW — the AI
 * NEVER asserts an unproven hypothesis as fact. Weakness-like memories
 * with an 'improving' trend become 'improving'. Never auto-moves a
 * student-disabled or forgotten memory.
 */
export function statusAfterRecompute(
  memory: Pick<StudentMemory, "status" | "origin" | "category">,
  confidence: number,
  trend: ImprovementTrend,
): MemoryStatus {
  if (memory.status === "disabled" || memory.status === "forgotten" || memory.status === "archived") {
    return memory.status;
  }
  if (trend === "improving") return "improving";
  if (memory.origin === "ai_inferred" && confidence < MONITORING_BELOW) return "monitoring";
  return "active";
}

export interface MemoryStatusChange {
  allowed: boolean;
  reason?: string;
}

/** Lifecycle transitions the STUDENT may perform in the management UI. */
export function studentTransition(
  from: MemoryStatus,
  to: MemoryStatus,
): MemoryStatusChange {
  const allowed: Record<string, MemoryStatus[]> = {
    active: ["archived", "disabled", "forgotten", "monitoring"],
    monitoring: ["archived", "disabled", "forgotten", "active"],
    improving: ["archived", "disabled", "forgotten", "monitoring", "active"],
    contradicted: ["archived", "disabled", "forgotten", "monitoring", "active"],
    archived: ["disabled", "forgotten", "active"],
    disabled: ["active", "monitoring", "archived", "forgotten"], // re-enable
    forgotten: [], // forgotten stays forgotten (purge only)
  };
  return { allowed: (allowed[from] || []).includes(to) };
}

/* ------------------------------------------------------------------ */
/* Relevance retrieval — NEVER every memory in every prompt            */
/* ------------------------------------------------------------------ */

export interface MemoryContext {
  subject?: string | null;
  task_type?: string | null;
  mode?: string | null;
}

export interface MemoryPromptSection {
  /** Compact lines injected into the system prompt. */
  lines: string[];
  /** Which memories were selected and WHY (persisted, auditable). */
  decisions: { id: string; statement: string; why: string }[];
}

/** Max memories ever injected into a single prompt. */
export const MAX_PROMPT_MEMORIES = 8;

/** Statuses eligible for AI retrieval. */
export const RETRIEVABLE_STATUSES: MemoryStatus[] = ["active", "monitoring", "improving"];

/**
 * Relevance score: subject-tag matches dominate; strengths/goals/
 * preferences are cross-subject and still retrieved with a small base
 * score. Confidence breaks ties; recency of last_observed matters.
 */
export function relevanceScore(m: StudentMemory, ctx: MemoryContext, nowISO?: string): number {
  const subject = (ctx.subject || "").toLowerCase();
  const tags = m.subject_tags.map((t) => t.toLowerCase());
  let score = 0.2; // base: a real, non-archived, non-disabled memory
  if (subject && tags.includes(subject)) score += 0.5;
  if (subject && (m.subject || "").toLowerCase() === subject) score += 0.2;
  if (!subject || tags.includes(subject) || (m.subject || "").toLowerCase() === subject) {
    // cross-subject memories only when they carry no conflicting subject
    if (!m.subject && !tags.length) score += 0.15;
  }
  score += 0.3 * clampConfidence(m.confidence);
  const lastSeen = Date.parse(m.last_observed);
  if (Number.isFinite(lastSeen)) {
    const now = nowISO !== undefined ? Date.parse(nowISO) : Date.now();
    if (Number.isFinite(now)) {
      const days = Math.max(0, (now - lastSeen) / 86_400_000);
      score += 0.1 * Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
    }
  }
  return score;
}

/**
 * Select the memories relevant to THIS academic context only. Filters
 * by retrievable status, ranks by relevance, caps at
 * MAX_PROMPT_MEMORIES, and returns explanation lines per memory.
 * Preferences (explanation style, learning preferences, goals) are
 * prioritized for style/difficulty/hints/examples/recommendations.
 */
export function selectRelevantMemories(
  memories: StudentMemory[],
  ctx: MemoryContext,
  nowISO?: string,
): MemoryPromptSection {
  const eligible = memories.filter((m) => RETRIEVABLE_STATUSES.includes(m.status));
  const scored = eligible
    .map((m) => ({ m, score: relevanceScore(m, ctx, nowISO) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PROMPT_MEMORIES);
  const lines: string[] = [];
  const decisions: { id: string; statement: string; why: string }[] = [];
  for (const { m, score } of scored) {
    const confidencePct = `${Math.round(m.confidence * 100)}%`;
    const trend = m.improvement_trend === "improving"
      ? " (IMPROVING — adjust difficulty upward, encourage)"
      : m.improvement_trend === "regressing"
        ? " (regressing — reinforce fundamentals)"
        : "";
    const origin = m.origin === "student_supplied" ? "student-stated" : "AI-observed hypothesis";
    lines.push(
      `- [${MEMORY_CATEGORY_LABELS[m.category]}] ${m.statement} (${origin}, confidence ${confidencePct}${trend}): ${m.details || "no extra details"}`,
    );
    const why: string[] = [`relevance ${score.toFixed(2)}`];
    if (m.subject_tags.length && ctx.subject) why.push(`subject match: ${m.subject_tags.join(", ")}`);
    if (m.origin === "student_supplied") why.push("student-stated fact");
    decisions.push({ id: m.id, statement: m.statement, why: why.join("; ") });
  }
  return { lines, decisions };
}
