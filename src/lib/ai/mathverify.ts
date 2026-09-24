/**
 * Independent arithmetic verification (spec §10).
 *
 * The model is asked (for math/science workflows) to emit `machine_checks`:
 * simple arithmetic identities derived from its solution, e.g.
 *   { "label": "final substitution check", "expr": "3*7+2", "expected": "23" }
 *
 * This module re-computes each expression with mathjs — a deterministic
 * engine, not the language model. It verifies that the arithmetic identity
 * the model claims is actually true, which is genuine independent computation.
 * It does NOT prove the solution is correct, and the labels say so honestly.
 */

import { create, all } from "mathjs";

const math = create(all, {});

export interface MachineCheckInput {
  label?: string;
  expr: string;
  expected: string | number;
}

export interface MachineCheckResult {
  name: string;
  passed: boolean;
  method: "computational";
  detail: string;
}

/** Hard cap on expression size/complexity — these run in our server process. */
const MAX_EXPR_LEN = 200;

export function runMachineChecks(checks: unknown): {
  results: MachineCheckResult[];
  allPassed: boolean;
} {
  const results: MachineCheckResult[] = [];
  if (!Array.isArray(checks)) return { results, allPassed: false };

  for (const raw of checks.slice(0, 10)) {
    const c = raw as MachineCheckInput;
    if (typeof c?.expr !== "string" || c.expr.length > MAX_EXPR_LEN) continue;

    const name = `Arithmetic check${c.label ? `: ${c.label}` : ""} (re-computed independently with mathjs)`;
    try {
      const actual = math.evaluate(c.expr);
      const expectedNum = typeof c.expected === "number" ? c.expected : Number(c.expected);
      const actualNum = typeof actual === "number" ? actual : Number(actual);
      if (!Number.isFinite(actualNum)) throw new Error("not a finite number");
      if (!Number.isFinite(expectedNum)) throw new Error("expected value is not a number");
      const tol = Math.max(1e-9, Math.abs(expectedNum) * 1e-6);
      const passed = Math.abs(actualNum - expectedNum) <= tol;
      results.push({
        name,
        passed,
        method: "computational",
        detail: passed
          ? `${c.expr} = ${actualNum} ✓ (matches the claimed ${expectedNum})`
          : `${c.expr} evaluates to ${actualNum}, but the solution claimed ${expectedNum} — the arithmetic does NOT check out and needs revision.`,
      });
    } catch (err) {
      results.push({
        name,
        passed: false,
        method: "computational",
        detail: `Could not compute "${c.expr}" as an arithmetic expression (${err instanceof Error ? err.message : "invalid expression"}).`,
      });
    }
  }

  return { results, allPassed: results.length > 0 && results.every((r) => r.passed) };
}
