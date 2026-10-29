/**
 * Writing-profile learning (2026-10-29).
 *
 * WHAT THIS IS: a pure analyser that looks at the user's OWN writing samples and
 * proposes style adjustments for the user to approve or reject. Nothing is
 * applied automatically, nothing leaves the workspace, and no network call is
 * made. Approved suggestions land in the existing `writing_profiles` table
 * (0001_init.sql) - no new table, no schema change.
 *
 * WHAT THIS IS NOT, deliberately:
 * - It does not analyse, model, or attempt to defeat any AI-detection system.
 * - It makes no claim about who authored any text, and emits no authorship
 *   score, typing speed, pause metric, or "human-ness" estimate.
 * - It cannot be used to fake a revision trail. A previous request asked for
 *   simulated human typing, injected deliberate typos and staggered Word drafts
 *   so a document would *look* written by hand. That was declined and is
 *   recorded in docs/WRITING_PROFILE_LEARNING.md so it is not rebuilt by
 *   accident: manufacturing false evidence of authorship harms the student it
 *   is meant to help.
 *
 * The honest value is the opposite of disguise: help the user write more like
 * themselves, consistently, at the level their course expects.
 */
import { resolveAcademicLevel, type AcademicLevelId } from "./academic-levels";

export interface StyleSuggestion {
  id: string;
  category: "sentence_variation" | "vocabulary" | "transition" | "opening" | "closing";
  description: string;
  /** 0-1. Derived from sample count and effect size - never from a model guess. */
  confidence: number;
  scope: "temporary" | "course" | "global";
  requiresApproval: boolean;
}

const TRANSITIONS = [
  "however", "therefore", "moreover", "furthermore", "in addition", "for example",
  "for instance", "as a result", "consequently", "in contrast", "on the other hand",
  "first", "finally", "in conclusion", "meanwhile", "nevertheless",
];

/** Sample count at which a pattern is trusted enough to outlive one assignment. */
const COURSE_SAMPLE_THRESHOLD = 2;
const GLOBAL_SAMPLE_THRESHOLD = 5;

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).filter((w) => w.length > 1);
}

function paragraphsOf(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
}

function mean(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  return Math.sqrt(mean(nums.map((n) => (n - m) ** 2)));
}

/** Stable, content-free id so the same suggestion is always the same row. */
function stableId(category: string, level: AcademicLevelId): string {
  return `style-${category}-${level}`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number(n.toFixed(2))));
}

/**
 * PURE. Same samples + level + assignment type always produce the same array.
 * Returns [] rather than inventing advice when there is nothing to observe.
 */
