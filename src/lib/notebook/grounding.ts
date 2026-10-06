/**
 * Notebook workspace — grounding engine (2026-10-06).
 *
 * THE CORE HONESTY RULE: notebook chat is grounded ONLY in the user's
 * selected notebook sources, unless the user EXPLICITLY enables web
 * research for that question. Every answer statement carries exactly one
 * label:
 *
 *   SOURCE-SUPPORTED — the statement is backed by an exact passage in a
 *                      notebook source (char offsets recorded; the quote
 *                      must be locatable verbatim in extracted_text).
 *   INFERENCE        — derived from the sources but not stated verbatim;
 *                      the sources that led to the inference are cited.
 *   NOT VERIFIED     — no notebook source supports it. Shown, never hidden.
 *
 * Statements the model (or user) proposes are VERIFIED deterministically
 * against source content before earning SOURCE-SUPPORTED — a claim that
 * cannot be located is downgraded to NOT VERIFIED. A search-result snippet
 * can never act as source content (snippets are not stored as text).
 */

import type {
  AnswerLabel,
  GroundedAnswer,
  GroundedStatement,
  InlineCitation,
  NotebookSource,
  SourceLocator,
} from "./types";

/* ------------------------------------------------------------------ */
/* Locator resolution — "clicking a citation opens the exact location" */
/* ------------------------------------------------------------------ */

export function resolveLocator(
  source: Pick<NotebookSource, "sourceType" | "extractedText" | "pageMetadata" | "sectionMetadata" | "originalUrl" | "canonicalUrl" | "retrievedAt" | "verificationStatus">,
  start: number | null,
  end: number | null
): SourceLocator {
  const locator: SourceLocator = {};
  if (typeof start === "number" && typeof end === "number") {
    locator.charsStart = start;
    locator.charsEnd = end;
    if (source.sourceType === "pdf") {
      const page = source.pageMetadata.find(
        (p) => start >= p.charsStart && start < Math.max(p.charsEnd, p.charsStart + 1)
      );
      if (page) locator.page = page.page;
    }
    if (source.sourceType === "docx") {
      const sec = source.sectionMetadata.find(
        (s) => start >= s.charsStart && start < Math.max(s.charsEnd, s.charsStart + 1)
      );
      if (sec) {
        locator.section = sec.section;
        locator.paragraph = sec.paragraph;
      }
    }
  }
  if (source.sourceType === "web_url") {
    locator.url = source.canonicalUrl || source.originalUrl;
    if (source.retrievedAt) locator.retrievedAt = source.retrievedAt;
  }
  return locator;
}

/** Marker format per source type (PDF → page; web → URL+retrieved; DOCX → section/¶). */
export function citationMarker(source: NotebookSource, locator: SourceLocator): string {
  const s = source.sourceId;
  if (source.sourceType === "pdf" && typeof locator.page === "number") return `[${s} p.${locator.page}]`;
  if (source.sourceType === "docx" && locator.section) return `[${s} ${locator.section}${locator.paragraph ? " ¶" + locator.paragraph : ""}]`;
  if (source.sourceType === "web_url" && locator.url) {
    const when = locator.retrievedAt ? `, retrieved ${locator.retrievedAt.slice(0, 10)}` : "";
    return `[${s} ${locator.url}${when}]`;
  }
  if (typeof locator.charsStart === "number") return `[${s} @${locator.charsStart}]`;
  return `[${s}]`;
}

/* ------------------------------------------------------------------ */
/* Passage location (verbatim-only support)                            */
/* ------------------------------------------------------------------ */

export function locateVerbatim(passage: string, content: string): { start: number; end: number } | null {
  const p = passage.trim();
  if (p.length < 12) return null; // too short to count as evidence
  const idx = content.indexOf(p);
  if (idx === -1) return null;
  return { start: idx, end: idx + p.length };
}

/** Normalize whitespace so real-space PDF text still matches. */
function softMatch(passage: string, content: string): { start: number; end: number } | null {
  const direct = locateVerbatim(passage, content);
  if (direct) return direct;
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  const np = norm(passage);
  if (!np) return null;
  const haystack = norm(content);
  const idx = haystack.indexOf(np);
  if (idx === -1) return null;
  // map normalized offsets back approximately: find a window around the
  // proportional position and locate verbatim there
  const approxStart = Math.floor((idx / Math.max(1, haystack.length)) * content.length);
  const window = content.slice(Math.max(0, approxStart - 200), approxStart + np.length + 400);
  const w = locateVerbatim(passage, window);
  if (w) return { start: Math.max(0, approxStart - 200) + w.start, end: Math.max(0, approxStart - 200) + w.end };
  return null;
}

/* ------------------------------------------------------------------ */
/* Grounding                                                           */
/* ------------------------------------------------------------------ */

export interface GroundRequest {
  question: string;
  sources: NotebookSource[]; // ALL notebook sources; grounding uses ONLY included ones
  /** proposed statements from the model or user, each optionally with claimed
   *  support: { quote, sourceId }. Statements without claimed support start
   *  as INFERENCE candidates. */
  proposals?: ProposedStatement[];
  /** the user EXPLICITLY enabled web research for this question */
  allowWebResearch?: boolean;
  /** web findings already fetched+verified through the honest pipeline */
  webSources?: NotebookSource[];
}

export interface ProposedStatement {
  text: string;
  quote?: string; // claimed verbatim support
  sourceId?: string; // claimed source label (e.g. "S2")
  claimed?: AnswerLabel; // what the model claims
}

