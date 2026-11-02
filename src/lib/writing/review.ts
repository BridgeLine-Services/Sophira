/**
 * WRITING REVIEW ORCHESTRATOR (Stage 3, 2026-11-02).
 *
 * Ties three existing things together without replacing any of them:
 *  * originality findings (./originality) - source-backed overlap and citation hygiene
 *  * quality findings (./quality-checks) - explainable, deterministic review notes
 *  * citation verification outcomes (src/lib/research/citation-invariant.ts) - reused
 *    as-is, so a citation Sophira could not retrieve can never be called verified.
 *
 * Review model: the student's original text is never mutated by a review run.
 * `applyAcceptedChanges` produces a NEW string, so the UI can show original and
 * revision side by side until the student confirms.
 */
import {
  runOriginalityReview,
  originalityScopeNote,
  type OriginalityFinding,
  type OriginalitySource,
} from "./originality";
import { runQualityChecks, type QualityFinding, type RubricItem } from "./quality-checks";
import type { CitationStatus } from "@/lib/research/citation-invariant";

/** The improvements a student can ask for. Stored per review, not per profile. */
export type WritingGoal =
  | "clarity"
  | "grammar"
  | "organization"
  | "simpler_explanations"
  | "less_repetition"
  | "transitions"
  | "stronger_arguments"
  | "preserve_terminology"
  | "preserve_meaning";

export const ALL_GOALS: { id: WritingGoal; label: string }[] = [
  { id: "clarity", label: "Improve clarity" },
  { id: "grammar", label: "Improve grammar" },
  { id: "organization", label: "Improve organization" },
  { id: "simpler_explanations", label: "Make explanations easier to understand" },
  { id: "less_repetition", label: "Reduce unnecessary repetition" },
  { id: "transitions", label: "Improve transitions" },
  { id: "stronger_arguments", label: "Strengthen arguments" },
  { id: "preserve_terminology", label: "Preserve technical terminology" },
  { id: "preserve_meaning", label: "Preserve the original meaning" },
];

export type ReviewCategory = "originality" | "quality" | "citation";

export interface ReviewFinding {
  /** Stable across runs for the same draft, so accept/reject survives a re-run. */
  id: string;
  category: ReviewCategory;
  kind: string;
  message: string;
  severity: "high" | "medium" | "low";
  start: number;
  end: number;
  passage: string;
  advice?: string;
  /** Only present when the fix is mechanical; applying it never changes meaning. */
  replacement?: string;
  sourceTitle?: string | null;
  sourcePassage?: string | null;
  sourceUrl?: string | null;
  requirement?: string;
}

export interface CitationEvidenceInput {
  claim: string;
  status: CitationStatus;
  sourceTitle?: string | null;
  url?: string | null;
  passage?: string | null;
}

export interface ReviewInput {
  draft: string;
  sources?: OriginalitySource[];
  rubric?: RubricItem[];
  goals?: WritingGoal[];
  citations?: CitationEvidenceInput[];
}

export interface ReviewResult {
  findings: ReviewFinding[];
  /** Shown at the top of the panel, in this order. */
  notes: string[];
  counts: { originality: number; quality: number; citation: number; fixable: number };
  /** True when the draft had nothing to review. */
  empty: boolean;
}

/** Deterministic id: same finding, same draft, same id. */
function findingId(kind: string, start: number, end: number, extra = ""): string {
  return `${kind}:${start}-${end}${extra ? ":" + extra : ""}`;
}

function fromOriginality(f: OriginalityFinding): ReviewFinding {
  return {
    id: findingId(f.kind, f.draftStart, f.draftEnd, f.sourceId ?? ""),
    category: "originality",
    kind: f.kind,
    message: f.message,
    severity: f.severity,
    start: f.draftStart,
    end: f.draftEnd,
    passage: f.draftPassage,
    sourceTitle: f.sourceTitle,
    sourcePassage: f.sourcePassage,
    sourceUrl: f.sourceUrl ?? null,
  };
}

function fromQuality(f: QualityFinding): ReviewFinding {
  return {
    id: findingId(f.kind, f.start, f.end),
    category: "quality",
    kind: f.kind,
    message: f.message,
    severity: f.severity,
    start: f.start,
    end: f.end,
    passage: f.passage,
    advice: f.advice,
    replacement: f.replacement,
    requirement: f.requirement,
  };
}

const CITATION_TEXT: Record<CitationStatus, { message: string; severity: ReviewFinding["severity"] }> = {
  VERIFIED: {
    message: "Sophira retrieved this source and found the passage that supports the claim.",
    severity: "low",
  },
  UNVERIFIED: {
    message: "Sophira could not confirm that this source supports the claim. Check it before you submit.",
    severity: "high",
  },
  UNAVAILABLE: {
    message: "This source could not be opened when Sophira checked, so the claim is not confirmed either way.",
    severity: "medium",
  },
  STALE: {
    message: "This source was checked some time ago and may have changed since. Re-check it before you submit.",
    severity: "medium",
  },
};

/**
 * Citation outcomes, mapped to plain language. VERIFIED is passed through only
 * when it really is verified upstream; anything else keeps its honest status.
 */
