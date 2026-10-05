/**
 * Submission readiness (high-priority audit item H1, implemented
 * 2026-10-05): an aggregate, mechanical verdict per assignment that
 * answers ONE question — is this work ready to submit?
 *
 * It combines the systems that already exist (never re-implementing them):
 *   - the draft itself (content present),
 *   - independent verification (math machine checks / self checks),
 *   - teacher method compliance,
 *   - the rubric audit (criteria satisfied),
 *   - research integrity (every factual claim traced to verified evidence).
 *
 * Pure and deterministic: buildReadiness only aggregates what it is given;
 * it never invents a passing state, and anything it cannot determine is
 * reported as not-ready with the reason — the verdict is never guessed.
 */

export interface ReadinessCheck {
  id: "content" | "verification" | "method_compliance" | "rubric" | "research_integrity";
  label: string;
  /** null = not applicable to this assignment (never counted as a pass). */
  passed: boolean | null;
  blocking: boolean;
  detail: string;
}

export interface SubmissionReadiness {
  ready: boolean;
  checks: ReadinessCheck[];
  blockers: string[];
}

export interface ReadinessVerification {
  status?: string | null;
  failedChecks?: string[];
}

export interface ReadinessMethodCompliance {
  status?: string | null;
  notes?: string | null;
}

export interface ReadinessRubricAudit {
  passed: number;
  partial: number;
  failed: number;
  needsSemantic: number;
  allPassed: boolean;
  aiAssessed: boolean;
}

export interface ReadinessResearch {
  /** Is a research project linked to this assignment? */
  linked: boolean;
  /** research_complete from the stored Research Integrity report; null = not yet computed. */
  researchComplete: boolean | null;
  claimsSupported: number | null;
  claimsTotal: number | null;
  urlsResolve: number | null;
  urlsTotal: number | null;
}

export interface ReadinessInput {
  hasDraft: boolean;
  draftWords: number;
  verification: ReadinessVerification | null;
  methodCompliance: ReadinessMethodCompliance | null;
  /** Does the assignment define rubric/instruction criteria at all? */
  hasRubricCriteria: boolean;
  /** Latest persisted rubric audit for the draft, or null if none was run. */
  rubricAudit: ReadinessRubricAudit | null;
  research: ReadinessResearch | null;
}

export function buildReadiness(input: ReadinessInput): SubmissionReadiness {
  const checks: ReadinessCheck[] = [];

  // 1. Content exists.
  const contentOk = input.hasDraft && input.draftWords >= 10;
  checks.push({
    id: "content",
    label: "Draft present",
    passed: contentOk,
    blocking: true,
    detail: input.hasDraft
      ? input.draftWords >= 10
        ? `The draft has ${input.draftWords} words.`
        : `The draft is only ${input.draftWords} words — too short to submit.`
      : "No draft exists for this assignment yet.",
  });

  // 2. Independent verification (machine checks / self checks).
  const v = input.verification;
  if (!v || !v.status) {
    checks.push({ id: "verification", label: "Verification", passed: null, blocking: false, detail: "No verification record for this draft." });
  } else if ((v.failedChecks ?? []).length > 0) {
    checks.push({
      id: "verification", label: "Verification", passed: false, blocking: true,
      detail: `${(v.failedChecks ?? []).length} machine check(s) FAILED: ${(v.failedChecks ?? []).join("; ")}. Fix these before submitting.`,
    });
  } else if (v.status === "verified") {
    checks.push({ id: "verification", label: "Verification", passed: true, blocking: true, detail: "Independent checks passed." });
  } else {
    // needs_verification / unverified: an honest warning, not a silent pass.
    checks.push({
      id: "verification", label: "Verification", passed: null, blocking: false,
      detail: v.status === "needs_verification"
        ? "Flagged for manual review (needs verification) — no failed checks."
        : "Not independently verified (no failed checks either) — review the draft yourself before submitting.",
    });
  }

  // 3. Teacher method compliance.
  const mc = input.methodCompliance;
  if (!mc || !mc.status || mc.status === "not_applicable") {
    checks.push({ id: "method_compliance", label: "Teacher's method", passed: null, blocking: false, detail: "No method requirements apply to this work." });
  } else if (mc.status === "compliant") {
    checks.push({ id: "method_compliance", label: "Teacher's method", passed: true, blocking: true, detail: "The work follows the teacher's required methods." });
  } else {
    checks.push({
      id: "method_compliance", label: "Teacher's method", passed: false, blocking: true,
      detail: mc.status === "non_compliant"
        ? `The work does not follow the teacher's required methods.${mc.notes ? " " + mc.notes : ""}`
        : `The work only partially follows the teacher's required methods.${mc.notes ? " " + mc.notes : ""}`,
    });
  }

  // 4. Rubric audit.
  if (!input.hasRubricCriteria) {
    checks.push({ id: "rubric", label: "Rubric criteria", passed: null, blocking: false, detail: "No rubric or instruction criteria detected for this assignment." });
  } else if (!input.rubricAudit) {
    checks.push({ id: "rubric", label: "Rubric criteria", passed: false, blocking: true, detail: "The rubric audit has not been run for this draft — run it before submitting." });
  } else if (input.rubricAudit.allPassed) {
    checks.push({
      id: "rubric", label: "Rubric criteria", passed: true, blocking: true,
      detail: `All ${input.rubricAudit.passed} rubric criteria satisfied (${input.rubricAudit.aiAssessed ? "including AI-assessed semantic criteria" : "deterministic checks"}).`,
    });
  } else {
    const r = input.rubricAudit;
    const bits: string[] = [];
    if (r.failed > 0) bits.push(`${r.failed} failed`);
    if (r.partial > 0) bits.push(`${r.partial} partial`);
    if (r.needsSemantic > 0) bits.push(`${r.needsSemantic} unresolved semantic criteria`);
    checks.push({
      id: "rubric", label: "Rubric criteria", passed: false, blocking: true,
      detail: `Rubric audit not passed: ${bits.join(", ") || "criteria outstanding"} — revise and re-audit.`,
    });
  }

  // 5. Research integrity (only when research is linked).
  const res = input.research;
  if (!res || !res.linked) {
    checks.push({ id: "research_integrity", label: "Research integrity", passed: null, blocking: false, detail: "No research project linked to this assignment." });
  } else if (res.researchComplete === null) {
    checks.push({ id: "research_integrity", label: "Research integrity", passed: false, blocking: true, detail: "The research integrity report has not been produced for this draft — regenerate or run the research audit." });
  } else if (res.researchComplete === true) {
    checks.push({
      id: "research_integrity", label: "Research integrity", passed: true, blocking: true,
      detail: res.claimsTotal !== null && res.claimsTotal > 0
        ? `All ${res.claimsSupported}/${res.claimsTotal} factual claims supported by verified sources; ${res.urlsResolve}/${res.urlsTotal} URLs resolve.`
        : "Research integrity verified.",
    });
  } else {
    checks.push({
      id: "research_integrity", label: "Research integrity", passed: false, blocking: true,
      detail: `Research is NOT complete: ${res.claimsSupported ?? 0}/${res.claimsTotal ?? 0} factual claims supported — revise or remove the failed claims, or replace their sources.`,
    });
  }

  const blockers = checks.filter((c) => c.blocking && c.passed === false).map((c) => `${c.label}: ${c.detail}`);
  return {
    ready: blockers.length === 0,
    checks,
    blockers,
  };
}
