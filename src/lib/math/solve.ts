/**
 * Deterministic math solver (2026-10-06 image-to-solution round).
 *
 * Every solve here is DETERMINISTIC (mathjs + hand-derived formulas) —
 * the LLM is never the mathematical authority. The solver classifies the
 * problem and solves it; the pipeline then verifies the result
 * INDEPENDENTLY (solve-then-check with different operations).
 *
 * Supported domains: fractions (simplify/rationalize), exponents, square
 * roots, linear equations, quadratics, systems of linear equations,
 * derivatives, integrals (elementary antiderivatives, honestly limited),
 * matrices (det/inverse/multiply/transpose), statistics (mean/median/
 * mode/std/variance), geometry (deterministic formulas), word problems
 * (template-mapped to equations — anything unmapped is refused, never
 * guessed).
 */

import { create, all, type MathJsInstance } from "mathjs";
import { normalizeMathText } from "./normalize";

const math: MathJsInstance = create(all, {});

export interface SolveStep {
  /** human-readable, e.g. "Subtract 5 from both sides" */
  text: string;
  /** optional math for the step, e.g. "2x = 12" */
  expr?: string;
}

export type SolveKind =
  | "linear_equation" | "quadratic" | "system" | "evaluate"
  | "derivative" | "integral" | "matrix" | "stats"
  | "geometry" | "word_problem";

export interface SolveResult {
  kind: SolveKind;
  solved: boolean;
  finalAnswer: string;
  steps: SolveStep[];
  /** deterministic checks the pipeline re-runs — never LLM judgments */
  checks: { kind: string; label: string; expr?: string; expected?: string | number | null; left?: string; right?: string; var?: string; op?: string; data?: number[]; vars?: string[]; values?: number[] }[];
  honestNote?: string;
}

const N_TOL = 1e-9;
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/* ---------------- classification ---------------- */

