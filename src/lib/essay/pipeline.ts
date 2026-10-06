/**
 * Staged essay pipeline (2026-10-06 hardening round).
 *
 * The workflow is a fixed 13-stage pipeline, executed stage by stage with
 * artifacts the user can inspect — NEVER an entire essay as one opaque
 * response when paced writing is requested:
 *
 *   ASSIGNMENT ANALYSIS → RUBRIC → TEACHER REQUIREMENTS → RESEARCH →
 *   EVIDENCE MAP → THESIS → OUTLINE → SECTION DRAFTS → CITATION AUDIT →
 *   RUBRIC AUDIT → STYLE AUDIT → FINAL VERIFICATION → PACED PRESENTATION
 *
 * Hard gates (all tested):
 *  - Before drafting, a COMPACT ASSIGNMENT PLAN is shown (analysis, rubric,
 *    teacher requirements; for research essays: selected sources and
 *    evidence).
 *  - The user may approve or edit the OUTLINE before any section is drafted.
 *    `canDraft` refuses otherwise — structurally, not by convention.
 *  - Sections are drafted ONE AT A TIME (one server call per section);
 *    audits run per section, and final verification runs once at the end.
 */

export const ESSAY_STAGES = [
  "assignment_analysis", "rubric", "teacher_requirements", "research",
  "evidence_map", "thesis", "outline", "section_drafts", "citation_audit",
  "rubric_audit", "style_audit", "final_verification", "paced_presentation",
] as const;

export type EssayStage = (typeof ESSAY_STAGES)[number];

export interface StageStatus {
  stage: EssayStage;
  status: "pending" | "complete" | "blocked";
  summary: string;
}

export function stageIndex(stage: EssayStage): number {
  return ESSAY_STAGES.indexOf(stage);
}

export function nextStage(current: EssayStage): EssayStage | null {
  const i = stageIndex(current);
  return i < 0 || i >= ESSAY_STAGES.length - 1 ? null : ESSAY_STAGES[i + 1];
}

/* ------------------------------------------------------------------ */
/* The assignment plan (compact, shown BEFORE drafting)                 */
/* ------------------------------------------------------------------ */

export interface RubricRequirement { criterion: string; points: number; notes?: string }
export interface TeacherRequirement { requirement: string; source: string }
export interface EvidenceItem { label: string; claim: string; sourceTitle: string; sourceUrl: string; passage: string }
export interface OutlineSection { id: string; title: string; points: string[]; evidenceLabels: string[]; targetWords: number }

export interface AssignmentPlan {
  title: string;
  genre: string;
  academicLevel: string;
  wordTarget: number;
  analysis: { assignmentType: string; keyRequirements: string[]; constraints: string[] };
  rubric: RubricRequirement[];
  teacherRequirements: TeacherRequirement[];
  /** for research essays — the selected sources and evidence, shown pre-draft */
  sources: { label: string; title: string; url: string; approved: boolean }[];
  evidenceMap: EvidenceItem[];
  thesis: string;
  outline: OutlineSection[];
}

/** Compact, human-readable assignment plan — rendered before drafting. */
export function formatAssignmentPlan(plan: AssignmentPlan): string {
  const lines: string[] = [];
  lines.push(`ASSIGNMENT: ${plan.title} (${plan.genre}, ${plan.academicLevel}, ~${plan.wordTarget} words)`);
  lines.push(`ANALYSIS: ${plan.analysis.assignmentType}`);
  for (const r of plan.analysis.keyRequirements) lines.push(`  - requirement: ${r}`);
  for (const c of plan.analysis.constraints) lines.push(`  - constraint: ${c}`);
  if (plan.rubric.length > 0) {
    lines.push("RUBRIC:");
    for (const r of plan.rubric) lines.push(`  - ${r.criterion} (${r.points} pts)${r.notes ? ` — ${r.notes}` : ""}`);
  } else {
    lines.push("RUBRIC: none on file — the plan uses the teacher's requirements only");
  }
  if (plan.teacherRequirements.length > 0) {
    lines.push("TEACHER REQUIREMENTS:");
    for (const t of plan.teacherRequirements) lines.push(`  - ${t.requirement} (from ${t.source})`);
  }
  if (plan.sources.length > 0) {
    lines.push(`SELECTED SOURCES (${plan.sources.length}):`);
    for (const s of plan.sources) lines.push(`  - [${s.label}] ${s.title}${s.approved ? " (approved & verified)" : " (NOT approved — draft will be blocked)"} — ${s.url}`);
  } else {
    lines.push("SOURCES: none (non-research essay)");
  }
  if (plan.evidenceMap.length > 0) {
    lines.push(`EVIDENCE MAP (${plan.evidenceMap.length}):`);
    for (const e of plan.evidenceMap) lines.push(`  - [${e.label}] for "${e.claim}" — from "${e.sourceTitle}"`);
  }
  lines.push(`THESIS: ${plan.thesis}`);
  lines.push(`OUTLINE (${plan.outline.length} sections):`);
  for (const s of plan.outline) lines.push(`  ${s.id}. ${s.title} (~${s.targetWords} words) — ${s.points.join("; ")}${s.evidenceLabels.length ? ` [evidence: ${s.evidenceLabels.join(", ")}]` : ""}`);
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* The drafting gate                                                    */
/* ------------------------------------------------------------------ */

export interface EssaySessionState {
  outlineApproved: boolean;
  outline: OutlineSection[];
  sections: { id: string; draft: string | null; audits: { citation: string; rubric: string; style: string } | null }[];
  finalVerification: { status: string; note: string } | null;
}

export function newEssaySession(outline: OutlineSection[]): EssaySessionState {
  return {
    outlineApproved: false,
    outline,
    sections: outline.map((s) => ({ id: s.id, draft: null, audits: null })),
    finalVerification: null,
  };
}

/**
 * The drafting gate: section drafting is structurally IMPOSSIBLE until the
 * user has approved (or edited + approved) the outline. Returns a refusal
 * reason instead of a boolean so callers must surface it.
 */
export function canDraft(state: EssaySessionState): { allowed: true } | { allowed: false; reason: string } {
  if (!state.outlineApproved) {
    return { allowed: false, reason: "The outline is not approved yet. Review the assignment plan and approve or edit the outline — Sophira will not draft before that." };
  }
  return { allowed: true };
}

/**
 * Which section is next to draft. One section per call — an entire essay is
 * never returned as a single opaque response.
 */
export function nextSectionToDraft(state: EssaySessionState): string | null {
  return state.sections.find((s) => s.draft === null)?.id ?? null;
}

export function allSectionsDrafted(state: EssaySessionState): boolean {
  return state.sections.every((s) => s.draft !== null);
}

/** Never hand back "the whole essay" through a single drafting call: the
 *  assembled essay exists only in PACED PRESENTATION, revealed per section. */
export function assembledEssay(state: EssaySessionState): string {
  return state.outline
    .map((o) => {
      const s = state.sections.find((x) => x.id === o.id);
      return s?.draft ?? "";
    })
    .filter(Boolean)
    .join("\n\n");
}