export function citationFindings(citations: CitationEvidenceInput[] = []): ReviewFinding[] {
  return citations.map((c, i) => {
    const text = CITATION_TEXT[c.status] ?? CITATION_TEXT.UNVERIFIED;
    return {
      id: findingId("citation", i, i, c.status),
      category: "citation" as const,
      kind: c.status.toLowerCase(),
      message: text.message,
      severity: text.severity,
      start: 0,
      end: 0,
      passage: c.claim,
      sourceTitle: c.sourceTitle ?? null,
      sourcePassage: c.passage ?? null,
      sourceUrl: c.url ?? null,
      advice:
        c.status === "VERIFIED"
          ? undefined
          : "Open the source yourself and confirm the exact wording before relying on it.",
    };
  });
}

/**
 * Goals filter what the student sees. "Preserve terminology" removes terminology
 * notes; "Preserve meaning" is enforced structurally by only ever attaching
 * whitespace/punctuation replacements, so it cannot rewrite prose.
 */
function applyGoals(findings: ReviewFinding[], goals: WritingGoal[]): ReviewFinding[] {
  if (goals.length === 0) return findings;
  const keep = (f: ReviewFinding): boolean => {
    if (goals.includes("preserve_terminology") && f.kind === "inconsistent_terminology") return false;
    if (goals.includes("less_repetition") && f.kind === "repetitive_language") return true;
    if (goals.includes("transitions") && f.kind === "poor_transition") return true;
    if (goals.includes("stronger_arguments") && (f.kind === "weak_argument" || f.kind === "unsupported_claim")) return true;
    if (goals.includes("simpler_explanations") && f.kind === "weak_argument") return true;
    if (goals.includes("organization") && (f.kind === "poor_transition" || f.kind === "repetitive_language")) return true;
    // Unselected areas still surface when they are serious: a missing citation or
    // an unattributed quotation is never hidden just because it was not asked for.
    return f.severity === "high" || f.category === "citation" || f.category === "originality";
  };
  return findings.filter(keep);
}

export function runWritingReview(input: ReviewInput): ReviewResult {
  const draft = input.draft ?? "";
  const sources = input.sources ?? [];
  const rubric = input.rubric ?? [];
  const goals = input.goals ?? [];

  if (draft.trim().length === 0) {
    return {
      findings: [],
      notes: ["There is no text to review yet. Paste or open a draft and Sophira will check it."],
      counts: { originality: 0, quality: 0, citation: 0, fixable: 0 },
      empty: true,
    };
  }

  const originality = runOriginalityReview(draft, sources).map(fromOriginality);
  const quality = runQualityChecks(draft, sources, rubric).map(fromQuality);
  const citations = citationFindings(input.citations);

  const all = applyGoals([...originality, ...quality, ...citations], goals)
    .sort((a, b) => a.start - b.start || b.severity.localeCompare(a.severity));

  const notes = [
    originalityScopeNote(sources.length),
    "Sophira did not change your text. Every suggestion below waits for your decision.",
  ];
  if (sources.length > 0 && originality.length === 0) {
    notes.push("No overlap was found with the sources you supplied. That is not a similarity score: only those sources were compared.");
  }

  return {
    findings: all,
    notes,
    counts: {
      originality: all.filter((f) => f.category === "originality").length,
      quality: all.filter((f) => f.category === "quality").length,
      citation: all.filter((f) => f.category === "citation").length,
      fixable: all.filter((f) => typeof f.replacement === "string").length,
    },
    empty: false,
  };
}

export interface ApplyResult {
  text: string;
  applied: string[];
  skipped: string[];
}

/**
 * Applies ACCEPTED fixes only. Only whole-document mechanical replacements are
 * applied (double spaces, spaced punctuation): those are the ones whose
 * `replacement` is the entire corrected document. Anything else is advice the
 * student edits themselves, because Sophira will not silently rewrite prose.
 */
export function applyAcceptedChanges(
  draft: string,
  findings: ReviewFinding[],
  acceptedIds: string[]
): ApplyResult {
  const accepted = new Set(acceptedIds);
  const applied: string[] = [];
  const skipped: string[] = [];
  let text = draft;

  for (const f of findings) {
    if (!accepted.has(f.id)) continue;
    if (typeof f.replacement !== "string") {
      skipped.push(f.id);
      continue;
    }
    text = f.replacement;
    applied.push(f.id);
  }

  return { text, applied, skipped };
}

/** Side-by-side view model: nothing is merged, nothing is lost. */
export function reviewSummary(result: ReviewResult): string {
  if (result.empty) return "Nothing to review yet.";
  const { originality, quality, citation } = result.counts;
  const parts: string[] = [];
  if (originality > 0) parts.push(`${originality} source-related note${originality === 1 ? "" : "s"}`);
  if (citation > 0) parts.push(`${citation} citation check${citation === 1 ? "" : "s"}`);
  if (quality > 0) parts.push(`${quality} writing note${quality === 1 ? "" : "s"}`);
  if (parts.length === 0) return "Sophira found nothing to change.";
  return `Sophira found ${parts.join(", ")}. You decide what to keep.`;
}
