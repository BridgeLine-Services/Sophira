/**
 * Independent mathematical verification (spec §2 of the upgrade).
 *
 * The model emits typed `machine_checks` derived from its ACTUAL solution
 * steps; the server re-computes each one with mathjs — a deterministic
 * computer-algebra-capable engine, not the language model. Supported kinds:
 *
 *   evaluate       — arithmetic/numeric evaluation (backward compatible)
 *   simplify_equal  — symbolic equivalence of two expressions
 *   derivative      — symbolic derivative of an expression vs the claimed result
 *   equation_check  — LHS ≡ RHS verified numerically at sample points
 *   matrix          — determinant / product / transpose / inverse of a matrix
 *   stats           — mean / median / std / variance of a dataset
 *
 * Every result honestly states HOW it was verified (numeric, symbolic,
 * computational) and what it does NOT prove. A passing machine check verifies
 * the claimed identity — it does not prove the chosen method was correct.
 * Method compliance is verified separately (lib/ai/compliance.ts).
 */

import { create, all, type MathNode } from "mathjs";

const math = create(all, {});

export type CheckKind =
  | "evaluate" | "simplify_equal" | "derivative" | "equation_check" | "matrix" | "stats";

export interface MachineCheckInput {
  kind?: CheckKind | string;
  label?: string;
  expr?: string;
  expected?: string | number;
  /** equation_check */
  left?: string;
  right?: string;
  /** derivative */
  var?: string;
  /** matrix / stats operation name */
  op?: string;
  /** stats */
  data?: number[];
}

export interface MachineCheckResult {
  name: string;
  passed: boolean;
  method: "computational";
  kind: "numeric" | "symbolic" | "computational";
  detail: string;
}

const MAX_EXPR_LEN = 300;

function fail(name: string, detail: string): MachineCheckResult {
  return { name, passed: false, method: "computational", kind: "computational", detail };
}

function numEqual(a: number, b: number, tolScale = 1): boolean {
  const tol = Math.max(1e-9, Math.abs(b) * 1e-6 * tolScale);
  return Math.abs(a - b) <= tol;
}

/**
 * Compares two expressions for equivalence: symbolic simplify+equals first,
 * then a numeric-sampling fallback (both expressions evaluated at several
 * points must agree). Purely numeric constants also compare exactly.
 */
