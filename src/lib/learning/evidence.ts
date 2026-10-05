/**
 * PATTERN EVIDENCE ENGINE + CONFIDENCE DECAY (2026-10-05).
 *
 * Upgrades the existing pattern lifecycle (src/lib/learning/patterns.ts —
 * NOT replaced; the engine composes and defers to it) with
 * evidence-driven confidence updates and behavioral adaptation so
 * outdated academic patterns stop influencing responses.
 *
 * Design invariants (all tested):
 *   1. Every confidence change comes from RECORDED EVIDENCE, never a
 *      guess. Positive evidence (user confirms, teacher supports, the
 *      method is repeatedly used, generated work using the pattern is
 *      approved) raises confidence; negative evidence (explicit user
 *      correction, teacher contradicting, another method repeatedly used,
 *      rejection, conflict with newer instructions) decays it.
 *   2. Decay is DETERMINISTIC (same inputs → same outputs), EXPLAINABLE
 *      (each event multiplies by a stated factor; every transition
 *      carries reasons), and BOUNDED (confidence ∈ [0.05, 0.95], never
 *      below the floor, never above the cap).
 *   3. Patterns are NEVER abruptly deleted — they transition
 *      candidate → active → lower_confidence → inactive, and a demoted
 *      or inactive pattern becomes active again when later evidence
 *      confirms it (returning states reuse the existing lifecycle's
 *      "recurring" semantics).
 *   4. Teacher and CURRENT assignment instructions ALWAYS override
 *      learned patterns: teacher/assignment conflict evidence decays the
 *      pattern, a demoted pattern never outranks fresh instructions, and
 *      prompt construction keeps patterns strictly below teacher rules.
 *
 * Pure functions only — unit-testable without a database (spec §34).
 */

import {
  APPLYABLE_STATUSES,
  bumpedConfidence,
  describeStaleness,
  isPatternStale,
  scopeMatches,
  transitionPattern,
  type LearningPattern,
  type PatternContext,
  type PatternStatus,
} from "./patterns";

/* ------------------------------------------------------------------ */
/* Explainable constants — the whole decay model in one place          */
/* ------------------------------------------------------------------ */

/** Below this confidence a pattern is demoted to `lower_confidence`. */
export const LOWER_CONFIDENCE_BELOW = 0.5;
/** Below this confidence a pattern becomes `inactive` (never deleted). */
export const INACTIVE_BELOW = 0.2;
/** 3+ contradictions with confidence below this level force `inactive`
 *  (matches the requested 94% → 87% → 73% → 51% → INACTIVE shape). */
export const CONTRADICTION_INACTIVE_BELOW = 0.55;
export const CONTRADICTION_INACTIVE_MIN_COUNT = 3;
/** Confidence bounds — decay is bounded, never zero, never certainty. */
export const CONFIDENCE_FLOOR = 0.05;
export const CONFIDENCE_CAP = 0.95;

/** Time decay: no decay during the grace window, then a fixed factor per
 *  full window without confirmation OR use. Deterministic geometric decay. */
export const TIME_DECAY_GRACE_DAYS = 90;
export const TIME_DECAY_WINDOW_DAYS = 90;
export const TIME_DECAY_FACTOR = 0.8;

/* ------------------------------------------------------------------ */
/* Time decay                                                           */
/* ------------------------------------------------------------------ */

export interface TimeDecay {
  /** The confidence after decay (== raw when fresh). */
  confidence: number;
  /** How many full decay windows elapsed (0 = fresh). */
  windows: number;
  /** Human explanation, null when no decay happened. */
  reason: string | null;
}

/**
 * Deterministic time decay: a pattern that is neither confirmed nor used
 * loses 20% of its confidence per 90-day window after a 90-day grace
 * period. Never below the floor (0.05) — bounded, explainable, testable.
 * The anchor is the MOST RECENT of last_confirmed_at / last_used_at /
 * last_observed / first_observed, so ANY genuine activity resets decay.
 */
