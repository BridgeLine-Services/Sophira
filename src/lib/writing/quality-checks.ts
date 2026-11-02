/**
 * WRITING QUALITY CHECKS (Stage 3, 2026-11-02).
 *
 * These are deterministic, explainable checks - no model guesses. Each finding
 * says what it noticed and where, in language a student can act on.
 *
 * A `replacement` is only ever attached when the fix is mechanical and safe
 * (a citation-free terminology variant, unbalanced quotes, double spaces). Checks
 * that need judgement carry advice instead, so Sophira never rewrites a student's
 * argument on their behalf.
 */
import { splitSentences, tokenize, contentOverlap, type OriginalitySource } from "./originality";

export type QualityKind =
  | "unsupported_claim"
  | "weak_argument"
  | "inconsistent_terminology"
  | "poor_transition"
  | "repetitive_language"
  | "unverified_quotation"
  | "formatting"
  | "missing_bibliography_entry"
  | "rubric_requirement";

export interface QualityFinding {
  kind: QualityKind;
  message: string;
  severity: "high" | "medium" | "low";
  /** Draft offsets. For whole-document findings these span the affected text. */
  start: number;
  end: number;
  passage: string;
  /** Deterministic fix, applied only if the student accepts it. */
  replacement?: string;
  /** Plain advice when no automatic fix exists. */
  advice?: string;
  /** Rubric findings name the requirement they refer to. */
  requirement?: string;
}

const CONNECTIVES = [
  "however", "therefore", "thus", "consequently", "moreover", "furthermore", "meanwhile",
  "in addition", "for example", "for instance", "in contrast", "similarly", "finally",
  "first", "second", "third", "next", "then", "because", "although", "while", "despite",
  "as a result", "in conclusion", "overall", "instead", "yet", "but", "and", "so",
];

const EVIDENCE_WORDS = [
  "because", "data", "study", "studies", "research", "according", "found", "shows", "shown",
  "evidence", "example", "for instance", "measured", "reported", "survey", "cited",
];

/** Sentences stating numbers or studies with no citation anywhere near them. */
export function checkUnsupportedClaims(draft: string): QualityFinding[] {
  const out: QualityFinding[] = [];
  for (const s of splitSentences(draft)) {
    const numeric = /\b\d+(\.\d+)?\s?(%|percent\b)/i.test(s.text);
    const study = /\b(studies|research|surveys?|data)\b[^.]{0,40}\b(show|shows|suggest|suggests|indicate|indicates|found|prove|proves)\b/i.test(s.text);
    if (!numeric && !study) continue;
    if (/\[\d+\]|\([^)]*\b(19|20)\d{2}\b[^)]*\)/.test(s.text)) continue;
    out.push({
      kind: "unsupported_claim",
      message: "This sentence makes a factual claim, but I could not find a supporting source for it.",
      severity: "high",
      start: s.start,
      end: s.end,
      passage: s.text,
      advice: "Add a citation, or soften the claim so it reads as your observation rather than a fact.",
    });
  }
  return out;
}

/** Paragraphs that assert without any supporting move. */
export function checkWeakArguments(draft: string): QualityFinding[] {
  const out: QualityFinding[] = [];
  const paragraphs = draft.split(/\n{2,}/);
  let cursor = 0;
  for (const p of paragraphs) {
    const start = cursor;
    cursor += p.length + 2;
    const trimmed = p.trim();
    if (tokenize(trimmed).length < 40) continue;
    const lower = trimmed.toLowerCase();
    const hasEvidence = EVIDENCE_WORDS.some((w) => lower.includes(w));
    const hedgy = /\b(some people|many people|it is said|everyone knows|obviously|clearly)\b/i.test(lower);
    if (hasEvidence && !hedgy) continue;
    out.push({
      kind: "weak_argument",
      message: hedgy
        ? "This paragraph leans on a general statement (\"some people\", \"obviously\") instead of evidence. Naming who says it, or what shows it, makes it stronger."
        : "This paragraph makes a claim without showing why it is true. An example, a source, or a reason would strengthen it.",
      severity: "medium",
      start,
      end: start + p.length,
      passage: trimmed.slice(0, 220),
      advice: "Add a reason, an example, or a citation that supports the point.",
    });
  }
  return out;
}