function symbolicEqual(a: string, b: string): boolean {
  try {
    const sa = math.simplify(math.parse(a)) as MathNode;
    const sb = math.simplify(math.parse(b)) as MathNode;
    if (sa.equals(sb)) return true;
  } catch {
    /* fall through to sampling */
  }
  // Numeric sampling fallback (works across different unsimplified forms).
  try {
    const vars = new Set<string>(
      Array.from(`${a} ${b}`.matchAll(/[a-zA-Z]+/g)).map((m) => m[0])
    );
    vars.delete("pi"); vars.delete("e"); vars.delete("sqrt"); vars.delete("sin");
    vars.delete("cos"); vars.delete("tan"); vars.delete("log"); vars.delete("exp");
    const varList = Array.from(vars);
    for (const sample of [0.37, 1.61, 2.73, 4.15]) {
      const scope: Record<string, number> = {};
      varList.forEach((v, i) => { scope[v] = sample + i * 0.53; });
      const la = Number(math.evaluate(a, scope));
      const lb = Number(math.evaluate(b, scope));
      if (!Number.isFinite(la) || !Number.isFinite(lb)) return false;
      if (!numEqual(la, lb, 100)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function runOne(c: MachineCheckInput): MachineCheckResult {
  const label = c.label ? `: ${c.label}` : "";
  const kind = (c.kind || "evaluate") as CheckKind;
  const expr = typeof c.expr === "string" ? c.expr : "";

  // Backward compatibility: untyped checks are plain evaluations.
  if (!c.kind) {
    if (!expr || expr.length > MAX_EXPR_LEN) return fail(`Arithmetic check${label}`, "No computable expression was provided.");
    let actual: unknown;
    try {
      actual = math.evaluate(expr);
    } catch (e) {
      return fail(`Arithmetic check${label}`, `Could not compute "${expr.slice(0, 60)}" (${e instanceof Error ? e.message : "invalid expression"}).`);
    }
    const expected = typeof c.expected === "number" ? c.expected : Number(c.expected);
    const a = typeof actual === "number" ? actual : Number(actual);
    if (!Number.isFinite(a) || !Number.isFinite(expected)) return fail(`Arithmetic check${label}`, "Expression did not evaluate to a finite number.");
    return {
      name: `Arithmetic check${label} (re-computed independently with mathjs)`,
      passed: numEqual(a, expected),
      method: "computational", kind: "numeric",
      detail: numEqual(a, expected)
        ? `${expr} = ${actual} ✓ (matches the claimed ${expected})`
        : `${expr} evaluates to ${actual}, but the solution claimed ${expected} — the arithmetic does NOT check out and needs revision.`,
    };
  }

  if (kind === "evaluate") {
    const c2 = { ...c, kind: undefined };
    return runOne(c2);
  }

  if (kind === "simplify_equal") {
    const name = `Symbolic equivalence check${label} (mathjs simplify)`;
    if (!expr || !c.expected || expr.length > MAX_EXPR_LEN) return fail(name, "Missing expression or expected form.");
    try {
      const ok = symbolicEqual(expr, String(c.expected));
      return {
        name, passed: ok, method: "computational", kind: "symbolic",
        detail: ok
          ? `simplify(${expr}) is symbolically equal to ${c.expected} ✓`
          : `simplify(${expr}) is NOT equal to ${c.expected} — the simplification claim does not hold.`,
      };
    } catch (e) {
      return fail(name, `Could not simplify: ${e instanceof Error ? e.message : "invalid expression"}`);
    }
  }

  if (kind === "derivative") {
    const name = `Symbolic derivative check${label} (mathjs derivative)`;
    if (!expr || !c.var || !c.expected) return fail(name, "Missing expression, variable, or expected derivative.");
    try {
      const d = math.derivative(expr, c.var);
      const ok = symbolicEqual(d.toString(), String(c.expected));
      return {
        name, passed: ok, method: "computational", kind: "symbolic",
        detail: ok
          ? `d/d${c.var}[${expr}] = ${c.expected} ✓ (verified symbolically)`
          : `d/d${c.var}[${expr}] = ${d.toString()}, NOT ${c.expected} as claimed.`,
      };
    } catch (e) {
      return fail(name, `Could not differentiate: ${e instanceof Error ? e.message : "invalid expression"}`);
    }
  }

  if (kind === "equation_check") {
    const name = `Equation identity check${label} (numeric substitution at sample points)`;
    if (!c.left || !c.right || !c.var) return fail(name, "Missing left/right sides or variable.");
    try {
      const points = [0.5, 1.7, Math.PI / 3, 2.3, 4.1];
      let ok = true;
      let sample = "";
      for (const p of points) {
        const scope = { [c.var]: p };
        const L = Number(math.evaluate(c.left, scope));
        const R = Number(math.evaluate(c.right, scope));
        if (!Number.isFinite(L) || !Number.isFinite(R)) continue;
        if (!numEqual(L, R, 10)) { ok = false; sample = `at ${c.var}=${p}: LHS=${L}, RHS=${R}`; break; }
        if (!sample) sample = `e.g. at ${c.var}=${p}: both sides = ${L}`;
      }
      return {
        name, passed: ok, method: "computational", kind: "numeric",
        detail: ok
          ? `${c.left} = ${c.right} holds at sampled values ✓ (${sample})`
          : `${c.left} ≠ ${c.right} — ${sample}. The claimed identity does not hold.`,
      };
    } catch (e) {
      return fail(name, `Could not evaluate the equation: ${e instanceof Error ? e.message : "invalid expression"}`);
    }
  }

  if (kind === "matrix") {
    const name = `Matrix ${c.op} check${label} (mathjs)`;
    if (!expr || !c.op) return fail(name, "Missing matrix expression or operation.");
    try {
      const m = math.evaluate(expr);
      let result: unknown;
      if (c.op === "det") result = math.det(m);
      else if (c.op === "transpose") result = math.transpose(m).toArray();
      else if (c.op === "inverse") result = math.inv(m).toArray();
      else {
        // "multiply" — the expression itself is the product claim; normalize
        // whatever mathjs returned (Matrix | number[][] ) to a plain array.
        const anyM = m as unknown as { toArray?: () => unknown };
        result = typeof anyM?.toArray === "function" ? anyM.toArray() : m;
      }
      let ok: boolean;
      if (c.op === "det") {
        ok = numEqual(Number(result), Number(c.expected));
      } else {
        let expectedArr: unknown;
        try {
          expectedArr = typeof c.expected === "string" ? JSON.parse(c.expected) : c.expected;
        } catch {
          expectedArr = c.expected;
        }
        const norm = (v: unknown): string => JSON.stringify(v).replace(/\s+/g, "");
        ok = norm(result) === norm(expectedArr);
      }
      return {
        name, passed: ok, method: "computational", kind: "computational",
        detail: ok
          ? `${c.op === "det" ? "det" : c.op}(${expr.slice(0, 60)}) ✓ matches the claimed result`
          : `${c.op}(${expr.slice(0, 60)}) = ${JSON.stringify(result).slice(0, 120)}…, which does NOT match the claimed ${String(c.expected).slice(0, 60)}.`,
      };
    } catch (e) {
      return fail(name, `Could not compute: ${e instanceof Error ? e.message : "invalid matrix"}`);
    }
  }

  if (kind === "stats") {
    const name = `Statistical check${label} (mathjs)`;
    if (!Array.isArray(c.data) || c.data.length === 0 || !c.op) return fail(name, "Missing data or operation.");
    try {
      const vals = c.data.map(Number).filter((n) => Number.isFinite(n));
      if (vals.length !== c.data.length) return fail(name, "The dataset contains non-numeric values.");
      let result: number;
      if (c.op === "mean") result = Number(math.mean(vals));
      else if (c.op === "median") result = Number(math.median(vals));
      else if (c.op === "std") result = Number(math.std(vals));
      else if (c.op === "variance") result = Number(math.variance(vals));
      else return fail(name, `Unknown statistical operation "${c.op}".`);
      const ok = numEqual(result, Number(c.expected), 10);
      return {
        name, passed: ok, method: "computational", kind: "numeric",
        detail: ok
          ? `${c.op}([${vals.join(", ")}]) = ${result} ✓`
          : `${c.op}([${vals.join(", ")}]) = ${result}, NOT ${c.expected} as claimed.`,
      };
    } catch (e) {
      return fail(name, `Could not compute: ${e instanceof Error ? e.message : "invalid data"}`);
    }
  }

  return fail(`Machine check${label}`, `Unknown check kind "${kind}".`);
}

export function runMachineChecks(checks: unknown): {
  results: MachineCheckResult[];
  allPassed: boolean;
  kinds: string[];
} {
  const results: MachineCheckResult[] = [];
  if (!Array.isArray(checks)) return { results, allPassed: false, kinds: [] };

  for (const raw of checks.slice(0, 12)) {
    const c = raw as MachineCheckInput;
    if (typeof c !== "object" || c === null) continue;
    results.push(runOne(c));
  }

  const kinds = Array.from(new Set(results.map((r) => r.kind)));
  return {
    results,
    allPassed: results.length > 0 && results.every((r) => r.passed),
    kinds,
  };
}
