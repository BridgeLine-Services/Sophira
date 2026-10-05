/**
 * FINAL SUBMISSION READINESS GATE (2026-10-05 round).
 *
 * An upgrade of the existing readiness system (src/lib/readiness.ts stays
 * untouched; this module composes it) and of the existing rubric engine
 * (src/lib/rubric.ts — used as-is, never replaced).
 *
 * Machine-enforced invariant (tested):
 *   submission_ready === true  ⇔  NO hard requirement failed.
 * Sophira NEVER labels an assignment "Ready to Submit" while any hard
 * teacher, rubric, formatting, research or assignment requirement has
 * failed — and a requirement that cannot be verified blocks too
 * ("not verified" is never silently treated as satisfied).
 *
 * The gate evaluates, at minimum: assignment instructions, teacher
 * instructions, rubric requirements (via the existing checklist/audit),
 * word count, required sections, required headings (as section
 * criteria), formatting requirements, citation count, citation style,
 * bibliography/Works Cited/References, required sources, prohibited
 * elements, semantic requirements, research integrity, claim-to-source
 * verification, source authority requirements, unresolved placeholders,
 * unsupported factual claims, missing required sections, and deadline
 * feasibility (feasibility warnings are honest warnings — the deadline
 * is not a content requirement, and pretending time exists would be
 * dishonest the other way).
 */

import {
  auditDraft,
  type RubricAuditResult,
  type RubricChecklist,
  type CriterionResult,
} from "../rubric";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type GateStatus = "pass" | "fail" | "warn";

export interface GateRequirement {
  id: string;
  label: string;
  status: GateStatus;
  /** A hard requirement blocks submission when it fails. */
  hard: boolean;
  evidence: string;
  correction: string;
}

export interface FinalGateResult {
  submission_ready: boolean; // machine-enforced
  status: "READY" | "NOT_READY";
  requirements: GateRequirement[];
  passed: GateRequirement[];
  failed: GateRequirement[];
  warnings: GateRequirement[];
  rubric_status: {
    passed: number;
    partial: number;
    failed: number;
    needs_semantic: number;
    detail: string;
  };
  research_integrity: {
    status: GateStatus | "not_applicable";
    claims_supported: number;
    claims_total: number;
    urls_resolve: number;
    urls_total: number;
    authority_satisfied: number;
    authority_total: number;
    unsupported_claims: string[];
    detail: string;
  };
  citation_integrity: {
    status: GateStatus;
    bibliography_ok: boolean | null; // null = no requirement detected
    citation_count: number | null;
    citation_style_ok: boolean | null;
    detail: string;
  };
  /** Exact reasons submission is blocked — one per failed hard requirement. */
  blockers: string[];
}

export interface FinalGateResearch {
  linked: boolean;
  minSources: number | null;
  approvedSources: number;
  integrity: {
    research_complete: boolean;
    claims_supported: number;
    claims_total: number;
    urls_resolve: number;
    urls_total: number;
    authority_satisfied: number;
    authority_total: number;
    failures: { claim_text: string; reason: string }[];
  } | null;
}

export interface FinalGateInput {
  nowMs: number;
  draft: string | null;
  /** Built by the caller with the existing buildChecklist(). */
  checklist: RubricChecklist;
  /** Latest PERSISTED rubric audit (AI-assessed semantic results reused by
   * criterion id, honestly labeled; never fabricated). */
  persistedAudit: RubricAuditResult | null;
  verification: { status: string | null; failedChecks: string[] } | null;
  methodCompliance: { status: string | null; notes: string | null } | null;
  research: FinalGateResearch | null;
  dueMs: number | null;
  /** Remaining estimated work minutes, if the schedule system knows it. */
  estimatedRemainingWorkMinutes: number | null;
}

/* ------------------------------------------------------------------ */
/* Unresolved placeholders — new deterministic check                    */
/* ------------------------------------------------------------------ */

const PLACEHOLDER_RE =
  /\[(?:\s*todo\b[^\]]*|\s*tbd\b|\s*placeholder\b|\s*insert[^\]]*|\s*citation needed\s*|\s*your [^\]]*|\s*___+)\]|\btodo\b|\btbd\b|\bxxxx\b|\?\?\?|_{5,}|<[a-z ]{2,20}>/gi;

export function findUnresolvedPlaceholders(draft: string): string[] {
  const out: string[] = [];
  const re = new RegExp(PLACEHOLDER_RE.source, PLACEHOLDER_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(draft)) !== null) {
    const frag = m[0].trim();
    if (frag && !out.includes(frag)) out.push(frag);
  }
  return out.slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* The gate                                                             */