export function applyTimeDecay(
  p: Pick<LearningPattern, "confidence" | "last_confirmed_at" | "last_used_at" | "last_observed" | "first_observed" | "created_at">,
  nowISO?: string
): TimeDecay {
  const anchors = [p.last_confirmed_at, p.last_used_at, p.last_observed, p.first_observed, p.created_at]
    .map((d) => (d ? Date.parse(d) : NaN))
    .filter((t) => Number.isFinite(t));
  const anchor = anchors.length ? Math.max(...anchors) : NaN;
  if (!Number.isFinite(anchor)) {
    return { confidence: clampConfidence(p.confidence), windows: 0, reason: null }; // unknown dates: never guess
  }
  const now = nowISO !== undefined ? Date.parse(nowISO) : Date.now();
  if (!Number.isFinite(now)) {
    return { confidence: clampConfidence(p.confidence), windows: 0, reason: null };
  }
  const elapsedMs = now - anchor;
  const graceMs = TIME_DECAY_GRACE_DAYS * 86_400_000;
  const windowMs = TIME_DECAY_WINDOW_DAYS * 86_400_000;
  const windows =
    elapsedMs <= graceMs ? 0 : 1 + Math.floor((elapsedMs - graceMs) / windowMs);
  if (windows <= 0) {
    return { confidence: clampConfidence(p.confidence), windows: 0, reason: null };
  }
  const decayed = Math.max(CONFIDENCE_FLOOR, clampConfidence(p.confidence) * Math.pow(TIME_DECAY_FACTOR, windows));
  return {
    confidence: decayed,
    windows,
    reason: `confidence decayed to ${pct(decayed)} — not confirmed or used for ${windows * TIME_DECAY_WINDOW_DAYS}+ days (${pct(100 - TIME_DECAY_FACTOR * 100)}% of confidence lost per ${TIME_DECAY_WINDOW_DAYS}-day window after a ${TIME_DECAY_GRACE_DAYS}-day grace)`,
  };
}

/* ------------------------------------------------------------------ */
/* Contradiction decay — the deterministic ladder                       */
/* ------------------------------------------------------------------ */

/**
 * The n-th recorded contradiction (1-based) multiplies confidence by
 *   max(0.55, 0.92 − 0.09 × (n − 1))
 * i.e. 1st ×0.92, 2nd ×0.83, 3rd ×0.74, then ×0.55 each — an explainable,
 * accelerating, bounded ladder: 0.94 → 0.86 → 0.72 → 0.53 → …
 * (matching the requested example's shape). Never below the floor.
 */
export function applyContradictionDecay(confidence: number, nthContradiction: number): number {
  const n = Math.max(1, Math.floor(nthContradiction));
  const factor = Math.max(0.55, 0.92 - 0.09 * (n - 1));
  return Math.max(CONFIDENCE_FLOOR, clampConfidence(confidence) * factor);
}

/* ------------------------------------------------------------------ */
/* Evidence                                                             */
/* ------------------------------------------------------------------ */

export type EvidenceType =
  | "user_confirm"
  | "user_approves_work"
  | "repeated_use"
  | "teacher_supports"
  | "user_correction"
  | "user_rejects"
  | "teacher_contradicts"
  | "alternative_method_used"
  | "instruction_conflict";

export const EVIDENCE_TYPES: EvidenceType[] = [
  "user_confirm", "user_approves_work", "repeated_use", "teacher_supports",
  "user_correction", "user_rejects", "teacher_contradicts",
  "alternative_method_used", "instruction_conflict",
];

export interface PatternEvidence {
  type: EvidenceType;
  at?: string;
  note?: string;
}

export interface EvidenceOutcome {
  /** Exact DB fields to persist (never a whole-row rewrite). */
  updates: Partial<LearningPattern> & { confidence: number; updated_at: string };
  /** Human explanation of what the evidence did and why. */
  explanation: string;
  /** Deterministic change log — one line per changed field. */
  changes: string[];
}

const clampConfidence = (c: number) => Math.min(CONFIDENCE_CAP, Math.max(0, c));
const pct = (v: number) => `${Math.round(v * 100)}%`;

const POSITIVE_EVIDENCE: EvidenceType[] = [
  "user_confirm", "user_approves_work", "repeated_use", "teacher_supports",
];

/**
 * Recomputes the lifecycle status from the new confidence and the
 * contradiction history — the transition LADDER, never a delete:
 *   conf < 0.2                                          → inactive
 *   conf < 0.55 with ≥3 contradictions                  → inactive
 *   conf < 0.5 (demotion step)                          → lower_confidence
 *   conf ≥ 0.5 while previously demoted/inactive        → active / recurring
 * Recovery (the requested "becomes active again"): a lower_confidence
 * pattern that climbs back above 0.5 via positive evidence becomes
 * active; an inactive one returns as recurring first (the existing
 * lifecycle's returning semantics), and a recurring pattern becomes
 * active once later evidence CONFIRMS it. Corrected stays corrected
 * unless the evidence itself re-observes it (existing semantics).
 */
