/**
 * Rubric engine (spec §6): structured checklist extraction + deterministic
 * post-generation auditing.
 *
 * Philosophy, per spec:
 *  - Parse the assignment/instructions/rubric into a STRUCTURED checklist.
 *  - After generation, audit the draft against every criterion.
 *  - Deterministic validation wherever possible (word count, section
 *    presence, headings, citation count, bibliography, prohibited
 *    elements). The model is NEVER allowed to just declare "this meets the
 *    rubric" — code checks what code can check.
 *  - AI semantic evaluation ONLY for criteria deterministic code cannot
 *    check; those results are recorded as AI-assessed (honest labeling).
 */

export type CriterionKind =
  | "word_count_min"
  | "word_count_max"
  | "section_presence"
  | "headings_required"
  | "bibliography"
  | "citation_count"
  | "citation_style"
  | "prohibited_element"
  | "required_component"
  | "semantic";

export interface RubricCriterion {
  id: string;
  label: string;
  kind: CriterionKind;
  source: "rubric" | "instructions" | "teacher_doc";
  params: {
    minWords?: number;
    maxWords?: number;
    sections?: string[];
    minCitations?: number;
    style?: string;
    prohibited?: string[];
    components?: string[];
    detail?: string;
  };
}

export interface RubricChecklist {
  criteria: RubricCriterion[];
  derivedFrom: { rubricChars: number; instructionChars: number; teacherDocCount: number };
}

export type CriterionStatus = "satisfied" | "partial" | "not_satisfied" | "needs_semantic";

export interface CriterionResult {
  id: string;
  label: string;
  kind: CriterionKind;
  status: CriterionStatus;
  evidence: string;
  requiredCorrection: string;
}

export interface RubricAuditResult {
  wordCount: number;
  results: CriterionResult[];
  summary: {
    passed: number;
    partial: number;
    failed: number;
    needsSemantic: number;
    allPassed: boolean;
  };
}

export interface RubricInput {
  rubricText?: string | null;
  instructionsText?: string | null;
  teacherDocs?: { title: string; content: string }[];
}

// ---------------------------------------------------------------------------
// Parsing: text → structured checklist
// ---------------------------------------------------------------------------

function pushCriterion(list: RubricCriterion[], c: RubricCriterion) {
  // dedupe by (kind + label)
  if (!list.some((x) => x.kind === c.kind && x.label === c.label)) list.push(c);
}

function parseWordLimits(text: string, out: RubricCriterion[], source: RubricCriterion["source"]) {
  const t = text.toLowerCase();
  const atLeast = t.match(/(?:at least|minimum of|no fewer than|min(?:imum)?\.?|不少于)\s*([\d,]+)\s*(?:words|word)/);
  if (atLeast) {
    const n = parseInt(atLeast[1].replace(/,/g, ""), 10);
    pushCriterion(out, {
      id: `wc_min_${n}`, label: `At least ${n.toLocaleString()} words`, kind: "word_count_min",
      source, params: { minWords: n },
    });
  }
  const noMore = t.match(/(?:no more than|at most|maximum of|no longer than|max(?:imum)?\.?)\s*([\d,]+)\s*(?:words|word)/);
  if (noMore) {
    const n = parseInt(noMore[1].replace(/,/g, ""), 10);
    pushCriterion(out, {
      id: `wc_max_${n}`, label: `No more than ${n.toLocaleString()} words`, kind: "word_count_max",
      source, params: { maxWords: n },
    });
  }
}

function parseSections(text: string, out: RubricCriterion[], source: RubricCriterion["source"]) {
  const t = text.toLowerCase();
  // "must include: intro, body, conclusion" / "sections: ...", "should include"
  for (const re of [
    /(?:must include|required sections?|sections?|must contain|should include|include the following)[:\s]+([^.\/\n]{4,200})/g,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const chunk = m[1];
      // split on commas / slashes / "and" only if it looks like a list
      const items = chunk
        .split(/,|\/|\band\b/g)
        .map((x) => x.trim())
        .filter((x) => x.length > 2 && x.length < 40 && !/^\d+$/.test(x));
      if (items.length >= 2) {
        pushCriterion(out, {
          id: `sections_${items.map((i) => i.replace(/\W+/g, "").slice(0, 8)).join("_")}`,
          label: `Required sections: ${items.map((i) => i.replace(/^an? |^the /, "")).join(", ")}`,
          kind: "section_presence",
          source,
          params: { sections: items.map((i) => i.replace(/^an? |^the /, "")) },
        });
        break; // one section-list per source text is enough
      }
    }
  }
  if (/\bworks cited\b|\bbibliography\b|\breferences (?:page|list|section)\b/.test(t)) {
    pushCriterion(out, {
      id: "bibliography", label: "Bibliography / works-cited section present",
      kind: "bibliography", source,
      params: {},
    });
  }
}