/** Same term written two different ways; offers the most common form. */
export function checkTerminology(draft: string): QualityFinding[] {
  const variants = new Map<string, Map<string, number>>();
  for (const t of tokenize(draft)) {
    const raw = draft.slice(t.start, t.end);
    const key = t.text.replace(/[-']/g, "");
    if (key.length < 5) continue;
    if (!variants.has(key)) variants.set(key, new Map());
    const m = variants.get(key)!;
    m.set(raw, (m.get(raw) ?? 0) + 1);
  }
  const out: QualityFinding[] = [];
  for (const [, forms] of variants) {
    if (forms.size < 2) continue;
    const sorted = [...forms.entries()].sort((a, b) => b[1] - a[1]);
    const preferred = sorted[0][0];
    for (const [form, count] of sorted.slice(1)) {
      if (form.toLowerCase() === preferred.toLowerCase() && form !== preferred) {
        // capitalisation-only difference: advisory, no automatic rewrite
        out.push({
          kind: "inconsistent_terminology",
          message: `"${form}" and "${preferred}" are the same term written differently. Choosing one keeps your writing consistent.`,
          severity: "low",
          start: 0,
          end: 0,
          passage: form,
          advice: `Use "${preferred}" throughout, or "${form}" if that is the correct spelling for your course.`,
        });
        break;
      }
      if (count === 0) continue;
      out.push({
        kind: "inconsistent_terminology",
        message: `You use both "${preferred}" and "${form}". Courses usually expect one consistent spelling.`,
        severity: "low",
        start: 0,
        end: 0,
        passage: form,
        advice: `Pick one form - "${preferred}" appears more often.`,
      });
    }
  }
  return out.slice(0, 5);
}

/** Paragraphs that start with no link to what came before. */
export function checkTransitions(draft: string): QualityFinding[] {
  const out: QualityFinding[] = [];
  const paragraphs = draft.split(/\n{2,}/);
  if (paragraphs.length < 2) return out;
  let cursor = 0;
  let prev = "";
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const start = cursor;
    cursor += p.length + 2;
    const trimmed = p.trim();
    if (i === 0) { prev = trimmed; continue; }
    if (trimmed.length < 60) { prev = trimmed; continue; }
    const firstSentence = splitSentences(trimmed)[0]?.text ?? trimmed;
    const lower = firstSentence.toLowerCase().trim();
    const startsWithConnect = CONNECTIVES.some((c) => lower.startsWith(c + " ") || lower.startsWith(c + ","));
    const linksBack = contentOverlap(firstSentence, prev) >= 0.18;
    if (startsWithConnect || linksBack) { prev = trimmed; continue; }
    out.push({
      kind: "poor_transition",
      message: "This paragraph starts abruptly. A short transition shows the reader how it connects to the paragraph before.",
      severity: "low",
      start,
      end: start + Math.min(firstSentence.length, 200),
      passage: firstSentence.slice(0, 200),
      advice: "Open with a word like \"However\", \"Building on this\", or \"A second reason\" - whichever is actually true.",
    });
    prev = trimmed;
  }
  return out;
}

/** Near-identical consecutive sentences or paragraphs. */
export function checkRepetition(draft: string): QualityFinding[] {
  const out: QualityFinding[] = [];
  const sentences = splitSentences(draft);
  for (let i = 1; i < sentences.length; i++) {
    const a = sentences[i - 1];
    const b = sentences[i];
    if (tokenize(b.text).length < 8) continue;
    if (contentOverlap(a.text, b.text) < 0.8) continue;
    out.push({
      kind: "repetitive_language",
      message: "These two sentences repeat almost the same point. Keeping one, or combining them, reads more clearly.",
      severity: "medium",
      start: b.start,
      end: b.end,
      passage: b.text,
      advice: "Delete or merge one of the two sentences.",
    });
  }
  const paragraphs = draft.split(/\n{2,}/);
  if (paragraphs.length >= 2) {
    let cursor = 0;
    const offsets: number[] = [];
    for (const p of paragraphs) { offsets.push(cursor); cursor += p.length + 2; }
    for (let i = 1; i < paragraphs.length; i++) {
      if (contentOverlap(paragraphs[i - 1], paragraphs[i]) < 0.85) continue;
      out.push({
        kind: "repetitive_language",
        message: "These two paragraphs repeat almost the same argument. Consider merging them or cutting one.",
        severity: "medium",
        start: offsets[i],
        end: offsets[i] + paragraphs[i].length,
        passage: paragraphs[i].trim().slice(0, 220),
        advice: "Merge the two paragraphs into one, keeping only the new detail.",
      });
    }
  }
  return out.slice(0, 8);
}

/**
 * Quotations Sophira cannot find in the supplied sources. This never says the
 * quotation is fabricated - only that it could not be confirmed here.
 */
export function checkQuotations(draft: string, sources: OriginalitySource[]): QualityFinding[] {
  const out: QualityFinding[] = [];
  const re = /["“]([^"”]{25,400})["”]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(draft)) !== null) {
    const quote = m[1];
    if (tokenize(quote).length < 8) continue;
    const found = sources.some((s) => {
      const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      return norm(s.content).includes(norm(quote).slice(0, Math.min(60, norm(quote).length)));
    });
    if (found) continue;
    out.push({
      kind: "unverified_quotation",
      message: sources.length === 0
        ? "This quotation is not linked to any source. Sophira has nothing to check it against yet."
        : "I could not find this exact quotation in the sources you supplied. Check the wording and the page before you submit.",
      severity: "high",
      start: m.index,
      end: m.index + m[0].length,
      passage: draft.slice(m.index, m.index + m[0].length),
      advice: "Open the original and compare word by word; small changes inside quotation marks count as errors.",
    });
  }
  return out;
}