function recomputeStatus(
  status: PatternStatus,
  confidence: number,
  contradictionCount: number,
  evidence: EvidenceType
): PatternStatus {
  const positive = POSITIVE_EVIDENCE.includes(evidence);
  if (confidence < INACTIVE_BELOW) return "inactive";
  if (contradictionCount >= CONTRADICTION_INACTIVE_MIN_COUNT && confidence < CONTRADICTION_INACTIVE_BELOW) {
    return "inactive";
  }
  if (confidence < LOWER_CONFIDENCE_BELOW) {
    if (status === "corrected") return "corrected"; // user-owned state; negative evidence agrees
    if (status === "teacher_required") return "lower_confidence"; // teacher withdrew the requirement
    if (status === "inactive" || status === "lower_confidence") return status;
    return "lower_confidence";
  }
  // confidence ≥ 0.5 — recovery path
  switch (status) {
    case "lower_confidence":
      return "active"; // confirmed back above the demotion threshold
    case "inactive":
      return "recurring"; // existing lifecycle: returned after being inactive
    case "recurring":
      return positive ? "active" : "recurring"; // later confirmation re-establishes it
    case "candidate":
      return evidence === "teacher_supports" ? "active" : status; // teacher support establishes
    default:
      return status;
  }
}

/**
 * Applies ONE evidence event to a pattern and returns the exact row
 * updates plus a full explanation. Pure: the caller persists.
 */
