/**
 * Multiple-choice analysis (2026-10-14) — an actual solving capability.
 * Both Scan and Type input converge here: the base problem goes through the
 * SAME normalize -> classify -> solve -> verify path, then every candidate
 * is evaluated against the independently solved answer. Nothing is confirmed
 * when the base problem could not be established — no guessing, no inverted
 * logic errors.
 */
import { normalizeMathText } from "./normalize";
import { solveProblem } from "./solve";

export interface McqChoice {
  label: string;
  text: string;
  verdict: "correct" | "incorrect" | "cannot_determine";
  reason: string;
}

export interface McqAnalysis {
  inverted: boolean;
  established: boolean;
  base: string;
  choices: McqChoice[];
}

const CHOICE_LINE = /(?:^|[\n;]|\s)([A-Ha-h])\)\s*(.+?)(?=\s+[A-Ha-h]\)|[\n;]|$)/g;

export function detectChoices(text: string): { base: string; choices: { label: string; text: string }[] } | null {
  const choices: { label: string; text: string }[] = [];
  let m: RegExpExecArray | null;
  CHOICE_LINE.lastIndex = 0;
  while ((m = CHOICE_LINE.exec(text)) !== null) {
    const body = m[2].trim();
    if (body) choices.push({ label: m[1].toUpperCase(), text: body });
  }
  if (choices.length < 2) return null;
  const first = text.toLowerCase().indexOf(choices[0].label.toLowerCase() + ")");
  const cutoff = first === -1 ? text.toLowerCase().indexOf(choices[0].label.toLowerCase()) : first;
  const base = (cutoff > 0 ? text.slice(0, cutoff) : text).trim();
  if (!base) return null;
  return { base, choices };
}

export function analyzeMultipleChoice(rawQuestion: string): McqAnalysis {
  const inverted = /\bnot\b|\bincorrect\b|\bNOT\b/.test(rawQuestion);
  const found = detectChoices(rawQuestion);
  if (!found) {
    return { inverted, established: false, base: rawQuestion.trim(), choices: [] };
  }
  // strip natural-language instruction wrappers so the shared classifier
  // sees the mathematical core ("Solve for x: 2x + 6 = 14" -> "2x + 6 = 14")
  const core = found.base
    .replace(/solve\s+for\s+[a-z]\s*:?/gi, "")
    .replace(/^(which|what)\s+(is\s+)?(not\s+)?(a\s+)?(solution|answer|value)\s+(of|to|for)?\s*/i, "")
    .replace(/^(solve|evaluate|compute|find|simplify|calculate)\b[:,]?\s*/gi, "")
    .replace(/^[?,\s]+/, "")
    .replace(/\?\s*$/, "")
    .trim();
  const n = normalizeMathText(core);
  const baseExpr = n.expressions[0] ?? core;
  const solution = solveProblem(baseExpr);
  const established = solution.solved && !!solution.finalAnswer;

  const choices: McqChoice[] = found.choices.map((c) => {
    if (!established) {
      return {
        label: c.label,
        text: c.text,
        verdict: "cannot_determine",
        reason: "the underlying problem could not be solved with certainty, so this choice is not judged",
      };
    }
    // Compare the candidate against the independently solved answer.
    // Solutions often present as "x = 4": a candidate may be written as the
    // bare value ("4") or the full pair ("x = 4") - both are matched.
    const cand = c.text.trim().replace(/^\(|\)$/g, "");
    const orPieces = solution.finalAnswer.split(/\bor\b|;|,/).map((t) => t.trim()).filter(Boolean);
    const answerVariants = new Set<string>();
    for (const piece of orPieces) {
      answerVariants.add(piece);
      if (piece.includes("=")) {
        const sides = piece.split("=").map((t) => t.trim());
        for (const side of sides) if (side) answerVariants.add(side);
      }
    }
    const same = Array.from(answerVariants).some((av) => av && equivalent(cand, av));
    if (same) {
      return {
        label: c.label,
        text: c.text,
        verdict: inverted ? "incorrect" : "correct",
        reason: `it equals the solved answer (${solution.finalAnswer})`,
      };
    }
    return {
      label: c.label,
      text: c.text,
      verdict: inverted ? "correct" : "incorrect",
      reason: `it does not equal the solved answer (${solution.finalAnswer})`,
    };
  });
  return { inverted, established, base: baseExpr, choices };
}

function equivalent(candidate: string, answer: string): boolean {
  const a = candidate.replace(/\s+/g, "").toLowerCase();
  const b = answer.replace(/\s+/g, "").replace(/\+c$/i, "").toLowerCase();
  if (a === b) return true;
  try {
    const mod = require("mathjs") as typeof import("mathjs");
    const diff = mod.simplify(`(${candidate}) - (${b})`).toString();
    if (diff === "0") return true;
    const d = mod.parse(diff).compile();
    for (const t of [0.37, 1.42, -0.61, 2.85]) {
      const v = d.evaluate({ x: t });
      if (!Number.isFinite(v) || Math.abs(v) > 1e-8) return false;
    }
    return true;
  } catch {
    return false;
  }
}