export function buildGroundedAnswer(req: GroundRequest): GroundedAnswer {
  const notes: string[] = [];
  const usable = req.sources.filter((s) => s.included && s.processingStatus === "ready" && s.extractedText);
  const pinned = usable.filter((s) => s.pinned);
  const pool = [...(pinned.length > 0 ? pinned : usable)];
  const webUsable = (req.allowWebResearch ? req.webSources ?? [] : []).filter((s) => s.extractedText);
  if (req.allowWebResearch && webUsable.length === 0) {
    notes.push("Web research was enabled for this question, but no verified web source was found — nothing from the web is cited.");
  }
  if (!req.allowWebResearch) {
    notes.push("Grounded ONLY in this notebook's selected sources (web research is off for this question).");
  }
  const byLabel = new Map<string, NotebookSource>();
  for (const s of [...pool, ...webUsable]) byLabel.set(s.sourceId, s);

  const statements: GroundedStatement[] = [];
  const used = new Set<string>();

  const proposals =
    req.proposals && req.proposals.length > 0
      ? req.proposals
      : extractRelevantProposals(req.question, pool.concat(webUsable));

  for (const p of proposals) {
    const st = verifyProposal(p, byLabel, used, notes);
    statements.push(st);
  }

  const answered = statements.some((s) => s.label === "SOURCE-SUPPORTED");
  if (!answered) {
    notes.push(
      "No statement in this answer could be verified verbatim against a notebook source. Everything shown is labeled NOT VERIFIED or INFERENCE — nothing is presented as fact."
    );
  }
  return {
    question: req.question,
    statements,
    notes,
    usedSources: Array.from(used),
    groundedIn: req.allowWebResearch ? "notebook sources + web research" : "notebook sources",
  };
}

function verifyProposal(
  p: ProposedStatement,
  byLabel: Map<string, NotebookSource>,
  used: Set<string>,
  notes: string[]
): GroundedStatement {
  // 1. claimed verbatim support → must actually be locatable
  if (p.quote && p.sourceId) {
    const src = byLabel.get(p.sourceId);
    if (!src) {
      return {
        text: p.text,
        label: "NOT VERIFIED",
        citations: [],
        reason: `cites ${p.sourceId}, which is not an included notebook source for this answer`,
      };
    }
    const loc = softMatch(p.quote, src.extractedText);
    if (loc) {
      used.add(src.sourceId);
      const locator = resolveLocator(src, loc.start, loc.end);
      const cit: InlineCitation = {
        marker: citationMarker(src, locator),
        sourceId: src.id,
        sourceLabel: src.sourceId,
        label: "SOURCE-SUPPORTED",
        locator,
        quote: p.quote.trim(),
      };
      return {
        text: p.text,
        label: "SOURCE-SUPPORTED",
        citations: [cit],
        reason: "exact passage located verbatim in the cited notebook source",
      };
    }
    // claimed support NOT locatable → downgrade, honestly
    notes.push(
      `A statement claimed support from ${p.sourceId} that could not be located in its content — downgraded to NOT VERIFIED, never faked.`
    );
    return {
      text: p.text,
      label: "NOT VERIFIED",
      citations: [],
      reason: `claimed quote from ${p.sourceId} was NOT found in the stored source content (never faked)`,
    };
  }

  // 2. no claimed support → INFERENCE only if an inference anchor exists
  if (p.claimed === "SOURCE-SUPPORTED") {
    return {
      text: p.text,
      label: "NOT VERIFIED",
      citations: [],
      reason: "claimed SOURCE-SUPPORTED without a locatable passage — downgraded",
    };
  }
  if (p.sourceId) {
    const src = byLabel.get(p.sourceId);
    if (src) {
      used.add(src.sourceId);
      const locator = resolveLocator(src, null, null);
      return {
        text: p.text,
        label: "INFERENCE",
        citations: [
          {
            marker: citationMarker(src, locator),
            sourceId: src.id,
            sourceLabel: src.sourceId,
            label: "INFERENCE",
            locator,
          },
        ],
        reason: "derived from the cited notebook source(s), not stated verbatim there",
      };
    }
  }
  return {
    text: p.text,
    label: "NOT VERIFIED",
    citations: [],
    reason: "no notebook source supports this statement",
  };
}

/**
 * No-LLM fallback: deterministic retrieval — the most relevant verbatim
 * passages become SOURCE-SUPPORTED proposals, directly quoted.
 * (When the server model is available, its proposals go through the same
 * verifyProposal gate; this path keeps the notebook honest without any
 * model at all.)
 */
export function extractRelevantProposals(question: string, sources: NotebookSource[]): ProposedStatement[] {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  const proposals: ProposedStatement[] = [];
  for (const src of sources.slice(0, 6)) {
    const sentences = src.extractedText
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 40);
    const scored = sentences
      .map((s) => {
        const low = s.toLowerCase();
        return { s, score: words.reduce((acc, w) => acc + (low.includes(w) ? 1 : 0), 0) };
      })
      .sort((a, b) => b.score - a.score)
      .filter((x) => x.score > 0)
      .slice(0, 3);
    for (const x of scored) {
      proposals.push({ text: `"${x.s}"`, quote: x.s, sourceId: src.sourceId, claimed: "SOURCE-SUPPORTED" });
    }
  }
  return proposals.slice(0, 12);
}

const STOPWORDS = new Set(["what", "when", "where", "which", "does", "this", "that", "with", "about", "from", "have", "been", "were", "their", "there", "would", "could", "should", "explain", "describe"]);