function parseCitations(text: string, out: RubricCriterion[], source: RubricCriterion["source"]) {
  const t = text.toLowerCase();
  const style = t.match(/\b(mla|apa|chicago|harvard|turabian|ieee)\b/);
  if (style) {
    pushCriterion(out, {
      id: `style_${style[1]}`, label: `Citation style: ${style[1].toUpperCase()}`,
      kind: "citation_style", source, params: { style: style[1].toUpperCase() },
    });
  }
  const count = t.match(/(?:at least|minimum of|no fewer than)?\s*([\d,]+)\s*(?:sources?|references?|citations?)/);
  if (count && /at least|minimum|no fewer than|sources? required|require/.test(t)) {
    const n = parseInt(count[1].replace(/,/g, ""), 10);
    if (n > 0 && n < 200) {
      pushCriterion(out, {
        id: `cites_${n}`, label: `At least ${n} cited ${n === 1 ? "source" : "sources"}`,
        kind: "citation_count", source, params: { minCitations: n },
      });
    }
  }
}

function parseProhibited(text: string, out: RubricCriterion[], source: RubricCriterion["source"]) {
  const t = text.toLowerCase();
  const bans: string[] = [];
  if (/\bno first[- ]person\b|\bdo not use (?:the )?first person\b|\bavoid (?:the )?first person\b/.test(t)) {
    bans.push("first person (I, me, my, we, our)");
  }
  if (/\bno (?:personal )?pronouns\b|\bavoid (?:personal )?pronouns\b/.test(t)) bans.push("personal pronouns");
  if (/\bno (?:wikipedia|wiki)\b/.test(t)) bans.push("Wikipedia as a source");
  if (/\bno (?:bullet points|bullets)\b/.test(t)) bans.push("bullet points");
  if (/\bno (?:contractions)\b/.test(t)) bans.push("contractions");
  if (bans.length) {
    pushCriterion(out, {
      id: "prohibited", label: `Prohibited: ${bans.join("; ")}`,
      kind: "prohibited_element", source, params: { prohibited: bans },
    });
  }
}

