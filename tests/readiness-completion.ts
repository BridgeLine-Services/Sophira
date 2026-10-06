/**
 * SUBMISSION-READINESS COMPLETION (2026-10-06): the final gate now covers
 * teacher-rule conflicts, pending student corrections, and paced-output
 * state, and every issue carries a deterministic anchor so the UI can
 * take the user straight to the relevant part of the assignment.
 * The existing engines (rubric, citation invariant, research integrity,
 * staleness/learning) are used as-is — nothing is replaced here.
 */
import { readFileSync } from "fs";
import { evaluateFinalGate, findUnresolvedPlaceholders } from "../src/lib/readiness/finalGate";

type Assert = (c: boolean, n: string) => void;
type Section = (t: string) => void;

const baseInput: Parameters<typeof evaluateFinalGate>[0] = JSON.parse(
  readFileSync("tests/fixtures/final-gate-base.json", "utf8")
) as Parameters<typeof evaluateFinalGate>[0];

export function runReadinessCompletionTests(assert: Assert, section: Section): void {
  section("Submission-readiness completion: conflicts, corrections, output state, anchors");

  // 1. teacher-rule conflicts unresolved -> NOT READY (hard), anchored
  const conflict = evaluateFinalGate({ ...baseInput, teacherConflicts: { unresolved: 1, detail: "MLA vs APA citation style" } });
  const tc = conflict.requirements.find((r) => r.id === "teacher_conflicts");
  assert(tc !== undefined, "gate: teacher-rule conflicts are a real requirement");
  assert(tc!.status === "fail" && tc!.hard === true, "gate: unresolved teacher-rule conflict blocks submission");
  assert(tc!.evidence.includes("MLA vs APA"), "gate: the conflict detail is stated as evidence");
  assert(tc!.anchor === "rules", "gate: the conflict issue carries the deterministic 'rules' anchor");
  assert(conflict.submission_ready === false, "gate: unresolved teacher conflict -> NOT READY TO SUBMIT");

  // 2. conflicts resolved -> PASS, no leak of a fake issue
  const ok = evaluateFinalGate({ ...baseInput, teacherConflicts: { unresolved: 0 } });
  const tc2 = ok.requirements.find((r) => r.id === "teacher_conflicts");
  assert(tc2!.status === "pass", "gate: zero unresolved conflicts -> PASS");
  assert(ok.submission_ready === true, "gate: resolved conflicts alone never make an assignment NOT READY");

  // 3. pending student corrections -> NOT READY (hard), anchored
  const corr = evaluateFinalGate({ ...baseInput, pendingCorrections: 2 });
  const pc = corr.requirements.find((r) => r.id === "pending_corrections");
  assert(pc!.status === "fail" && pc!.hard === true && pc!.anchor === "corrections",
    "gate: pending unincorporated corrections block submission and jump to corrections");
  assert(pc!.evidence.includes("2"), "gate: the pending count is honest");
  assert(corr.submission_ready === false, "gate: pending corrections -> NOT READY");

  // 4. null (no record) -> honest skip, never a fake pass/fail
  const skip = evaluateFinalGate({ ...baseInput, teacherConflicts: null, pendingCorrections: null });
  assert(skip.requirements.find((r) => r.id === "teacher_conflicts") === undefined,
    "gate: a null conflict record is skipped honestly — no fabricated check result");

  // 5. paced output in progress -> honest WARN, never READY while unfinished
  const pace = evaluateFinalGate({ ...baseInput, outputInProgress: true });
  const op = pace.requirements.find((r) => r.id === "output_state");
  assert(op!.status === "warn" && op!.hard === false, "gate: in-progress paced output is an honest warning, not a blocker");
  assert(pace.warnings.includes(op!), "gate: the output warning is surfaced in warnings");
  assert(pace.submission_ready === true, "gate: the warn never fabricates a NOT READY by itself");

  // 6. anchors exist on every core issue class (click-through contract)
  const failing = evaluateFinalGate({ ...baseInput, draft: "todo [citation needed]", teacherConflicts: { unresolved: 1 } });
  const anchored = failing.requirements.filter((r) => r.status !== "pass").every((r) => (r.anchor ?? "").length > 0);
  assert(anchored, "gate: every failing requirement carries an anchor for click-through navigation");

  // 7. panel is clickable
  const panel = readFileSync("src/components/app/ReadinessPanel.tsx", "utf8");
  assert(panel.includes("Go to this part") && panel.includes("goToIssue"),
    "panel: failing issues render a Go-to link that navigates to the anchored element");
  assert(panel.includes("scrollIntoView"), "panel: navigation is a real in-page jump, not decorative");

  // 8. placeholders engine still intact (no regression from the additions)
  assert(findUnresolvedPlaceholders("see [citation needed]").length > 0,
    "gate: placeholder detection still works after the completion additions");
}