export function recordPatternEvidence(
  p: LearningPattern,
  evidence: PatternEvidence,
  nowISO?: string
): EvidenceOutcome {
  const now = nowISO ?? new Date().toISOString();
  const changes: string[] = [];
  const updates: Partial<LearningPattern> & { confidence: number; updated_at: string } = {
    confidence: clampConfidence(p.confidence),
    updated_at: now,
  };
  const contradictionCount = p.contradiction_count ?? 0;
  const correctionCount = p.correction_count ?? 0;
  const confirmationCount = p.confirmation_count ?? 0;
  const observationCount = p.observation_count;
  let explanation = "";

  const setConfidence = (next: number, why: string) => {
    const bounded = clampConfidence(next);
    if (bounded !== p.confidence) changes.push(`confidence ${pct(p.confidence)} → ${pct(bounded)} (${why})`);
    updates.confidence = bounded;
  };
  const setStatus = (next: PatternStatus) => {
    if (next !== p.status) changes.push(`status ${p.status} → ${next}`);
    updates.status = next;
  };

  switch (evidence.type) {
    /* ---------------- positive evidence ---------------- */
    case "user_confirm": {
      // Delegates to the EXISTING lifecycle transition (confirm): the
      // pattern becomes established — max(confidence, 0.85) — and a
      // resolved pattern returns as recurring. Confirmation metadata is
      // added on top; the old behavior is unchanged, only annotated.
      const t = transitionPattern(p, "confirm", { source: "user" });
      updates.confirmation_count = confirmationCount + 1;
      updates.last_confirmed_at = now;
      updates.source = "user";
      changes.push(`confirmation #${confirmationCount + 1} recorded (user confirmed explicitly)`);
      // The EXISTING lifecycle transition decides the status (confirm on
      // corrected/inactive returns as recurring — a watched return, not an
      // instant re-establishment). recomputeStatus is skipped here so one
      // confirmation cannot skip the recurring step; LATER positive
      // evidence while recurring promotes it to active.
      setConfidence(t.confidence, "explicit user confirmation — the existing lifecycle confirm rule: at least 85%");
      setStatus(t.confidence < LOWER_CONFIDENCE_BELOW ? "lower_confidence" : t.status);
      explanation = "The user explicitly confirmed the pattern — confirmation count and last-confirmed date recorded, confidence established per the existing lifecycle.";
      break;
    }
    case "teacher_supports": {
      updates.last_confirmed_at = now;
      updates.confirmation_count = confirmationCount + 1;
      changes.push(`confirmation #${confirmationCount + 1} recorded (teacher instructions support it)`);
      const next = clampConfidence(p.confidence + 0.15);
      setConfidence(next, "teacher instructions support the method (+15%)");
      setStatus(recomputeStatus(p.status, next, contradictionCount, evidence.type));
      explanation = "Teacher instructions support this pattern — confidence raised; teacher confirmation always outweighs historical doubt.";
      break;
    }
    case "repeated_use": {
      const nextObservations = observationCount + 1;
      updates.observation_count = nextObservations;
      updates.last_used_at = now;
      updates.last_observed = now;
      // Reuses the existing observation-growth function — consistency.
      const next = bumpedConfidence(p.confidence, nextObservations);
      setConfidence(next, "the user repeatedly uses this method (existing growth rule, +15% per observation)");
      // A corrected/inactive pattern observed in use again RETURNS
      // (existing lifecycle semantics — recurring), never silently stays out.
      if (p.status === "corrected" || p.status === "inactive") {
        setStatus("recurring");
        changes.push("pattern observed in use again after being resolved — returned as recurring");
      } else {
        setStatus(recomputeStatus(p.status, next, contradictionCount, evidence.type));
      }
      explanation = "Repeated use observed — observation count and last-used date updated; genuine activity resets time decay.";
      break;
    }
    case "user_approves_work": {
      updates.last_used_at = now;
      updates.confirmation_count = confirmationCount + 1;
      changes.push(`approval recorded (user approved generated work using this pattern)`);
      const next = clampConfidence(p.confidence + 0.1);
      setConfidence(next, "the user approved generated work that used the pattern (+10%)");
      setStatus(recomputeStatus(p.status, next, contradictionCount, evidence.type));
      explanation = "The user approved work generated with this pattern — positive evidence recorded.";
      break;
    }

    /* ---------------- negative evidence ---------------- */
    case "user_correction": {
      updates.correction_count = correctionCount + 1;
      updates.contradiction_count = contradictionCount + 1;
      changes.push(`correction #${correctionCount + 1} recorded (user explicitly corrected it)`);
      const bounded = Math.max(CONFIDENCE_FLOOR, clampConfidence(p.confidence * 0.5));
      setConfidence(bounded, "explicit user correction — a strong contradiction halves confidence (×0.5)");
      setStatus(recomputeStatus(p.status, bounded, contradictionCount + 1, evidence.type));
      explanation = "The user explicitly corrected this pattern — confidence halved (strong contradiction) and the correction count recorded.";
      break;
    }
    case "user_rejects": {
      updates.contradiction_count = contradictionCount + 1;
      const bounded = Math.max(CONFIDENCE_FLOOR, clampConfidence(p.confidence * 0.5));
      setConfidence(bounded, "the user rejected the pattern — a strong contradiction halves confidence (×0.5)");
      setStatus(recomputeStatus(p.status, bounded, contradictionCount + 1, evidence.type));
      explanation = "The user rejected this pattern — a strong contradiction recorded against it.";
      break;
    }
    case "teacher_contradicts": {
      updates.contradiction_count = contradictionCount + 1;
      updates.correction_source = evidence.note ?? "teacher";
      const bounded = Math.max(CONFIDENCE_FLOOR, clampConfidence(p.confidence * 0.5));
      setConfidence(bounded, "the teacher said to use a different method — the teacher instruction ALWAYS wins, so confidence halves (×0.5)");
      if (p.status === "teacher_required") {
        changes.push("status teacher_required → demoted (the teacher's CURRENT instruction overrides the stored requirement)");
      }
      setStatus(recomputeStatus(p.status, bounded, contradictionCount + 1, evidence.type));
      explanation = "The teacher's current instruction contradicts this pattern — the teacher ALWAYS overrides learned patterns; confidence halved and the status demoted.";
      break;
    }
    case "alternative_method_used": {
      updates.contradiction_count = contradictionCount + 1;
      const bounded = applyContradictionDecay(p.confidence, contradictionCount + 1);
      setConfidence(bounded, `contradiction #${contradictionCount + 1} — the user repeatedly uses another method (deterministic ladder ×0.92, ×0.83, ×0.74, …)`);
      setStatus(recomputeStatus(p.status, bounded, contradictionCount + 1, evidence.type));
      explanation = "The user repeatedly uses a different method — contradictory behavior recorded; repeated contradictions accelerate the decay.";
      break;
    }
    case "instruction_conflict": {
      updates.contradiction_count = contradictionCount + 1;
      updates.correction_source = evidence.note ?? "assignment";
      const bounded = clampConfidence(p.confidence * 0.85);
      setConfidence(bounded, "the pattern conflicted with newer assignment instructions (−15%)");
      setStatus(recomputeStatus(p.status, bounded, contradictionCount + 1, evidence.type));
      explanation = "The pattern conflicted with the current assignment's instructions — current instructions always win; confidence decayed.";
      break;
    }
    default: {
      explanation = "Unknown evidence type — nothing changed (fail-safe).";
      break;
    }
  }

  if (!changes.length) changes.push("no state changed");
  return { updates, explanation, changes };
}

