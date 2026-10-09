/**
 * MATHEMATICS ORCHESTRATION LAYER (2026-10-09)
 *
 * Classifies a normalized math problem against the capability registry,
 * selects the verification strategy the platform can HONESTLY provide,
 * and routes to the appropriate engine tier. It never overstates: a
 * classified field with no deterministic engine comes back labeled
 * ai_only, and the caller must present that as "reasoned, unverified".
 *
 * Engine tiers available today (see docs/MATHEMATICS_ENGINE.md):
 *   - symbolic / numeric / matrix / stats / discrete (mathjs, src/lib/math/solve.ts)
 *   - ai_reasoning (existing AI provider; needs OPENAI_API_KEY or Gemini)
 *   - external (SymPy/Lean-style CAS or proof assistant — NOT installed;
 *     honestly blocked, never faked)
 *
 * Workflow steps implemented here mirror the directive: classify →
 * extract request type → route → state verification level + limits.
 */

import { MATHEMATICS_REGISTRY, flattenRegistry, type MathFieldNode, type SupportStatus, type VerificationLevel } from "./registry";

export type RequestedOutput =
  | "exact"        // symbolic/exact result
  | "numeric"      // number/approximation
  | "proof"        // proof or derivation
  | "explanation"  // concept/why
  | "graph"        // visualization
  | "statistics";  // data reduction

export interface Classification {
  fieldId: string;
  fieldTitle: string;
  requestedOutput: RequestedOutput;
  difficulty: "elementary" | "secondary" | "undergraduate" | "graduate" | "research";
  engineTier: "deterministic" | "ai_reasoning" | "external";
  verification: VerificationLevel;
  verificationNote: string;
  honestLimits: string[];
}

/** Symbols don't carry words: map them BEFORE scoring so ∫ classifies as
 *  integral, ∂/dy/dx as derivative, etc. (the pipeline normalizes to
 *  "INTEGRAL"/"SQRT" tokens too — both forms are covered). */
const SYMBOL_WORDS: [RegExp, string][] = [
  [/∫/g, " integral "],
  [/(∂|dy\/dx|d\/dx|d\w*\/d\w*)/gi, " derivative "],
  [/∑/g, " sum "],
  [/√/g, " sqrt "],
  [/lim_|lim(?![a-z])/gi, " limit "],
  [/det|\|\s*\[\[/gi, " determinant matrix "],
];

function expandSymbols(text: string): string {
  let out = text;
  for (const [re, word] of SYMBOL_WORDS) out = out.replace(re, word);
  return out;
}

/** Score a node's aliases/title against the problem text. */
function scoreNode(node: MathFieldNode, text: string): number {
  const hay = text.toLowerCase();
  let score = 0;
  const probe = (label: string, weight: number) => {
    const needle = label.toLowerCase().replace(/[^a-z0-9 ]/g, "");
    if (needle.length >= 3 && hay.includes(needle)) score += weight;
  };
  probe(node.title, 1);
  for (const a of node.aliases) probe(a, 2);
  return score;
}

/** Best-matching leaf-first: subfields win over their parents on ties. */
export function classifyMathProblem(problemText: string, subjectHint?: string | null): Classification {
  const text = expandSymbols((problemText + " " + (subjectHint ?? ""))).toLowerCase();
  let best: MathFieldNode | null = null;
  let bestScore = 0;
  for (const node of flattenRegistry()) {
    if (node.status === "planned" && best) continue; // prefer concrete nodes, but planned beats nothing
    const s = scoreNode(node, text);
    if (s > bestScore) { bestScore = s; best = node; }
  }
  if (!best) best = MATHEMATICS_REGISTRY[0];

  // Requested output detection (regexes are deliberately conservative).
  let requestedOutput: RequestedOutput = "exact";
  if (/prove|proof|show that|derive/.test(text)) requestedOutput = "proof";
  else if (/explain|why|what is a|intuition/.test(text)) requestedOutput = "explanation";
  else if (/plot|graph|visuali/.test(text)) requestedOutput = "graph";
  else if (/mean|median|variance|std|deviation|average of|dataset|regression/.test(text)) requestedOutput = "statistics";
  else if (/approximat|decimal|estimate|to (the )?\d+ (decimal|places)|numeric/.test(text)) requestedOutput = "numeric";

  // Difficulty heuristic: operator/keyword density (honest and simple).
  let difficulty: Classification["difficulty"] = "undergraduate";
  if (/integral|derivative|matrix|limit|series|ode|pde|measure|manifold|homolog|functor|prime number theorem|conjecture/.test(text)) difficulty = "undergraduate";
  if (/∫|∂|∇|measure theory|manifold|category|representation theory|galois|riemann/.test(text)) difficulty = "graduate";
  if (/conjecture|open problem|novel|research|ariel|schenkel/.test(text)) difficulty = "research";
  if (/^[^a-z]*[\d\s+\-*/().=^]+$/.test(problemText.trim()) || /\b(gcd|is \d+ prime|times|plus)\b/.test(text)) difficulty = "elementary";
  else if (/\b(solve|simplify|factor|expand)\b/.test(text) && !/integral|derivative|matrix/.test(text)) difficulty = "secondary";

  // Engine tier from the node's status — never upgrade an ai_only node.
  let engineTier: Classification["engineTier"] = "ai_reasoning";
  if (best.status === "implemented_tested" || best.status === "implemented_partial") engineTier = "deterministic";
  if (best.verification === "external") engineTier = "external";

  const honestLimits: string[] = [];
  if (engineTier === "ai_reasoning") {
    honestLimits.push("No deterministic engine for this field: the reasoning is AI-generated and labeled unverified, not machine-checked.");
  }
  if (engineTier === "external") {
    honestLimits.push("This field needs an external CAS/proof tool that is not installed — the answer will be an informal explanation only.");
  }
  if (best.status === "implemented_partial") {
    honestLimits.push("The engine covers a subset of this field; anything outside it is honestly refused (NEEDS REVIEW), never guessed.");
  }
  if (requestedOutput === "proof") {
    honestLimits.push("No proof assistant is installed: any argument is INFORMAL. It will never be presented as machine-verified.");
  }
  if (requestedOutput === "graph") {
    honestLimits.push("Plots are computed from actual numeric evaluation of the stated expression, with axes, domain, and parameters labeled.");
  }

  return {
    fieldId: best.id,
    fieldTitle: best.title,
    requestedOutput,
    difficulty,
    engineTier,
    verification: best.verification,
    verificationNote: best.verificationNote ?? "",
    honestLimits,
  };
}

/** Coverage snapshot for the dashboard/docs: statuses actually recorded,
 *  not claimed. Generated from the registry — extensible by design. */
export function coverageSnapshot(): { total: number; byStatus: Record<SupportStatus, number>; fields: { id: string; title: string; status: SupportStatus }[] } {
  const flat = flattenRegistry();
  const byStatus: Record<SupportStatus, number> = { implemented_tested: 0, implemented_partial: 0, ai_reasoning: 0, planned: 0 };
  for (const n of flat) byStatus[n.status] += 1;
  return {
    total: flat.length,
    byStatus,
    fields: flat.map((n) => ({ id: n.id, title: n.title, status: n.status })),
  };
}
