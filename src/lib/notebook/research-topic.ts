/**
 * Notebook workspace — "Research this topic" pipeline (2026-10-06).
 *
 * Builds on the EXISTING research engine (never replaces it):
 *   src/lib/research/research.ts   — query generation, dedupe, generic ranking
 *   src/lib/research/authority.ts  — assignment-aware ranking (why selected)
 *   src/lib/research/provider.ts   — web search
 *   src/lib/research/verify.ts     — fetchAndVerify: real retrieval + verification
 *
 * The 10 steps (user-visible flow):
 *   1. analyze the research question
 *   2. determine required source types
 *   3. search the web (existing provider)
 *   4. rank candidates (existing rankCandidatesForAssignment)
 *   5. retrieve them (existing engine — REAL fetches)
 *   6. verify URLs (existing fetchAndVerify — dead URLs are rejected)
 *   7. store the ACTUAL source (verified extracted text + hash)
 *   8. display candidate sources
 *   9. allow the user to approve them
 *  10. add approved sources to the notebook
 *
 * HONESTY RULES (enforced, tested):
 *  - never invent a source
 *  - never generate a citation from a URL that was not actually retrieved
 *  - never use a dead URL
 *  - never use a search-result snippet as if it were verified content
 */

import { generateQueries, dedupeSources } from "../research/research";
import type { SearchHit, SearchProvider } from "../research/provider";
import { fetchAndVerify, type VerifiedPage } from "../research/verify";
import type { ResearchCandidate, NotebookSourceType, VerificationStatus } from "./types";

export interface TopicAnalysis {
  question: string;
  keywords: string[];
  requiredSourceTypes: string[]; // step 2 — e.g. primary/peer-reviewed
  academicLevel: "middle" | "high" | "college";
  dateRange: { from: string | null; to: string | null };
  rationale: string;
}

/** Step 1 + 2: deterministic question analysis → required source types. */
export function analyzeResearchQuestion(question: string, hints?: { academicLevel?: string; teacherRequirements?: string[] }): TopicAnalysis {
  const q = question.trim();
  const keywords = q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const lower = q.toLowerCase();
  const requiredSourceTypes: string[] = [];
  const currentEvents = /(current|recent|today|this year|202\d|news|ongoing)/.test(lower);
  if (currentEvents) requiredSourceTypes.push("current/reputable news or institutional coverage");
  if (/(histor|primary source|letter|diary|speech|treaty|census|archiv)/.test(lower)) requiredSourceTypes.push("primary sources");
  if (/(scient|medic|biolog|physic|chemi|study|clinical|experiment)/.test(lower)) requiredSourceTypes.push("peer-reviewed/scientific");
  if (/(statistic|data|survey|percentage|rate)/.test(lower)) requiredSourceTypes.push("data/statistical sources");
  if (requiredSourceTypes.length === 0) requiredSourceTypes.push("reputable general reference");
  const level = hints?.academicLevel === "college" ? "college" : hints?.academicLevel === "middle" ? "middle" : "high";
  return {
    question: q,
    keywords,
    requiredSourceTypes,
    academicLevel: level,
    dateRange: { from: currentEvents ? new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 2).toISOString() : null, to: null },
    rationale: `Analyzed the question; ${currentEvents ? "it concerns current events, so recency matters. " : ""}required source types: ${requiredSourceTypes.join("; ")}.`,
  };
}

export interface ResearchTopicDeps {
  provider: Pick<SearchProvider, "search">;
  /** existing assignment-aware ranker — injected to avoid import cycles in tests */
  ranker?: (hits: SearchHit[]) => SearchHit[];
  fetchImpl?: typeof fetch;
  maxCandidates?: number;
  /** inject for tests */
  verifier?: (url: string, opts?: { fetchImpl?: typeof fetch }) => Promise<VerifiedPage>;
}

