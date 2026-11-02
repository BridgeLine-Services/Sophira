/**
 * ORIGINALITY REVIEW (Stage 3, 2026-11-02).
 *
 * Purpose: help a student SEE where their draft overlaps the sources they gave
 * Sophira, and where a quotation or borrowed phrase is missing its citation.
 *
 * Non-negotiable limits, encoded here rather than documented and hoped for:
 *  * Every finding carries the actual source passage and both offsets. If there
 *    is no matched source text, no finding is produced.
 *  * Sophira only compares against documents the student supplied (or that the
 *    research library has legitimately retrieved). It never claims to have
 *    searched the internet, an institution's database, or a detector service.
 *  * No similarity percentage is produced. A percentage would imply a complete
 *    corpus and would read as a grade.
 *  * Paraphrase detection is a heuristic over shared content words; findings are
 *    labelled "possible" and are reviewable, never accusations.
 */

export interface OriginalitySource {
  id: string;
  title: string;
  /** Full text of a document the student supplied or Sophira retrieved. */
  content: string;
  url?: string | null;
}

export type OriginalityKind =
  | "exact_overlap"
  | "close_paraphrase"
  | "unattributed_quotation"
  | "missing_citation"
  | "reused_source_language";

export interface OriginalityFinding {
  kind: OriginalityKind;
  /** Plain-language explanation, ready to show a student. */
  message: string;
  severity: "high" | "medium" | "low";
  /** The draft text the finding is about, and where it sits. */
  draftPassage: string;
  draftStart: number;
  draftEnd: number;
  /** Evidence. Present whenever a source was matched; null for citation hygiene. */
  sourceId: string | null;
  sourceTitle: string | null;
  sourcePassage: string | null;
  sourceUrl?: string | null;
  /** How much text matched, in words. Never a percentage. */
  matchedWords?: number;
}

export interface Token {
  text: string;
  start: number;
  end: number;
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "has", "have",
  "had", "of", "in", "on", "at", "to", "for", "from", "by", "with", "as", "it", "its", "their",
  "they", "we", "you", "i", "he", "she", "them", "his", "her", "our", "your", "not", "no", "so",
  "such", "can", "could", "would", "should", "may", "might", "will", "shall", "there", "here",
  "which", "who", "whom", "what", "when", "where", "why", "how", "also", "more", "most", "very",
]);

/** Word-level tokens with character offsets, so findings can point at real text. */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /[A-Za-z0-9][A-Za-z0-9'’-]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: m[0].toLowerCase().replace(/’/g, "'"), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

/** Sentence spans with offsets. Deliberately simple: no parser, no surprises. */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^.!?\n]+[.!?]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    if (raw.trim().length === 0) continue;
    out.push({ text: raw.trim(), start: m.index, end: m.index + raw.length });
  }
  return out;
}