export function classify(expr: string, all?: string[]): SolveKind {
  const e = expr.replace(/\s+/g, " ").trim();
  if (/INTEGRAL/.test(e)) return "integral";
  if (/\b(dy\/dx|d\/dx|derivative of|f'\(x\)|differentiate)\b/i.test(e)) return "derivative";
  if (/^(det|determinant|inv|inverse|transpose)\s*\(/i.test(e) || /^\s*\[/.test(e)) return "matrix";
  if (/^(mean|median|mode|std|stdev|variance|var|range)\s*\(/i.test(e)) return "stats";
  if (/(area|perimeter|circumference|volume|hypotenuse|pythagorean|radius)\b/i.test(e)) return "geometry";
  if (/[a-zA-Z]+ [a-zA-Z]+ [a-zA-Z]+/.test(e) && !/[=\[\(]/.test(e)) return "word_problem";
  if (/\b(sum of two numbers|sum of|difference of|total of|combined)\b/i.test(e) && !/=/.test(e)) return "word_problem";
  if (all && all.length > 1) return "system";
  if (all && all.length === 1 && /=/.test(all[0]) && isPolynomialIn(e, "x") && polyDegree(e, "x") === 2) return "quadratic";
  if (/=/.test(e)) {
    const deg = polyDegree(e, "x");
    if (deg === 2) return "quadratic";
    if (deg === 1) return "linear_equation";
    if (deg === 0 || deg === -1) {
      // maybe another variable
      for (const v of ["y", "z", "t", "n"]) {
        const d = polyDegree(e, v);
        if (d === 1) return "linear_equation";
        if (d === 2) return "quadratic";
      }
    }
  }
  return "evaluate";
}

function isPolynomialIn(expr: string, v: string): boolean {
  try {
    math.parse(expr).compile().evaluate({ [v]: 1.234567 });
    math.parse(expr).compile().evaluate({ [v]: 2.345678 });
    return true;
  } catch {
    return false;
  }
}

/** degree of expr in variable v, or -1 when expr is not polynomial-like. */
function polyDegree(expr: string, v: string): number {
  // works on "lhs = rhs" by moving rhs over: f(v) = lhs - (rhs)
  let f: string;
  if (expr.includes("=")) {
    const [l, r] = expr.split("=");
    f = `(${l}) - (${r})`;
  } else {
    f = expr;
  }
  try {
    const node = math.parse(f);
    const ev = (x: number) => node.compile().evaluate({ [v]: x });
    const y0 = ev(0), y1 = ev(1), y2 = ev(2), y3 = ev(3);
    if (!Number.isFinite(y0) || !Number.isFinite(y1) || !Number.isFinite(y2) || !Number.isFinite(y3)) return -1;
    // constant?
    if (near(y0, y1, 1e-6) && near(y1, y2, 1e-6) && near(y2, y3, 1e-6)) return 0;
    // linear? second difference zero
    if (near(y2 - 2 * y1 + y0, 0, 1e-6) && near(y3 - 2 * y2 + y1, 0, 1e-6)) return 1;
    // quadratic? third difference zero
    if (near(y3 - 3 * y2 + 3 * y1 - y0, 0, 1e-6)) return 2;
    return -1;
  } catch {
    return -1;
  }
}

/* ---------------- linear equations ---------------- */

function solveLinearEquation(expr: string, v: string): SolveResult {
  const [l, r] = expr.split("=");
  const f = `(${l}) - (${r})`;
  const node = math.parse(f);
  const ev = (x: number) => node.compile().evaluate({ [v]: x });
  const b = ev(0);
  const a = ev(1) - b;
  if (Math.abs(a) < N_TOL) {
    return { kind: "linear_equation", solved: false, finalAnswer: "", steps: [], checks: [], honestNote: "not actually an equation in one unknown (or degenerate) — needs review" };
  }
  const x = -b / a;
  const fSimplified = String(math.simplify(f));
  const steps: SolveStep[] = [
    { text: "Move everything to one side", expr: `${fSimplified} = 0` },
  ];
  if (Math.abs(b) > N_TOL) {
    steps.push({ text: `Subtract ${math.format(b, { precision: 6 })} from both sides`, expr: `${math.format(a, { precision: 6 })}${v} = ${math.format(-b, { precision: 6 })}` });
  } else {
    steps.push({ text: `Divide both sides by ${math.format(a, { precision: 6 })}`, expr: `${v} = 0` });
  }
  const finalAnswer = math.format(x, { precision: 10 });
  steps.push({ text: `Solve for ${v}`, expr: `${v} = ${finalAnswer}` });
  return {
    kind: "linear_equation",
    solved: true,
    finalAnswer: `${v} = ${finalAnswer}`,
    steps,
    checks: [{ kind: "equation_check", label: `substitute ${v} = ${finalAnswer} back into the original equation`, left: l.trim(), right: r.trim(), var: v, expected: undefined }],
  };
}

/* ---------------- quadratics ---------------- */

function solveQuadratic(expr: string, v: string): SolveResult {
  const [l, r] = expr.split("=");
  const f = `(${l}) - (${r})`;
  const node = math.parse(f);
  const ev = (x: number) => node.compile().evaluate({ [v]: x });
  const c = ev(0);
  const fm1 = ev(-1), f0 = c, f1 = ev(1);
  // quadratic through (-1,fm1),(0,f0),(1,f1): a = (fm1 + f1 - 2f0)/2, b = (f1-fm1)/2
  const a = (fm1 + f1 - 2 * f0) / 2;
  const b = (f1 - fm1) / 2;
  const disc = b * b - 4 * a * c;
  const steps: SolveStep[] = [
    { text: "Move everything to one side", expr: `${math.format(a, { precision: 6 })}${v}^2 ${b >= 0 ? "+" : "-"} ${math.format(Math.abs(b), { precision: 6 })}${v} ${c >= 0 ? "+" : "-"} ${math.format(Math.abs(c), { precision: 6 })} = 0` },
    { text: "Identify the coefficients", expr: `a = ${math.format(a, { precision: 6 })}, b = ${math.format(b, { precision: 6 })}, c = ${math.format(c, { precision: 6 })}` },
    { text: "Compute the discriminant", expr: `b² - 4ac = ${math.format(disc, { precision: 8 })}` },
  ];
  if (disc < -N_TOL) {
    steps.push({ text: "The discriminant is negative — no real solutions" });
    return { kind: "quadratic", solved: true, finalAnswer: "no real solutions (discriminant < 0)", steps, checks: [] };
  }
  const sq = Math.sqrt(disc);
  const r1 = (-b + sq) / (2 * a);
  const r2 = (-b - sq) / (2 * a);
  steps.push({ text: "Apply the quadratic formula", expr: `${v} = (-b ± √(b²-4ac)) / (2a)` });
  steps.push({ text: "The two roots", expr: near(r1, r2, 1e-9) ? `${v} = ${math.format(r1, { precision: 10 })} (double root)` : `${v} = ${math.format(r1, { precision: 10 })} or ${v} = ${math.format(r2, { precision: 10 })}` });
  return {
    kind: "quadratic",
    solved: true,
    finalAnswer: near(r1, r2, 1e-9) ? `${v} = ${math.format(r1, { precision: 10 })}` : `${v} = ${math.format(r1, { precision: 10 })} or ${v} = ${math.format(r2, { precision: 10 })}`,
    steps,
    checks: [
      { kind: "equation_check", label: `substitute ${v} = ${math.format(r1, { precision: 10 })} back into the original equation`, left: l.trim(), right: r.trim(), var: v },
      { kind: "equation_check", label: `substitute ${v} = ${math.format(r2, { precision: 10 })} back into the original equation`, left: l.trim(), right: r.trim(), var: v },
    ],
  };
}

/* ---------------- systems ---------------- */

export function solveSystem(equations: string[]): SolveResult {
  // collect variables
  const vars = new Set<string>();
  for (const eq of equations) {
    const re = /[a-zA-Z]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(eq)) !== null) {
      const ch = m[0];
      const next = eq.slice(m.index + 1).charAt(0) ?? "";
      if (!["e", "p", "i"].includes(ch) || next === "" || !/[a-zA-Z]/.test(next)) {
        if (!/[a-zA-Z]/.test(next)) vars.add(ch);
      }
    }
  }
  const vlist = Array.from(vars).sort();
  const n = vlist.length;
  if (n === 0 || n > 4 || equations.length !== n) {
    return { kind: "system", solved: false, finalAnswer: "", steps: [], checks: [], honestNote: `cannot set up this system deterministically (${n} variables vs ${equations.length} equations) — needs review` };
  }
  // A·x = b via evaluation: f_i(e_j) gives A[i][j], f_i(0) gives -b_i
  const A: number[][] = [];
  const b: number[] = [];
  const fNodes = equations.map((eq) => {
    const [l, r] = eq.split("=");
    return math.parse(`(${l}) - (${r})`);
  });
  for (const f of fNodes) {
    const row: number[] = [];
    const b0 = f.compile().evaluate(Object.fromEntries(vlist.map((v) => [v, 0])));
    for (const v of vlist) {
      const env = Object.fromEntries(vlist.map((w) => [w, 0]));
      env[v] = 1;
      row.push(f.compile().evaluate(env) - b0);
    }
    A.push(row);
    b.push(-b0);
  }
  let x: number[];
  try {
    x = (math.lusolve(A, b) as number[][]).map((r) => r[0]);
  } catch {
    return { kind: "system", solved: false, finalAnswer: "", steps: [{ text: "The system has no unique solution (singular)" }], checks: [] };
  }
  const steps: SolveStep[] = [
    { text: "Write the system in matrix form A·x = b", expr: `A = ${JSON.stringify(A)}, b = ${JSON.stringify(b)}` },
    { text: "Solve by Gaussian elimination (LU decomposition)" },
  ];
  const finalAnswer = vlist.map((v, i) => `${v} = ${math.format(x[i], { precision: 10 })}`).join(", ");
  steps.push({ text: "Solution", expr: finalAnswer });
  const checks = equations.map((eq, i) => {
    const [l, r] = eq.split("=");
    return { kind: "equation_check", label: `substitute into equation ${i + 1}`, left: l.trim(), right: r.trim(), vars: vlist, values: x, eq };
  }) as unknown as SolveResult["checks"];
  return { kind: "system", solved: true, finalAnswer, steps, checks };
}

/* ---------------- derivative ---------------- */

export function solveDerivative(expr: string): SolveResult {
  const m1 = expr.match(/d\s*\/\s*d([a-zA-Z])\s*\((.+)\)\s*$/);
  const m2 = expr.match(/d\s*\/\s*d([a-zA-Z])\s+(.+)$/);
  const m3 = expr.match(/dy\/dx\s*[:=]?\s*(.+)$/i);
  const m4 = expr.match(/derivative of\s+(.+)$/i);
  const v = m1?.[1] ?? m2?.[1] ?? "x";
  const body = (m1?.[2] ?? m2?.[2] ?? m3?.[1] ?? m4?.[1] ?? "").trim();
  try {
    const d = math.derivative(body, v);
    const simplified = String(math.simplify(d));
    const steps: SolveStep[] = [
      { text: "Apply the power/product/chain rules term by term (deterministic, mathjs)", expr: `d/d${v} [${body}] = ${simplified}` },
    ];
    return {
      kind: "derivative",
      solved: true,
      finalAnswer: simplified,
      steps,
      checks: [{ kind: "derivative", label: "re-derive the answer independently and compare", expr: body, expected: simplified, var: v }],
    };
  } catch {
    return { kind: "derivative", solved: false, finalAnswer: "", steps: [], checks: [], honestNote: "this expression is beyond the deterministic differentiator — needs review (no guessed answer)" };
  }
}

/* ---------------- integral (elementary) ---------------- */

export function solveIntegral(expr: string): SolveResult {
  // forms: "∫ 3x^2 dx" → after normalize: "INTEGRAL 3x^2 dx"
  const m = expr.replace(/\s+/g, " ").match(/INTEGRAL\s+(.+?)\s*d([a-zA-Z])$/i);
  if (!m) {
    return { kind: "integral", solved: false, finalAnswer: "", steps: [], checks: [], honestNote: "integral notation not understood — needs review (never guessed)" };
  }
  const body = m[1].trim();
  const v = m[2];
  const anti = elementaryAntiderivative(body, v);
  if (anti == null) {
    return { kind: "integral", solved: false, finalAnswer: "", steps: [], checks: [], honestNote: `no elementary antiderivative found for "${body}" — needs review (never guessed)` };
  }
  const steps: SolveStep[] = [
    { text: "Apply the power rule ∫xⁿ dx = xⁿ⁺¹/(n+1) term by term (deterministic)", expr: `∫${body} d${v} = ${anti} + C` },
  ];
  return {
    kind: "integral",
    solved: true,
    finalAnswer: `${anti} + C`,
    steps,
    checks: [{ kind: "simplify_equal", label: `verify by differentiating: d/d${v}[${anti}] must equal ${body}`, expr: anti, expected: body, var: v }],
  };
}

/** Polynomial + 1/x + e^x + constant antiderivatives. Returns null when
 *  unknown — the caller marks NEEDS REVIEW; nothing is guessed. */
function elementaryAntiderivative(body: string, v: string): string | null {
  try {
    const simplified = String(math.simplify(body));
    // split top-level +/- terms
    const terms = splitTerms(simplified);
    const parts: string[] = [];
    for (const t of terms) {
      const tt = t.replace(/^\+/, "").trim();
      if (!tt) continue;
      if (/^[+-]?\d+(\.\d+)?$/.test(tt)) { parts.push(`(${tt}*${v})`); continue; }
      // c * v^n
      let m = tt.match(/^([+-]?[\d.]+)\s*\*\s*([a-zA-Z])\s*\^\s*(\-?[\d.]+)$/);
      if (m && m[2] === v) { const c = Number(m[1]); const nn = Number(m[3]); if (near(nn, -1, 1e-12)) { parts.push(`(${c}*log(abs(${v})))`); } else { parts.push(`(${c}/${nn + 1}*${v}^${nn + 1})`); } continue; }
      m = tt.match(/^([+-]?[\d.]*)\s*\*?\s*([a-zA-Z])\s*\^\s*(\-?[\d.]+)$/);
      if (m && m[2] === v) { const c = m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : Number(m[1]); const npow = Number(m[3]); if (near(npow, -1, 1e-12)) { parts.push(`(${c}*log(abs(${v})))`); } else { parts.push(`(${c}/${npow + 1}*${v}^${npow + 1})`); } continue; }
      // c * v
      m = tt.match(/^([+-]?[\d.]+)?\s*\*?\s*([a-zA-Z])$/);
      if (m && m[2] === v) { const c = m[1] == null || m[1] === "" ? 1 : Number(m[1]); parts.push(`(${c}/2*${v}^2)`); continue; }
      // c / v^k → handled: 1/x
      m = tt.match(/^([+-]?[\d.]*)\s*\/\s*([a-zA-Z])(?:\s*\^\s*(\-?[\d.]+))?$/);
      if (m && m[2] === v) {
        const c = m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : Number(m[1]);
        const k = m[3] == null ? 1 : Number(m[3]);
        if (near(k, 1, 1e-12)) parts.push(`(${c}*log(abs(${v})))`);
        else parts.push(`(${c}/${1 - k}*${v}^${1 - k})`);
        continue;
      }
      // c * e^v
      m = tt.match(/^([+-]?[\d.]*)\s*\*?\s*e\^\(?([a-zA-Z])\)?$/);
      if (m && m[2] === v) { const c = m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : Number(m[1]); parts.push(`(${c}*e^${v})`); continue; }
      // c * sin(v) / cos(v)
      m = tt.match(/^([+-]?[\d.]*)\s*\*?\s*sin\(\s*([a-zA-Z])\s*\)$/);
      if (m && m[2] === v) { const c = m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : Number(m[1]); parts.push(`(-${c}*cos(${v}))`); continue; }
      m = tt.match(/^([+-]?[\d.]*)\s*\*?\s*cos\(\s*([a-zA-Z])\s*\)$/);
      if (m && m[2] === v) { const c = m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : Number(m[1]); parts.push(`(${c}*sin(${v}))`); continue; }
      return null; // unknown form — never guess
    }
    if (parts.length === 0) return null;
    return parts.join(" + ").replace(/\+ -/g, "- ");
  } catch {
    return null;
  }
}

function splitTerms(expr: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of expr) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && (ch === "+" || ch === "-") && cur.trim() !== "") {
      out.push(cur.trim());
      cur = ch === "-" ? "-" : "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* ---------------- matrices ---------------- */

function solveMatrix(expr: string): SolveResult {
  const e = expr.trim();
  try {
    if (/^det/i.test(e) || /^determinant/i.test(e)) {
      const m = e.replace(/^determinant|^det/i, "").trim();
      const val = Number(math.evaluate(`det(${m})`));
      return { kind: "matrix", solved: true, finalAnswer: String(val), steps: [{ text: "Compute the determinant", expr: `det(${m}) = ${val}` }], checks: [{ kind: "matrix", label: "determinant", op: "det", expr: m, expected: val }] };
    }
    if (/^inv/i.test(e) || /^inverse/i.test(e)) {
      const m = e.replace(/^inverse|^inv/i, "").trim();
      const inv = String(math.evaluate(`inv(${m})`));
      return { kind: "matrix", solved: true, finalAnswer: inv, steps: [{ text: "Invert the matrix", expr: `inv(${m}) = ${inv}` }], checks: [{ kind: "matrix", label: "inverse (A·A⁻¹ = I)", op: "inv", expr: m, expected: inv }] };
    }
    if (/^transpose/i.test(e)) {
      const m = e.replace(/^transpose/i, "").trim();
      const t = String(math.evaluate(`transpose(${m})`));
      return { kind: "matrix", solved: true, finalAnswer: t, steps: [{ text: "Transpose", expr: t }], checks: [{ kind: "matrix", label: "transpose", op: "transpose", expr: m, expected: t }] };
    }
    // product of matrices: [[...]] * [[...]]
    const val = String(math.evaluate(e));
    return { kind: "matrix", solved: true, finalAnswer: val, steps: [{ text: "Compute the matrix expression", expr: `${e} = ${val}` }], checks: [{ kind: "evaluate", label: "re-evaluate the matrix expression", expr: e, expected: val }] };
  } catch (err) {
    return { kind: "matrix", solved: false, finalAnswer: "", steps: [], checks: [], honestNote: `matrix operation failed deterministically: ${(err as Error).message}` };
  }
}

/* ---------------- statistics ---------------- */

function solveStats(expr: string): SolveResult {
  try {
    const op = expr.replace(/\s*\(.*/, "").trim().toLowerCase();
    const data = math.evaluate(expr.replace(/^[a-z]+\s*/i, "")) as unknown;
    const raw = Array.isArray(data) ? (data as number[]) : [Number(data)];
    const val = math.evaluate(expr);
    const n = raw.length;
    const sorted = [...raw].sort((a, b) => a - b);
    const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const mean = raw.reduce((s, x) => s + x, 0) / n;
    const varr = raw.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
    const steps: SolveStep[] = [
      { text: "Sort the data", expr: JSON.stringify(sorted) },
      { text: `n = ${n}` },
      { text: "Compute the requested statistic deterministically", expr: `${op} = ${math.format(val, { precision: 10 })}` },
    ];
    return {
      kind: "stats", solved: true, finalAnswer: String(math.format(val, { precision: 10 })), steps,
      checks: [{ kind: "stats", label: `${op}`, op, data: raw }],
    };
    void median; void varr;
  } catch {
    return { kind: "stats", solved: false, finalAnswer: "", steps: [], checks: [], honestNote: "statistic could not be computed deterministically — needs review" };
  }
}

/* ---------------- geometry ---------------- */

interface GeoFormula { match: RegExp; compute: (m: RegExpMatchArray) => { steps: SolveStep[]; answer: string; label: string }; }

const GEO: GeoFormula[] = [
  { match: /(?:area|surface area)\s*(?:of\s*)?(?:a\s*)?circle\s*(?:with\s*)?(?:r|radius)\s*[:=]?\s*([\d.]+)/i,
    compute: (m) => { const r = Number(m[1]); return { answer: `A = pi*${r}^2 = ${math.format(Math.PI * r * r, { precision: 10 })}`, label: "circle area", steps: [{ text: "Area of a circle", expr: "A = πr²" }, { text: `Substitute r = ${r}`, expr: `A = π·${r}² = ${math.format(Math.PI * r * r, { precision: 10 })}` }] }; } },
  { match: /circumference\s*(?:of\s*)?(?:a\s*)?circle\s*(?:with\s*)?(?:r|radius)\s*[:=]?\s*([\d.]+)/i,
    compute: (m) => { const r = Number(m[1]); return { answer: `C = 2*pi*${r} = ${math.format(2 * Math.PI * r, { precision: 10 })}`, label: "circumference", steps: [{ text: "Circumference", expr: "C = 2πr" }, { text: `Substitute r = ${r}`, expr: `C = 2π·${r} = ${math.format(2 * Math.PI * r, { precision: 10 })}` }] }; } },
  { match: /(?:area|surface area)\s*(?:of\s*)?(?:a\s*)?(?:rectangle|square)\b.*?(?:width|w)\s*[:=]?\s*([\d.]+).*?(?:height|h|length|l)\s*[:=]?\s*([\d.]+)/i,
    compute: (m) => { const w = Number(m[1]); const h = Number(m[2]); return { answer: `A = ${w} * ${h} = ${w * h}`, label: "rectangle area", steps: [{ text: "Area of a rectangle", expr: "A = w·h" }, { text: `Substitute w = ${w}, h = ${h}`, expr: `A = ${w * h}` }] }; } },
  { match: /(?:area)\s*(?:of\s*)?(?:a\s*)?triangle.*?base\s*[:=]?\s*([\d.]+).*?height\s*[:=]?\s*([\d.]+)/i,
    compute: (m) => { const b = Number(m[1]); const h = Number(m[2]); return { answer: `A = (1/2)*${b}*${h} = ${math.format(b * h / 2, { precision: 10 })}`, label: "triangle area", steps: [{ text: "Area of a triangle", expr: "A = ½·b·h" }, { text: `Substitute b = ${b}, h = ${h}`, expr: `A = ${math.format(b * h / 2, { precision: 10 })}` }] }; } },
  { match: /hypotenuse.*?(?:a|side a)\s*[:=]?\s*([\d.]+).*?(?:b|side b)\s*[:=]?\s*([\d.]+)/i,
    compute: (m) => { const a = Number(m[1]); const b = Number(m[2]); return { answer: `c = sqrt(${a}^2 + ${b}^2) = ${math.format(Math.hypot(a, b), { precision: 10 })}`, label: "pythagorean hypotenuse", steps: [{ text: "Pythagorean theorem", expr: "c² = a² + b²" }, { text: `Substitute a = ${a}, b = ${b}`, expr: `c = ${math.format(Math.hypot(a, b), { precision: 10 })}` }] }; } },
];

function solveGeometry(expr: string): SolveResult {
  for (const g of GEO) {
    const m = expr.match(g.match);
    if (m) {
      const r = g.compute(m);
      const recompute: number = (() => {
        const mm = expr.match(/([\d.]+)/g);
        const nums = (mm ?? []).map(Number);
        if (r.label === "circle area") return Math.PI * nums[0] * nums[0];
        if (r.label === "circumference") return 2 * Math.PI * nums[0];
        if (r.label === "rectangle area") return nums[0] * nums[1];
        if (r.label === "triangle area") return (nums[0] * nums[1]) / 2;
        if (r.label === "pythagorean hypotenuse") return Math.hypot(nums[0], nums[1]);
        return NaN;
      })();
      return { kind: "geometry", solved: true, finalAnswer: r.answer, steps: r.steps, checks: [{ kind: "evaluate", label: `recompute ${r.label} independently`, expr: "1", expected: Number.isFinite(recompute) ? recompute : undefined }] };
    }
  }
  return { kind: "geometry", solved: false, finalAnswer: "", steps: [], checks: [], honestNote: "no deterministic geometry formula matched — needs review (never guessed)" };
}

/* ---------------- word problems (template-mapped, honest) ---------------- */

function solveWordProblem(expr: string): SolveResult {
  const m = expr.match(/the sum of two numbers is\s*([\d.]+)\s*(?:and|;)?\s*their difference is\s*([\d.]+)/i);
  if (m) {
    const sum = Number(m[1]);
    const diff = Number(m[2]);
    const a = (sum + diff) / 2;
    const b = (sum - diff) / 2;
    return {
      kind: "word_problem", solved: true, finalAnswer: `the numbers are ${math.format(a, { precision: 10 })} and ${math.format(b, { precision: 10 })}`,
      steps: [
        { text: "Translate the words into equations", expr: "x + y = " + sum + "; x - y = " + diff },
        { text: "Solve the system deterministically", expr: `x = (${sum} + ${diff})/2 = ${math.format(a, { precision: 10 })}, y = (${sum} - ${diff})/2 = ${math.format(b, { precision: 10 })}` },
      ],
      checks: [{ kind: "evaluate", label: "x + y must equal the stated sum", expr: `${a} + ${b}`, expected: sum }, { kind: "evaluate", label: "x - y must equal the stated difference", expr: `${a} - ${b}`, expected: diff }],
    };
  }
  return { kind: "word_problem", solved: false, finalAnswer: "", steps: [], checks: [], honestNote: "this word problem does not match any deterministic template — Sophira will help set up the equation, but no answer is guessed; needs review" };
}

/* ---------------- evaluate / fractions ---------------- */

function solveEvaluate(expr: string): SolveResult {
  try {
    const val = math.evaluate(expr);
    if (typeof val === "object" && val !== null) {
      // e.g. a simplify result
      const s = String(math.simplify(expr));
      return { kind: "evaluate", solved: true, finalAnswer: s, steps: [{ text: "Simplify deterministically", expr: `${expr} = ${s}` }], checks: [{ kind: "simplify_equal", label: "symbolic equivalence check", expr, expected: s }] };
    }
    const num = Number(val);
    if (!Number.isFinite(num)) throw new Error("non-finite");
    return {
      kind: "evaluate", solved: true, finalAnswer: math.format(num, { precision: 12 }),
      steps: [{ text: "Evaluate deterministically", expr: `${expr} = ${math.format(num, { precision: 12 })}` }],
      checks: [{ kind: "evaluate", label: "independent re-evaluation", expr, expected: num }],
    };
  } catch {
    try {
      // symbolic fallback (fractions etc.): 1/2 + 1/3 → 5/6
      const s = String(math.simplify(expr));
      const r = math.rationalize ? String(math.rationalize(expr)) : s;
      return { kind: "evaluate", solved: true, finalAnswer: r, steps: [{ text: "Simplify deterministically", expr: `${expr} = ${r}` }], checks: [{ kind: "simplify_equal", label: "symbolic equivalence check", expr, expected: r }] };
    } catch {
      return { kind: "evaluate", solved: false, finalAnswer: "", steps: [], checks: [], honestNote: "expression could not be evaluated deterministically — needs review (never guessed)" };
    }
  }
}

/* ---------------- entry point ---------------- */

export function solveProblem(expression: string, allExpressions?: string[]): SolveResult {
  // normalize raw OCR text (superscripts, roots, unicode) so the solver
  // accepts exactly what the recognizer produced
  const norm = normalizeMathText(expression);
  const normAll = allExpressions ? allExpressions.flatMap((e) => normalizeMathText(e).expressions) : norm.expressions;
  const expr = (normAll.length > 1 ? normAll.join(" ; ") : normAll[0] ?? expression).trim();
  const kind = classify(expr, normAll.length > 1 ? normAll : [expr]);
  switch (kind) {
    case "integral": return solveIntegral(expr);
    case "derivative": return solveDerivative(expr);
    case "matrix": return solveMatrix(expr);
    case "stats": return solveStats(expr);
    case "geometry": return solveGeometry(expr);
    case "word_problem": return solveWordProblem(expr);
    case "system": return solveSystem(normAll.length > 1 ? normAll : [expr]);
    case "quadratic": {
      const v = mainVariable(expr);
      return solveQuadratic(expr, v);
    }
    case "linear_equation": {
      const v = mainVariable(expr);
      return solveLinearEquation(expr, v);
    }
    default: return solveEvaluate(expr);
  }
}

function mainVariable(expr: string): string {
  for (const v of ["x", "y", "z", "t", "n"]) {
    if (new RegExp(`(^|[^a-zA-Z])${v}([^a-zA-Z]|$)`).test(expr)) return v;
  }
  return "x";
}