/** Steps 1-8: run the pipeline, return CANDIDATES (step 9 is the user's). */
export async function researchTopic(
  question: string,
  deps: ResearchTopicDeps,
  hints?: { academicLevel?: string; teacherRequirements?: string[] }
): Promise<{ analysis: TopicAnalysis; candidates: ResearchCandidate[]; notes: string[] }> {
  const analysis = analyzeResearchQuestion(question, hints);
  const notes: string[] = [analysis.rationale];

  // step 3: search the web (existing query generation + dedupe)
  const queries = generateQueries(
    { topic: question, academicLevel: analysis.academicLevel, teacherRequirements: (hints?.teacherRequirements ?? []).join("; ") || null },
    3
  ).map((g) => g.query);
  const allHits: SearchHit[] = [];
  for (const q of queries) {
    try {
      allHits.push(...(await deps.provider.search(q, { maxResults: 8, fromDate: analysis.dateRange.from })));
    } catch (e) {
      notes.push(`search failed for "${q}": ${(e as Error).message}`);
    }
  }
  const hits = dedupeSources(allHits, 2);
  notes.push(`searched ${queries.length} queries, ${hits.length} unique candidates after dedupe.`);

  // step 4: rank (existing generic ranker, or the assignment-aware one)
  const ranked = (deps.ranker ?? ((h: SearchHit[]) => h))(hits).slice(0, deps.maxCandidates ?? 6);

  // steps 5-6: retrieve + verify each — REAL fetches only
  const candidates: ResearchCandidate[] = [];
  for (const hit of ranked) {
    let page: VerifiedPage | null = null;
    try {
      const verify = deps.verifier ?? ((u: string, o?: { fetchImpl?: typeof fetch }) => fetchAndVerify(u, o));
      page = await verify(hit.url, { fetchImpl: deps.fetchImpl });
    } catch {
      page = null;
    }
    if (!page || !page.ok) {
      // NEVER use a dead URL; the candidate is reported dead and excluded
      candidates.push({
        url: hit.url,
        title: hit.title,
        domain: hit.domain ?? "",
        published: hit.published ?? null,
        retrieved: false,
        deadUrl: true,
        contentChars: 0,
        contentHash: "",
        extractedText: "",
        verificationStatus: "inaccessible",
        authority: {},
        whySelected: { why: "URL did not retrieve — rejected; its snippet is NOT treated as source content." },
        snippetOnly: true,
      });
      continue;
    }
    // step 7 (candidate stage): store the ACTUAL verified content + hash
    candidates.push({
      url: page.finalUrl,
      title: page.title || hit.title,
      domain: page.domain,
      published: page.publicationDate,
      retrieved: true,
      deadUrl: false,
      contentChars: page.textChars,
      contentHash: page.hash,
      extractedText: page.text,
      verificationStatus: page.status,
      authority: { domain: page.domain, verification: page.status, notes: page.notes },
      whySelected: {
        authority: `domain ${page.domain}, verification: ${page.status}`,
        relevance: hit.title,
        date: page.publicationDate,
        sourceType: "web",
        why: "retrieved and verified through the existing research engine (real page text, hashed).",
        requirementSatisfied: null,
      },
      snippetOnly: false,
    });
  }

  const dead = candidates.filter((c) => c.deadUrl).length;
  if (dead > 0) notes.push(`${dead} candidate(s) had dead/inaccessible URLs — rejected (never cited).`);
  notes.push(
    candidates.filter((c) => !c.deadUrl).length +
      " verified candidate(s) ready for YOUR approval. Nothing is added to the notebook until you approve."
  );
  return { analysis, candidates: candidates.filter((c) => !c.deadUrl), notes };
}

/** Step 10: an APPROVED candidate becomes a real notebook source. Refuses dishonest conversions. */
export interface ApprovedSourceRow {
  title: string;
  sourceType: NotebookSourceType;
  originalUrl: string;
  canonicalUrl: string;
  contentHash: string;
  retrievedAt: string;
  extractedText: string;
  processingStatus: "ready";
  verificationStatus: VerificationStatus;
  included: boolean;
  pinned: boolean;
  authority: Record<string, unknown>;
  whySelected: ResearchCandidate["whySelected"];
}

export function approvedCandidateToSource(
  candidate: ResearchCandidate,
  _notebookId: string,
  sourceLabel: string
): ApprovedSourceRow {
  if (candidate.deadUrl || !candidate.retrieved) {
    throw new Error("refused: cannot add a source that was never actually retrieved (dead URL / snippet-only)");
  }
  if (!candidate.extractedText || !candidate.contentHash) {
    throw new Error("refused: candidate has no verified content — a snippet is not source content");
  }
  return {
    title: candidate.title,
    sourceType: "research_source" as NotebookSourceType,
    originalUrl: candidate.url,
    canonicalUrl: candidate.url,
    contentHash: candidate.contentHash,
    retrievedAt: new Date().toISOString(),
    extractedText: candidate.extractedText,
    processingStatus: "ready",
    verificationStatus: candidate.verificationStatus,
    included: true,
    pinned: false,
    authority: candidate.authority,
    whySelected: candidate.whySelected,
  };
}