function contentWords(tokens: Token[]): string[] {
  return tokens.map((t) => t.text).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Longest run of consecutive identical tokens starting at i/j. */
function runLength(a: Token[], i: number, b: Token[], j: number): number {
  let n = 0;
  while (i + n < a.length && j + n < b.length && a[i + n].text === b[j + n].text) n++;
  return n;
}

export const MIN_EXACT_WORDS = 12;
export const PARAPHRASE_THRESHOLD = 0.72;

/**
 * Verbatim overlaps of MIN_EXACT_WORDS or more, reported as maximal runs.
 * Overlapping runs inside the same span are collapsed so one passage produces
 * one finding, not five.
 */
export function findExactOverlaps(draft: string, source: OriginalitySource): OriginalityFinding[] {
  const d = tokenize(draft);
  const s = tokenize(source.content);
  if (d.length < MIN_EXACT_WORDS || s.length < MIN_EXACT_WORDS) return [];

  const findings: OriginalityFinding[] = [];
  let lastDraftEndToken = -1;

  for (let j = 0; j < s.length; j++) {
    for (let i = 0; i < d.length; i++) {
      const len = runLength(d, i, s, j);
      if (len < MIN_EXACT_WORDS) {
        if (len > 0) i += len - 1;
        continue;
      }
      if (i <= lastDraftEndToken) continue; // already covered by a previous run
      const start = d[i].start;
      const end = d[i + len - 1].end;
      findings.push({
        kind: "exact_overlap",
        message:
          `This passage matches ${source.title} word for word. If you did not mean to quote it directly, rewrite it in your own words and cite the original.`,
        severity: len >= 25 ? "high" : "medium",
        draftPassage: draft.slice(start, end),
        draftStart: start,
        draftEnd: end,
        sourceId: source.id,
        sourceTitle: source.title,
        sourcePassage: source.content.slice(s[j].start, s[j + len - 1].end),
        sourceUrl: source.url ?? null,
        matchedWords: len,
      });
      lastDraftEndToken = i + len - 1;
      i += len - 1;
    }
  }
  return findings;
}

/** Jaccard overlap of content words between two strings (0..1). */
export function contentOverlap(a: string, b: string): number {
  const A = new Set(contentWords(tokenize(a)));
  const B = new Set(contentWords(tokenize(b)));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}

/**
 * Sentences that are heavily reworded copies: shared content-word overlap at or
 * above PARAPHRASE_THRESHOLD without being verbatim. Labelled "possible" because
 * a paraphrase heuristic can be wrong, and being wrong here is costly.
 */
export function findCloseParaphrases(draft: string, source: OriginalitySource): OriginalityFinding[] {
  const findings: OriginalityFinding[] = [];
  const draftSentences = splitSentences(draft);
  const sourceSentences = splitSentences(source.content);

  for (const ds of draftSentences) {
    if (tokenize(ds.text).length < 8) continue;
    for (const ss of sourceSentences) {
      if (ss.text.toLowerCase().trim() === ds.text.toLowerCase().trim()) continue; // exact: covered above
      const ratio = contentOverlap(ds.text, ss.text);
      if (ratio < PARAPHRASE_THRESHOLD) continue;
      findings.push({
        kind: "close_paraphrase",
        message:
          `This sentence follows ${source.title} very closely in wording and structure. Possible close paraphrase - rewording it and citing the source keeps it clearly yours.`,
        severity: "medium",
        draftPassage: ds.text,
        draftStart: ds.start,
        draftEnd: ds.end,
        sourceId: source.id,
        sourceTitle: source.title,
        sourcePassage: ss.text,
        sourceUrl: source.url ?? null,
      });
      break; // one source match per draft sentence
    }
  }
  return findings;
}

/** Citation markers near a span: bracketed, simple (Author, Year) / (Author Year). */
export function hasCitationMarkerNear(text: string, start: number, end: number, window = 80): boolean {
  const slice = text.slice(Math.max(0, start - window), Math.min(text.length, end + window));
  return (
    /\[\d+\]/.test(slice) ||
    /\([A-Z][A-Za-z.'-]+[^)]{0,40}\d{4}[^)]{0,10}\)/.test(slice) ||
    /\b(according to|as cited in|as noted by|per)\b/i.test(slice)
  );
}

/** Quoted material with no citation anywhere near it. */
export function findUnattributedQuotations(draft: string): OriginalityFinding[] {
  const findings: OriginalityFinding[] = [];
  const re = /["“]([^"”]{25,400})["”]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(draft)) !== null) {
    const quote = m[1];
    if (tokenize(quote).length < 8) continue;
    const start = m.index;
    const end = m.index + m[0].length;
    if (hasCitationMarkerNear(draft, start, end)) continue;
    findings.push({
      kind: "unattributed_quotation",
      message: "The quotation is present, but its citation is missing. Add where it came from and who said it.",
      severity: "high",
      draftPassage: draft.slice(start, end),
      draftStart: start,
      draftEnd: end,
      sourceId: null,
      sourceTitle: null,
      sourcePassage: null,
      sourceUrl: null,
    });
  }
  return findings;
}

/** Factual-looking sentences with no citation and no source support. */
export function findMissingCitations(draft: string, sources: OriginalitySource[]): OriginalityFinding[] {
  const findings: OriginalityFinding[] = [];
  for (const s of splitSentences(draft)) {
    const looksFactual = /\d+(\.\d+)?\s?(%|percent\b|million\b|billion\b|years?\b|studies\b|participants\b)/i.test(s.text) ||
      /\b(research|studies|data|survey|report)s?\s+(show|shown|suggest|indicate|found)\b/i.test(s.text) ||
      /\baccording to\b/i.test(s.text);
    if (!looksFactual) continue;
    if (hasCitationMarkerNear(draft, s.start, s.end)) continue;
    const supported = sources.some((src) => contentOverlap(s.text, src.content) >= 0.5);
    if (supported) continue; // it has a supplied source behind it; overlap is reported elsewhere
    findings.push({
      kind: "missing_citation",
      message: "This sentence makes a factual claim, but I could not find a supporting source for it. Add a citation or soften the claim.",
      severity: "medium",
      draftPassage: s.text,
      draftStart: s.start,
      draftEnd: s.end,
      sourceId: null,
      sourceTitle: null,
      sourcePassage: null,
      sourceUrl: null,
    });
  }
  return findings;
}

/** Source phrases reused in more than one paragraph of the draft. */
export function findReusedSourceLanguage(draft: string, source: OriginalitySource): OriginalityFinding[] {
  const findings: OriginalityFinding[] = [];
  const paragraphs = draft.split(/\n{2,}/);
  const offsetOf: number[] = [];
  let cursor = 0;
  for (const p of paragraphs) {
    offsetOf.push(cursor);
    cursor += p.length + 2;
  }
  const sourceTokens = tokenize(source.content);
  const SHINGLE = 8;
  const seen = new Map<string, number[]>();

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const toks = tokenize(paragraphs[pi]);
    for (let i = 0; i + SHINGLE <= toks.length; i++) {
      const key = toks.slice(i, i + SHINGLE).map((t) => t.text).join(" ");
      if (!seen.has(key)) seen.set(key, []);
      const list = seen.get(key)!;
      if (!list.includes(pi)) list.push(pi);
    }
  }
  for (const [key, paras] of seen) {
    if (paras.length < 2) continue;
    const words = key.split(" ");
    const inSource = sourceTokens.some((_, i) =>
      i + SHINGLE <= sourceTokens.length &&
      sourceTokens.slice(i, i + SHINGLE).map((t) => t.text).join(" ") === key
    );
    if (!inSource) continue;
    const pi = paras[0];
    const para = paragraphs[pi];
    const idx = para.toLowerCase().indexOf(words[0]);
    const start = offsetOf[pi] + (idx >= 0 ? idx : 0);
    findings.push({
      kind: "reused_source_language",
      message: `This phrase from ${source.title} appears more than once in your draft. Saying it once, in your own words, reads more clearly.`,
      severity: "low",
      draftPassage: para.slice(Math.max(0, idx), Math.max(0, idx) + 200),
      draftStart: start,
      draftEnd: start + Math.min(200, para.length),
      sourceId: source.id,
      sourceTitle: source.title,
      sourcePassage: null,
      sourceUrl: source.url ?? null,
      matchedWords: SHINGLE,
    });
  }
  return findings;
}

/** Runs every originality check. Findings are ordered by where they occur. */
export function runOriginalityReview(
  draft: string,
  sources: OriginalitySource[]
): OriginalityFinding[] {
  if (draft.trim().length === 0) return [];
  const findings: OriginalityFinding[] = [];
  for (const src of sources) {
    if (!src.content || src.content.trim().length === 0) continue;
    findings.push(...findExactOverlaps(draft, src));
    findings.push(...findCloseParaphrases(draft, src));
    findings.push(...findReusedSourceLanguage(draft, src));
  }
  findings.push(...findUnattributedQuotations(draft));
  findings.push(...findMissingCitations(draft, sources));
  return findings.sort((a, b) => a.draftStart - b.draftStart);
}

/** What this review did and did not look at. Shown to the student verbatim. */
export function originalityScopeNote(sourceCount: number): string {
  if (sourceCount === 0) {
    return "No sources were supplied, so Sophira could only check quotations and citations in your own text. It did not compare your writing against any outside document.";
  }
  return `Sophira compared your draft against the ${sourceCount} source${sourceCount === 1 ? "" : "s"} you supplied. It did not search the internet, your school's databases, or any detector service, so this is not a similarity score.`;
}