export function proposeStyleSuggestions(
  samples: string[],
  academicLevel: string,
  assignmentType: string
): StyleSuggestion[] {
  const clean = (samples ?? []).filter((s) => typeof s === "string" && s.trim().length > 0);
  const spec = resolveAcademicLevel(academicLevel);
  const level: AcademicLevelId = spec?.id ?? "custom";
  const levelLabel = spec?.label ?? "your level";
  const task = (assignmentType ?? "").trim().toLowerCase();

  if (clean.length === 0) return [];

  const allSentences = clean.flatMap(sentencesOf);
  if (allSentences.length < 3) return [];

  // Scope grows with evidence, never with a single correction (section 4's rule:
  // one assignment's fix must not rewrite the whole profile).
  const scope: StyleSuggestion["scope"] =
    clean.length >= GLOBAL_SAMPLE_THRESHOLD ? "global"
    : clean.length >= COURSE_SAMPLE_THRESHOLD ? "course"
    : "temporary";

  const sampleFactor = Math.min(1, clean.length / GLOBAL_SAMPLE_THRESHOLD);
  const out: StyleSuggestion[] = [];

  // --- sentence length variation -------------------------------------------
  const lens = allSentences.map((s) => wordsOf(s).length).filter((n) => n > 0);
  const spread = stdev(lens);
  const avg = mean(lens);
  if (lens.length >= 3 && avg > 0) {
    // Low spread = monotone prose. Elementary/middle writers are expected to be
    // even; at higher levels flatness reads as under-developed argument.
    const flat = spread < 4;
    const veryLong = avg > 26;
    if (flat || veryLong) {
      out.push({
        id: stableId("sentence_variation", level),
        category: "sentence_variation",
        description: flat
          ? `Your sentences are close to a single length (about ${Math.round(avg)} words, spread ${spread.toFixed(1)}). For ${levelLabel} writing, mixing one short sentence among longer ones will make your argument easier to follow.`
          : `Your sentences average about ${Math.round(avg)} words, which is long for ${levelLabel} work. Splitting the longest ones would help a reader follow each step.`,
        confidence: clamp01(0.4 + sampleFactor * 0.5),
        scope,
        requiresApproval: true,
      });
    }
  }

  // --- vocabulary level ----------------------------------------------------
  const words = clean.flatMap(wordsOf);
  if (words.length >= 20) {
    const avgLen = mean(words.map((w) => w.length));
    const unique = new Set(words).size;
    const variety = unique / words.length;
    if (variety < 0.42) {
      out.push({
        id: stableId("vocabulary", level),
        category: "vocabulary",
        description: `You reuse a fairly small set of words (${unique} different words across ${words.length}). Naming things more precisely, rather than repeating the same verb or noun, is the usual fix at ${levelLabel} level.`,
        confidence: clamp01(0.35 + sampleFactor * 0.5),
        scope,
        requiresApproval: true,
      });
    } else if (avgLen > 7.2) {
      out.push({
        id: stableId("vocabulary", level),
        category: "vocabulary",
        description: `Your words average ${avgLen.toFixed(1)} letters, which is dense. At ${levelLabel} level that can read as inflated; a plainer word is usually stronger where it says the same thing.`,
        confidence: clamp01(0.3 + sampleFactor * 0.45),
        scope,
        requiresApproval: true,
      });
    }
  }

  // --- transition phrases --------------------------------------------------
  const lower = clean.join(" ").toLowerCase();
  const usedTransitions = TRANSITIONS.filter((t) => lower.includes(t));
  if (usedTransitions.length === 0 && allSentences.length >= 6) {
    out.push({
      id: stableId("transition", level),
      category: "transition",
      description: `I did not find a linking phrase between your ideas. Adding one where you move to a new point (for example "as a result" or "in contrast") shows the reader how the parts connect.`,
      confidence: clamp01(0.3 + sampleFactor * 0.4),
      scope,
      requiresApproval: true,
    });
  } else if (usedTransitions.length === 1 && allSentences.length >= 10) {
    out.push({
      id: stableId("transition", level),
      category: "transition",
      description: `You rely on "${usedTransitions[0]}" as your only connector. Varying it would keep the flow from feeling mechanical.`,
      confidence: clamp01(0.35 + sampleFactor * 0.4),
      scope,
      requiresApproval: true,
    });
  }

  // --- paragraph openings --------------------------------------------------
  const paras = clean.flatMap(paragraphsOf);
  if (paras.length >= 3) {
    const openings = paras
      .map((p) => (wordsOf(p)[0] ?? ""))
      .filter((w) => w.length > 0);
    const repeated = openings.filter((w, i) => openings.indexOf(w) !== i);
    if (repeated.length >= 2) {
      out.push({
        id: stableId("opening", level),
        category: "opening",
        description: `${repeated.length + 1} of your paragraphs open with the same word ("${repeated[0]}"). Changing how a paragraph starts is the cheapest way to make a page easier to read.`,
        confidence: clamp01(0.4 + sampleFactor * 0.45),
        scope,
        requiresApproval: true,
      });
    }
  }

  // --- closings ------------------------------------------------------------
  if (task.includes("essay") || task.includes("report") || task.includes("discussion")) {
    const hasClosing = /\b(in conclusion|to conclude|in summary|overall|ultimately)\b/i.test(lower);
    if (!hasClosing && allSentences.length >= 8) {
      out.push({
        id: stableId("closing", level),
        category: "closing",
        description: `This ${task || "piece"} has no closing sentence. A short final sentence that states what the evidence adds up to is expected in ${levelLabel} work.`,
        confidence: clamp01(0.3 + sampleFactor * 0.4),
        scope,
        requiresApproval: true,
      });
    }
  }

  // Deterministic order: category name, so the same input always matches.
  return out.sort((a, b) => a.category.localeCompare(b.category));
}
