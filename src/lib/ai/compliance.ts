/**
 * Method Compliance Check (upgrade spec §2).
 *
 * A correct final answer does NOT prove the teacher's required method was
 * followed. This module normalizes the model's self-reported method-compliance
 * (required method, formulas, notation, step count, calculator restrictions,
 * formatting, units, assignment-specific instructions) into a validated,
 * honest structure. It is displayed SEPARATELY from mathematical verification.
 *
 * The model self-reports compliance (it is the only one that knows what it
 * produced), so the status is always labeled honestly as a self-check.
 */

export interface MethodCompliance {
  status: "compliant" | "partial" | "non_compliant" | "not_applicable";
  checks: { name: string; passed: boolean; detail: string }[];
  notes: string;
}

const STATUSES = ["compliant", "partial", "non_compliant", "not_applicable"] as const;

/**
 * Validates and normalizes the model's method_compliance output.
 * Anything malformed becomes an honest "not checked" — never a fabricated pass.
 */
export function normalizeMethodCompliance(raw: unknown): MethodCompliance {
  if (typeof raw !== "object" || raw === null) {
    return {
      status: "not_applicable",
      checks: [],
      notes: "No method-compliance report was returned — method compliance was NOT checked.",
    };
  }
  const r = raw as {
    status?: unknown;
    checks?: unknown;
    notes?: unknown;
  };

  const status = STATUSES.includes(r.status as (typeof STATUSES)[number])
    ? (r.status as MethodCompliance["status"])
    : "not_applicable";

  const checks: MethodCompliance["checks"] = Array.isArray(r.checks)
    ? (r.checks as { name?: unknown; passed?: unknown; detail?: unknown }[])
        .filter((c) => c && typeof c === "object")
        .map((c) => ({
          name: typeof c.name === "string" && c.name.trim() ? c.name.trim().slice(0, 200) : "Unnamed compliance check",
          passed: c.passed === true,
          detail: typeof c.detail === "string" ? c.detail.slice(0, 500) : "",
        }))
        .slice(0, 12)
    : [];

  // Honest consistency guard: any failed check demotes the status.
  const effectiveStatus: MethodCompliance["status"] =
    checks.some((c) => !c.passed) && status === "compliant" ? "partial" : status;

  const notes = typeof r.notes === "string" ? r.notes.slice(0, 600) : "";

  if (checks.length === 0 && status === "not_applicable") {
    return {
      status: "not_applicable",
      checks: [],
      notes: notes || "No teacher/course method requirements were available to check against.",
    };
  }
  return { status: effectiveStatus, checks, notes };
}

export const METHOD_COMPLIANCE_LABELS: Record<MethodCompliance["status"], string> = {
  compliant: "Method followed (AI self-check)",
  partial: "Method partially followed (AI self-check)",
  non_compliant: "Method requirement not met",
  not_applicable: "No method requirements to check",
};