/** Mechanical problems that are always safe to fix. */
export function checkFormatting(draft: string): QualityFinding[] {
  const out: QualityFinding[] = [];
  const doubleSpace = /\S {2,}\S/;
  if (doubleSpace.test(draft)) {
    out.push({
      kind: "formatting",
      message: "There are double spaces between words.",
      severity: "low",
      start: 0,
      end: draft.length,
      passage: "double spaces",
      replacement: draft.replace(/(\S) {2,}(\S)/g, "$1 $2"),
      advice: "Removing the extra spaces does not change your meaning.",
    });
  }
  const spaceBeforePunct = /\s+[,.;:!?]/;
  if (spaceBeforePunct.test(draft)) {
    out.push({
      kind: "formatting",
      message: "Some punctuation has a space in front of it.",
      severity: "low",
      start: 0,
      end: draft.length,
      passage: "spaced punctuation",
      replacement: draft.replace(/\s+([,.;:!?])/g, "$1"),
      advice: "Punctuation belongs directly against the word before it.",
    });
  }
  const quotes = (draft.match(/"/g) ?? []).length;
  if (quotes % 2 === 1) {
    out.push({
      kind: "formatting",
      message: "A quotation mark is opened but never closed.",
      severity: "medium",
      start: 0,
      end: draft.length,
      passage: "unbalanced quotation marks",
      advice: "Find the opening quote and add or remove the closing one.",
    });
  }
  return out;
}

/** Inline citation markers with no matching entry in a reference list. */
export function checkBibliography(draft: string): QualityFinding[] {
  const markers = draft.match(/\[(\d+)\]/g) ?? [];
  if (markers.length === 0) return [];
  const hasReferences = /\b(references|works cited|bibliography)\b/i.test(draft);
  if (hasReferences) {
    const tail = draft.slice(draft.toLowerCase().search(/\b(references|works cited|bibliography)\b/i));
    const missing = [...new Set(markers)].filter((mk) => !tail.includes(mk));
    if (missing.length === 0) return [];
    return [{
      kind: "missing_bibliography_entry",
      message: `Your reference list has no entry for ${missing.join(", ")}.`,
      severity: "high",
      start: draft.length - tail.length,
      end: draft.length,
      passage: missing.join(", "),
      advice: "Add each missing source to the reference list, or remove the marker.",
    }];
  }
  return [{
    kind: "missing_bibliography_entry",
    message: "You cite numbered sources, but there is no reference list at the end.",
    severity: "high",
    start: 0,
    end: draft.length,
    passage: markers.join(", "),
    advice: "Add a References or Works Cited section listing each numbered source.",
  }];
}

export interface RubricItem {
  /** What the rubric asks for, e.g. "uses three peer-reviewed sources". */
  text: string;
  /** Words that would have to appear for Sophira to find it. */
  keywords?: string[];
}

/** Rubric requirements Sophira cannot find evidence of in the draft. */
export function checkRubric(draft: string, rubric: RubricItem[]): QualityFinding[] {
  const out: QualityFinding[] = [];
  const lower = draft.toLowerCase();
  for (const item of rubric) {
    const kw = (item.keywords && item.keywords.length > 0
      ? item.keywords
      : item.text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4)
    ).slice(0, 6);
    if (kw.length === 0) continue;
    const hits = kw.filter((k) => lower.includes(k.toLowerCase())).length;
    if (hits / kw.length >= 0.5) continue;
    out.push({
      kind: "rubric_requirement",
      message: `Your rubric asks for "${item.text}", and I could not find it in the draft.`,
      severity: "medium",
      start: 0,
      end: 0,
      passage: item.text,
      requirement: item.text,
      advice: "Check whether this requirement is met, or ask Sophira to help you plan that part.",
    });
  }
  return out;
}

export function runQualityChecks(
  draft: string,
  sources: OriginalitySource[],
  rubric: RubricItem[] = []
): QualityFinding[] {
  if (draft.trim().length === 0) return [];
  return [
    ...checkUnsupportedClaims(draft),
    ...checkWeakArguments(draft),
    ...checkTransitions(draft),
    ...checkRepetition(draft),
    ...checkQuotations(draft, sources),
    ...checkTerminology(draft),
    ...checkFormatting(draft),
    ...checkBibliography(draft),
    ...checkRubric(draft, rubric),
  ].sort((a, b) => a.start - b.start);
}