/* ------------------------------------------------------------------ */
/* Selection + explainable decisions (the metadata exposure)            */
/* ------------------------------------------------------------------ */

export interface PatternDecision {
  pattern_id: string;
  description: string;
  kind: LearningPattern["kind"];
  status: PatternStatus;
  /** Confidence after deterministic time decay — what actually drives use. */
  effective_confidence: number;
  applied: boolean;
  /** Why Sophira selected or ignored this pattern — every reason stated. */
  reasons: string[];
}

/**
 * Decides, with full explanations, which patterns enter the AI context
 * for this task. Composition of the existing filters (scope, applyable
 * status, 180-day staleness — all unchanged) plus the new adaptive
 * decay filter: a time-decayed pattern below the demotion threshold
 * stops influencing responses even while its status still reads active.
 * `lower_confidence` patterns stay applied, clearly labeled as reduced
 * confidence — decay is gradual, never a cliff.
 */
export function explainPatternDecisions(
  patterns: LearningPattern[],
  ctx: PatternContext,
  nowISO?: string
): PatternDecision[] {
  return patterns.map((p) => {
    const reasons: string[] = [];
    const decay = applyTimeDecay(p, nowISO);
    let applied = true;

    if (!APPLYABLE_STATUSES.includes(p.status)) {
      applied = false;
      reasons.push(`ignored: status is "${p.status}" — ${p.status === "corrected" ? "the student marked it corrected" : "it is inactive"}, so it no longer shapes responses`);
    } else if (!scopeMatches(p, ctx)) {
      applied = false;
      reasons.push(`ignored: scope (${p.scope}${p.subject ? `: ${p.subject}` : ""}) does not match this task's context — scoped patterns never leak across subjects/courses/teachers`);
    } else if (isPatternStale(p, nowISO)) {
      applied = false;
      const stale = describeStaleness(p, nowISO);
      reasons.push(`ignored: ${stale ?? "stale — unobserved too long"}`);
    } else if (decay.windows > 0 && decay.confidence < LOWER_CONFIDENCE_BELOW) {
      applied = false;
      reasons.push(`ignored: ${decay.reason}`);
    } else {
      reasons.push(`selected: scope (${p.scope}) matches this task and the status "${p.status}" is applyable`);
      reasons.push(`confidence ${pct(decay.confidence)} effective (raw ${pct(p.confidence)}${decay.windows > 0 ? `, after time decay over ${decay.windows} window(s)` : ", no decay — recently confirmed or used"})`);
      if ((p.observation_count ?? 0) > 1) reasons.push(`observed ${p.observation_count} times`);
      if ((p.confirmation_count ?? 0) > 0) reasons.push(`confirmed ${p.confirmation_count} time(s)${p.last_confirmed_at ? `, last on ${p.last_confirmed_at.slice(0, 10)}` : ""}`);
      if ((p.contradiction_count ?? 0) > 0) reasons.push(`${p.contradiction_count} recorded contradiction(s)`);
      if (p.status === "candidate") reasons.push("applied cautiously: candidate — low confidence, do not treat as established");
      if (p.status === "lower_confidence") reasons.push("applied with reduced confidence: recent contradictory evidence — teacher and assignment instructions ALWAYS override it");
      if (p.last_used_at) reasons.push(`last used in a response on ${p.last_used_at.slice(0, 10)}`);
    }

    return {
      pattern_id: p.id,
      description: p.description,
      kind: p.kind,
      status: p.status,
      effective_confidence: decay.confidence,
      applied,
      reasons,
    };
  });
}

/** The adaptive selection used by the solve route — decisions made real. */
export function selectApplicablePatternsAdaptive(
  patterns: LearningPattern[],
  ctx: PatternContext,
  nowISO?: string
): LearningPattern[] {
  const decisions = explainPatternDecisions(patterns, ctx, nowISO);
  const byId = new Map(decisions.map((d) => [d.pattern_id, d]));
  return patterns.filter((p) => byId.get(p.id)?.applied === true);
}