/** Build a structured checklist from all available instruction sources. */
export function buildChecklist(input: RubricInput): RubricChecklist {
  const criteria: RubricCriterion[] = [];
  const rubric = input.rubricText || "";
  const instructions = input.instructionsText || "";
  const teacherDocs = input.teacherDocs || [];

  parseWordLimits(instructions, criteria, "instructions");
  parseWordLimits(rubric, criteria, "rubric");
  parseSections(instructions, criteria, "instructions");
  parseSections(rubric, criteria, "rubric");
  parseCitations(instructions, criteria, "instructions");
  parseCitations(rubric, criteria, "rubric");
  parseProhibited(instructions, criteria, "instructions");
  parseProhibited(rubric, criteria, "rubric");

  for (const doc of teacherDocs) {
    const t = `${doc.title}\n${doc.content}`;
    parseWordLimits(t, criteria, "teacher_doc");
    parseSections(t, criteria, "teacher_doc");
    parseCitations(t, criteria, "teacher_doc");
    parseProhibited(t, criteria, "teacher_doc");
  }

  // Semantic catch-all: any rubric text that produced NO deterministic
  // criteria still gets evaluated — honestly labeled as AI-assessed.
  const hasStructured = criteria.length > 0;
  if (rubric.trim() || (hasStructured && rubric.trim())) {
    criteria.push({
      id: "semantic_rubric",
      label: "All rubric requirements are met (AI-assessed — read the rubric against the draft)",
      kind: "semantic",
      source: "rubric",
      params: { detail: rubric.slice(0, 4000) },
    });
  }

  return {
    criteria,
    derivedFrom: {
      rubricChars: rubric.length,
      instructionChars: instructions.length,
      teacherDocCount: teacherDocs.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Auditing: draft → deterministic per-criterion results
// ---------------------------------------------------------------------------

export function countWords(draft: string): number {
  const m = draft.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function findHeading(draft: string, name: string): string | null {
  const lower = draft.toLowerCase();
  const variants = [
    name,
    name.replace(/\s+/, "[ .:_-]+"),
  ];
  for (const v of variants) {
    const re = new RegExp(`(^|\\n)\\s*(?:#+\\s*)?(?:\\d+\\.?\\s*)?\\**\\s*${v}\\s*\\**\\s*:?\\s*(\\n|$)`, "i");
    const m = re.exec(lower);
    if (m) {
      // The match may START at the newline before the heading — skip that
      // prefix so the evidence line is the heading itself, never "".
      const lineStart = m.index + (m[1] ? m[1].length : 0);
      const line = draft.slice(lineStart).split("\n")[0].trim();
      return line.slice(0, 120) || name;
    }
  }
  return null;
}

const BIBLIO_RE = /(^|\n)\s*(?:#+\s*)?\**\s*(works cited|bibliography|references)\s*\**\s*:?\s*(\n|$)/i;

function countCitations(draft: string): number {
  // Count distinct-looking citation markers: parenthetical (Author 2020),
  // (Author et al.), footnotes [1], or "Author (2020)".
  const parenthetical = draft.match(/\([A-Z][A-Za-z'’\-]+(?:\s+et al\.?| and [A-Z][A-Za-z'’\-]+)?,?\s+\d{4}[a-z]?\)/g) || [];
  const authorYear = draft.match(/\b[A-Z][A-Za-z'’\-]+(?:\s+et al\.?)?\s+\(\d{4}[a-z]?\)/g) || [];
  const footnotes = draft.match(/\[\d+\]/g) || [];
  return new Set([...parenthetical, ...authorYear, ...footnotes]).size;
}

/**
 * Deterministic audit. Criteria that code cannot check come back as
 * `needs_semantic` for a clearly-labeled AI evaluation pass.
 */
export function auditDraft(draft: string, checklist: RubricChecklist): RubricAuditResult {
  const words = countWords(draft);
  const results: CriterionResult[] = [];

  for (const c of checklist.criteria) {
    const base = { id: c.id, label: c.label, kind: c.kind };
    switch (c.kind) {
      case "word_count_min": {
        const min = c.params.minWords ?? 0;
        const ok = words >= min;
        results.push({
          ...base,
          status: ok ? "satisfied" : words >= min * 0.9 ? "partial" : "not_satisfied",
          evidence: `Draft has ${words.toLocaleString()} words (required: at least ${min.toLocaleString()}).`,
          requiredCorrection: ok ? "" : `Expand the draft by at least ${(min - words).toLocaleString()} words.`,
        });
        break;
      }
      case "word_count_max": {
        const max = c.params.maxWords ?? Infinity;
        const ok = words <= max;
        results.push({
          ...base,
          status: ok ? "satisfied" : "not_satisfied",
          evidence: `Draft has ${words.toLocaleString()} words (limit: ${max.toLocaleString()}).`,
          requiredCorrection: ok ? "" : `Trim at least ${(words - max).toLocaleString()} words.`,
        });
        break;
      }
      case "section_presence": {
        const found: string[] = [];
        const missing: string[] = [];
        for (const s of c.params.sections ?? []) {
          if (findHeading(draft, s)) found.push(s);
          else missing.push(s);
        }
        const ok = missing.length === 0;
        results.push({
          ...base,
          status: ok ? "satisfied" : found.length ? "partial" : "not_satisfied",
          evidence: ok
            ? `All required sections found as headings: ${found.join(", ")}.`
            : `Found: ${found.length ? found.join(", ") : "none"}. Missing: ${missing.join(", ")}.`,
          requiredCorrection: ok ? "" : `Add sections/headings for: ${missing.join(", ")}.`,
        });
        break;
      }
      case "bibliography": {
        const m = draft.match(BIBLIO_RE);
        results.push({
          ...base,
          status: m ? "satisfied" : "not_satisfied",
          evidence: m ? `Bibliography section heading found: "${m[2]}".` : "No Works Cited / Bibliography / References section found.",
          requiredCorrection: m ? "" : "Add a Works Cited / References section at the end.",
        });
        break;
      }
      case "citation_count": {
        const n = countCitations(draft);
        const min = c.params.minCitations ?? 0;
        results.push({
          ...base,
          status: n >= min ? "satisfied" : n > 0 ? "partial" : "not_satisfied",
          evidence: `Detected ${n} distinct citation${n === 1 ? "" : "s"} in the draft (required: at least ${min}).`,
          requiredCorrection: n >= min ? "" : `Cite at least ${min - n} more source${min - n === 1 ? "" : "s"}.`,
        });
        break;
      }
      case "citation_style": {
        // Deterministic-ish: style presence is judged by in-text marker shape.
        const style = c.params.style ?? "";
        const has = {
          MLA: /\([A-Z][a-z’'\-]+\s+\d+[a-z]?\)/.test(draft) || /\b[A-Z][a-z]+\s+\d+[a-z]?\./.test(draft),
          APA: /\([A-Z][a-zA-Z'’\-]+(?:\s+et al\.?,?)?\s*,\s*\d{4}[a-z]?\)/.test(draft),
          CHICAGO: /\[\d+\]/.test(draft) || /\b\d+\.\s+[A-Z][a-z]+,\s+[A-Z][a-z]+\./.test(draft),
          HARVARD: /\([A-Z][a-zA-Z'’\-]+\s+\d{4}[a-z]?\)/.test(draft),
          TURABIAN: /\[\d+\]/.test(draft),
          IEEE: /\[\d+\]/.test(draft),
        } as Record<string, boolean>;
        const ok = has[style] ?? false;
        results.push({
          ...base,
          status: ok ? "satisfied" : "needs_semantic",
          evidence: ok
            ? `In-text citation markers consistent with ${style} detected.`
            : `Could not deterministically confirm ${style}-style in-text markers; needs review.`,
          requiredCorrection: "",
        });
        break;
      }
      case "prohibited_element": {
        const hits: string[] = [];
        for (const p of c.params.prohibited ?? []) {
          if (p.includes("first person")) {
            const firstPerson = draft.match(/\b(I|me|my|we|our)\b/g) || [];
            // Ignore the works-cited section, where "I" is rare anyway.
            if (firstPerson.length > 2) hits.push(`first person (${firstPerson.length} uses)`);
          } else if (p.includes("pronouns") && /\b(I|you|we|our)\b/.test(draft)) {
            hits.push("personal pronouns");
          } else if (p.toLowerCase().includes("wikipedia") && /wikipedia/i.test(draft)) {
            hits.push("Wikipedia mentioned");
          } else if (p.includes("bullet") && /(^|\n)\s*[-*•]\s+/.test(draft)) {
            hits.push("bullet points");
          } else if (p.includes("contractions") && /\b\w+['’](s|t|re|ve|ll|d|m)\b/i.test(draft)) {
            hits.push("contractions");
          }
        }
        results.push({
          ...base,
          status: hits.length === 0 ? "satisfied" : "not_satisfied",
          evidence: hits.length === 0 ? "None of the prohibited elements found." : `Found: ${hits.join("; ")}.`,
          requiredCorrection: hits.length ? `Remove: ${hits.join("; ")}.` : "",
        });
        break;
      }
      case "required_component":
      case "semantic":
      default:
        results.push({
          ...base,
          status: "needs_semantic",
          evidence: "Cannot be checked deterministically — requires semantic evaluation.",
          requiredCorrection: "",
        });
        break;
    }
  }

  const passed = results.filter((r) => r.status === "satisfied").length;
  const partial = results.filter((r) => r.status === "partial").length;
  const failed = results.filter((r) => r.status === "not_satisfied").length;
  const needsSemantic = results.filter((r) => r.status === "needs_semantic").length;

  return {
    wordCount: words,
    results,
    summary: {
      passed,
      partial,
      failed,
      needsSemantic,
      allPassed: failed === 0 && partial === 0,
    },
  };
}

/** Merge AI semantic evaluations into the audit (clearly labeled). */
export function mergeSemanticResults(
  audit: RubricAuditResult,
  semantic: { id: string; status: "satisfied" | "partial" | "not_satisfied"; evidence: string; requiredCorrection?: string }[]
): RubricAuditResult {
  const results = audit.results.map((r) => {
    const s = semantic.find((x) => x.id === r.id);
    if (!s) return r;
    return {
      ...r,
      status: s.status,
      evidence: `${s.evidence} (AI-assessed)`,
      requiredCorrection: s.requiredCorrection || r.requiredCorrection,
    };
  });
  const passed = results.filter((r) => r.status === "satisfied").length;
  const partial = results.filter((r) => r.status === "partial").length;
  const failed = results.filter((r) => r.status === "not_satisfied").length;
  return {
    ...audit,
    results,
    summary: { passed, partial, failed, needsSemantic: 0, allPassed: failed === 0 && partial === 0 },
  };
}

/** Human-readable failed-criteria instruction for a revision pass. */
export function failedCriteriaForRevision(audit: RubricAuditResult): string {
  return audit.results
    .filter((r) => r.status === "not_satisfied" || r.status === "partial")
    .map((r) => `- ${r.label}: ${r.requiredCorrection || "address this criterion"} (evidence: ${r.evidence})`)
    .join("\n");
}