/* ------------------------------------------------------------------ */

export function evaluateFinalGate(input: FinalGateInput): FinalGateResult {
  const requirements: GateRequirement[] = [];
  const push = (r: GateRequirement) => requirements.push(r);

  /* -- 1. The draft itself ---------------------------------------- */
  const draft = input.draft ?? "";
  const hasDraft = draft.trim().length > 0;
  push({
    id: "draft",
    label: "Draft present",
    status: hasDraft ? "pass" : "fail",
    hard: true,
    evidence: hasDraft ? "The response contains a draft." : "No draft exists for this assignment.",
    correction: hasDraft ? "" : "Write the assignment first.",
  });

  /* -- 2. Assignment/teacher/rubric criteria (existing engine) ----- */
  // LIVE deterministic audit of the CURRENT draft — never a stale badge.
  const live = input.draft ? auditDraft(input.draft, input.checklist) : null;

  const semanticFromPersisted = new Map<string, CriterionResult>();
  for (const pr of input.persistedAudit?.results ?? []) {
    if (pr.status !== "needs_semantic") semanticFromPersisted.set(pr.id, pr);
  }

  let passed = 0, partial = 0, failed = 0, needsSemantic = 0;
  // Merged (live deterministic + stored AI-assessed semantics) — the
  // citation-integrity summary below MUST judge the merged state, never
  // the raw live state, or an AI-verified citation style would still block.
  const mergedResults: CriterionResult[] = [];

  if (live) {
    for (const c of live.results) {
      let status = c.status;
      let evidence = c.evidence;
      let correction = c.requiredCorrection;

      if (status === "needs_semantic") {
        const stored = semanticFromPersisted.get(c.id);
        if (stored) {
          // Reuse the stored AI-assessed result — honestly labeled.
          status = stored.status;
          evidence = `${stored.evidence} (reused from the stored AI-assessed audit)`;
          correction = stored.requiredCorrection;
        }
        // Still needs_semantic → cannot verify → BLOCKS (never a pass).
      }

      if (status === "satisfied") passed++;
      else if (status === "partial") { partial++; }
      else if (status === "not_satisfied") failed++;
      else needsSemantic++;

      mergedResults.push({ ...c, status, evidence, requiredCorrection: correction });
      push({
        id: `rubric:${c.id}`,
        label: c.label,
        status: status === "satisfied" ? "pass" : "fail",
        hard: true,
        evidence,
        correction:
          status === "needs_semantic"
            ? "This requirement could not be verified — run the rubric audit so it is evaluated."
            : correction,
      });
    }
  }

  /* -- 3. Unresolved placeholders ---------------------------------- */
  const placeholders = input.draft ? findUnresolvedPlaceholders(input.draft) : [];
  push({
    id: "placeholders",
    label: "No unresolved placeholders",
    status: placeholders.length === 0 ? "pass" : "fail",
    hard: true,
    evidence:
      placeholders.length === 0
        ? "No placeholder markers (TODO, [insert…], ___) found in the draft."
        : `Unresolved placeholders found: ${placeholders.map((p) => `"${p}"`).join(", ")}.`,
    correction: placeholders.length ? "Replace every placeholder with real content." : "",
  });

  /* -- 4. Independent verification (machine checks / self checks) --- */
  if (!input.verification || !input.verification.status) {
    push({
      id: "verification",
      label: "Independent verification",
      status: "warn",
      hard: false,
      evidence: "No verification record for this draft — review the draft yourself before submitting.",
      correction: "",
    });
  } else if ((input.verification.failedChecks ?? []).length > 0) {
    push({
      id: "verification",
      label: "Independent verification",
      status: "fail",
      hard: true,
      evidence: `FAILED machine check(s): ${(input.verification.failedChecks ?? []).join("; ")}.`,
      correction: "Fix the failed checks before submitting.",
    });
  } else if (input.verification.status === "verified") {
    push({
      id: "verification",
      label: "Independent verification",
      status: "pass",
      hard: true,
      evidence: "Independent checks passed.",
      correction: "",
    });
  } else {
    push({
      id: "verification",
      label: "Independent verification",
      status: "warn",
      hard: false,
      evidence: "No failed checks, but the draft was flagged for manual review.",
      correction: "",
    });
  }

  /* -- 5. Teacher's required method -------------------------------- */
  const mc = input.methodCompliance;
  if (!mc || !mc.status || mc.status === "not_applicable") {
    // No method requirements — not applicable, never blocking.
  } else if (mc.status === "compliant") {
    push({
      id: "method_compliance",
      label: "Teacher's required method",
      status: "pass", hard: true,
      evidence: "The work follows the teacher's required methods.",
      correction: "",
    });
  } else {
    push({
      id: "method_compliance",
      label: "Teacher's required method",
      status: "fail", hard: true,
      evidence: `The work does ${mc.status === "partial" ? "only partially" : "not"} follow the teacher's required methods.${mc.notes ? " " + mc.notes : ""}`,
      correction: "Revise the work to follow the teacher's required methods.",
    });
  }

  /* -- 6. Research: required sources, integrity, authority, claims - */
  let researchSummary: FinalGateResult["research_integrity"] = {
    status: "not_applicable",
    claims_supported: 0, claims_total: 0, urls_resolve: 0, urls_total: 0,
    authority_satisfied: 0, authority_total: 0, unsupported_claims: [],
    detail: "No research project linked to this assignment.",
  };

  const res = input.research;
  if (res && res.linked) {
    // Required sources.
    if (res.minSources !== null && res.minSources > 0) {
      const enough = res.approvedSources >= res.minSources;
      push({
        id: "required_sources",
        label: `${res.minSources} required source${res.minSources === 1 ? "" : "s"}`,
        status: enough ? "pass" : "fail",
        hard: true,
        evidence: `${res.approvedSources} approved & verified source${res.approvedSources === 1 ? "" : "s"} (required: at least ${res.minSources}).`,
        correction: enough ? "" : "Approve/verify more sources or research additional ones.",
      });
    }

    // Research integrity + claim-to-source verification + authority.
    const integ = res.integrity;
    if (!integ) {
      push({
        id: "research_integrity",
        label: "Research integrity",
        status: "fail", hard: true,
        evidence: "The research integrity report has not been produced for this work — acceptance cannot be verified.",
        correction: "Run the citation audit before submitting.",
      });
      researchSummary = {
        ...researchSummary,
        status: "fail",
        detail: "Research integrity report not produced.",
      };
    } else {
      const complete = integ.research_complete === true;
      const unsupported = integ.failures.map((f) => `${f.claim_text} — ${f.reason}`);
      const authorityOk = integ.authority_total === 0 || integ.authority_satisfied === integ.authority_total;
      push({
        id: "research_integrity",
        label: "All factual claims supported (research integrity)",
        status: complete ? "pass" : "fail",
        hard: true,
        evidence: complete
          ? `All ${integ.claims_supported}/${integ.claims_total} factual claims are traced to verified evidence; ${integ.urls_resolve}/${integ.urls_total} URLs resolve.`
          : `Research NOT complete: ${integ.claims_supported}/${integ.claims_total} factual claims supported.${unsupported.length ? " Unsupported: " + unsupported.slice(0, 5).join("; ") : ""}`,
        correction: complete ? "" : "Revise or remove the unsupported claims, or replace their sources.",
      });
      push({
        id: "source_authority",
        label: "Source authority requirements",
        status: authorityOk ? "pass" : "fail",
        hard: true,
        evidence: authorityOk
          ? `All ${integ.authority_satisfied}/${integ.authority_total} sources satisfy the assignment's authority requirements.`
          : `Only ${integ.authority_satisfied}/${integ.authority_total} sources satisfy the assignment's authority requirements.`,
        correction: authorityOk ? "" : "Replace the sources that fail the authority requirement.",
      });
      researchSummary = {
        status: complete ? "pass" : "fail",
        claims_supported: integ.claims_supported,
        claims_total: integ.claims_total,
        urls_resolve: integ.urls_resolve,
        urls_total: integ.urls_total,
        authority_satisfied: integ.authority_satisfied,
        authority_total: integ.authority_total,
        unsupported_claims: unsupported,
        detail: complete
          ? `Research integrity verified: ${integ.claims_supported}/${integ.claims_total} claims supported, ${integ.urls_resolve}/${integ.urls_total} URLs live.`
          : `Research integrity FAILED: ${integ.claims_supported}/${integ.claims_total} claims supported.`,
      };
    }
  }

  /* -- 7. Citation integrity summary (from the live criteria) ------- */
  const bib = mergedResults.find((r) => r.kind === "bibliography");
  const citeCount = mergedResults.find((r) => r.kind === "citation_count");
  const citeStyle = mergedResults.find((r) => r.kind === "citation_style");
  const bibOk = bib ? bib.status === "satisfied" : null;
  const styleOk = citeStyle ? citeStyle.status === "satisfied" : null;
  const citationOk =
    (bibOk === null || bibOk) && (styleOk === null || styleOk) &&
    (!citeCount || citeCount.status === "satisfied");
  push({
    id: "citation_integrity",
    label: "Citations & bibliography",
    status: citationOk ? "pass" : "fail",
    hard: true,
    evidence: [
      bibOk === null ? null : bibOk ? "Works Cited/Bibliography present." : "Works Cited/Bibliography MISSING.",
      citeCount ? citeCount.evidence : null,
      styleOk === null ? null : styleOk ? "Citation style consistent." : "Citation style could not be confirmed.",
    ].filter(Boolean).join(" ") || "No citation requirements detected for this assignment.",
    correction: citationOk ? "" : "Fix the citation/bibliography requirements above.",
  });

  /* -- Machine enforcement (content) -------------------------------- */
  const failedReq = requirements.filter((r) => r.status === "fail");
  const blockers = failedReq
    .filter((r) => r.hard)
    .map((r) => `${r.label}: ${r.evidence}${r.correction ? ` (${r.correction})` : ""}`);

  /* -- 8. Deadline feasibility (honest warning, never a fake pass) -- */
  // The workload estimate is a CONSERVATIVE UPPER BOUND (from
  // estimateWorkMinutes): the gate uses it only while content blockers
  // exist. A gate-passing draft has nothing left to fix, so a stale
  // estimate can never make ready content look late or unfeasible.
  if (input.dueMs !== null) {
    if (input.dueMs <= input.nowMs) {
      push({
        id: "deadline",
        label: "Deadline feasibility",
        status: "warn",
        hard: false,
        evidence: "The deadline has already passed.",
        correction: "",
      });
    } else {
      const hoursLeft = Math.max(0, (input.dueMs - input.nowMs) / 3_600_000);
      const hasBlockers = blockers.length > 0;
      const needs = hasBlockers ? input.estimatedRemainingWorkMinutes : 0;
      const feasible = needs === null ? true : needs * 60 * 1000 <= input.dueMs - input.nowMs;
      push({
        id: "deadline",
        label: "Deadline feasibility",
        status: feasible ? "pass" : "warn",
        hard: false,
        evidence: feasible
          ? hasBlockers && needs !== null
            ? `${hoursLeft < 24 ? `${Math.round(hoursLeft)} hour(s)` : `${Math.round(hoursLeft / 24)} day(s)`} left — enough for the ~${needs} min (conservative upper-bound) estimated remaining work.`
            : `${hoursLeft < 24 ? `${Math.round(hoursLeft)} hour(s)` : `${Math.round(hoursLeft / 24)} day(s)`} left before the deadline; no content blockers remain.`
          : `Only ${Math.round(hoursLeft)} hour(s) left but about ${needs} minutes of estimated work remain (workload estimator upper bound) — the schedule warned this will not fit.`,
        correction: "",
      });
    }
  }

  const warnings = requirements.filter((r) => r.status === "warn");

  return {
    submission_ready: blockers.length === 0,
    status: blockers.length === 0 ? "READY" : "NOT_READY",
    requirements,
    passed: requirements.filter((r) => r.status === "pass"),
    failed: failedReq,
    warnings,
    rubric_status: {
      passed,
      partial,
      failed,
      needs_semantic: needsSemantic,
      detail: live
        ? `Rubric audit: ${passed} passed, ${partial} partial, ${failed} failed, ${needsSemantic} unresolved semantic.`
        : "Rubric audit not run — no draft to audit.",
    },
    research_integrity: researchSummary,
    citation_integrity: {
      status: citationOk ? "pass" : "fail",
      bibliography_ok: bibOk,
      citation_count: null,
      citation_style_ok: styleOk,
      detail: citationOk
        ? "Citation requirements satisfied (or none required)."
        : "Citation requirements NOT satisfied.",
    },
    blockers,
  };
}

/* ------------------------------------------------------------------ */
/* Human/machine-readable rendering (the SUBMISSION READINESS block)    */
/* ------------------------------------------------------------------ */

export function formatFinalGate(result: FinalGateResult): string {
  const lines = ["SUBMISSION READINESS", "", result.submission_ready ? "PASS" : "FAIL"];
  for (const r of result.passed) lines.push(`✓ ${r.label}`);
  for (const r of result.failed) lines.push(`✗ ${r.label}`);
  for (const r of result.warnings) lines.push(`! ${r.label} (warning)`);
  lines.push("", `STATUS: ${result.status === "READY" ? "READY TO SUBMIT" : "NOT READY"}`);
  for (const b of result.blockers) lines.push(`BLOCKED BY: ${b}`);
  return lines.join("\n");
}
