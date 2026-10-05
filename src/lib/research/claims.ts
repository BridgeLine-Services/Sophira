/**
 * Claim-evidence traceability (research-integrity round, 2026-10-05).
 *
 * Requirement: every substantive factual claim must trace
 *   CLAIM → SOURCE → EXACT SUPPORTING PASSAGE → SOURCE URL → VERIFICATION STATUS
 * and a claim may be VERIFIED only if the RETRIEVED CONTENT of the source
 * actually supports it — never merely because the URL resolves, the page
 * exists, the title matches, or the domain is reputable.
 *
 * Philosophy (same as the rest of the research stack): the model may PROPOSE
 * claims and point at passages; the SERVER verifies mechanically:
 *   - the supporting passage must be locatable VERBATIM (whitespace/quote
 *     tolerant) inside the stored retrieved content — paraphrased or invented
 *     evidence is rejected;
 *   - every numeric figure in the claim must appear in the passage;
 *   - the claim must overlap the passage substantively (deterministic token
 *     overlap, reusing claimSupportsDeterministic);
 *   - a claim with no passage, or whose source content is unavailable, is
 *     UNVERIFIED — the system never guesses support and never invents URLs,
 *     titles, authors, DOIs, dates, quotes, or evidence passages.
 *
 * Pure functions only — fully unit-testable offline (like every lib module).
 */

import { claimSupportsDeterministic } from "./citation";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ClaimStatus = "verified" | "partially_supported" | "unsupported" | "unverified";

/** What the extraction stage produces per claim (model-proposed, server-normalized). */
export interface ClaimCandidate {
  claim_id: string;
  claim_text: string;
  /** [S#] labels of the sources the model says support this claim. */
  source_labels: string[];
  supporting_passage: string;
}

/** The minimal source shape verification needs (from research_sources rows). */
export interface SourceForClaims {
  id: string;
  url: string;              // final_url (fallback original_url) — set by caller
  title: string;            // verified page <title>
  content: string;          // stored retrieved content_extract
  verification_status: string; // verified/partially_verified/unverified/failed/inaccessible
  domain?: string;
  doi?: string | null;
}

/** A full evidence-trace row: CLAIM → SOURCE → PASSAGE → URL → STATUS. */
export interface ClaimEvidenceRecord {
  claim_id: string;
  assignment_id: string | null;
  claim_text: string;
  source_id: string;
  source_url: string;
  source_title: string;
  exact_supporting_passage: string;
  evidence_start: number | null;   // character offsets into the stored content, when locatable
  evidence_end: number | null;
  verification_status: ClaimStatus;
  confidence: number;
  authority_score: number;
  verified_at: string;
  reasons: string[];
}

export interface IntegrityReportInput {
  /** Live liveness of each CITED source at report time: does the URL resolve now? */
  url_resolves: Record<string, boolean>;
  /** Does the page title correspond to the title the search provider listed? */
  title_match: Record<string, boolean>;
  /** Does the source satisfy the assignment's authority requirement (sourceType)? */
  authority_ok: Record<string, boolean>;
  authority_required: string | null;
  now: string;
}

export interface IntegrityFailure {
  claim_id: string;
  claim_text: string;
  reason: string;
  action: string;
}

export interface IntegrityReport {
  claims_total: number;
  claims_supported: number;
  claims_partially_supported: number;
  claims_unsupported: number;
  claims_unverified: number;
  urls_total: number;
  urls_resolve: number;
  titles_total: number;
  titles_match: number;
  authority_total: number;
  authority_satisfied: number;
  authority_required: string | null;
  research_complete: boolean;
  failures: IntegrityFailure[];
}

/* ------------------------------------------------------------------ */
/* Extraction-stage normalization (never trusts the model blindly)      */
/* ------------------------------------------------------------------ */

const MAX_CLAIMS = 24;
const MAX_CLAIM_CHARS = 400;
const MAX_PASSAGE_CHARS = 800;

/**
 * Normalizes the model's self-reported factual_claims JSON. Junk entries are
 * dropped; claim ids are ASSIGNED BY THE SERVER (C1, C2, …) so they are
 * stable and never model-invented.
 */
export function normalizeClaimCandidates(
  raw: unknown,
  sourceCount: number
): ClaimCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: ClaimCandidate[] = [];
  let n = 0;
  for (const item of raw) {
    if (n >= MAX_CLAIMS) break;
    if (!item || typeof item !== "object") continue;
    const o = item as { claim?: unknown; claim_text?: unknown; sources?: unknown; source?: unknown; supporting_passage?: unknown; passage?: unknown; evidence?: unknown };
    const claim = typeof o.claim === "string" ? o.claim : typeof o.claim_text === "string" ? o.claim_text : "";
    const passageRaw =
      typeof o.supporting_passage === "string" ? o.supporting_passage :
      typeof o.passage === "string" ? o.passage :
      typeof o.evidence === "string" ? o.evidence : "";
    const srcsRaw = Array.isArray(o.sources) ? o.sources : Array.isArray(o.source) ? o.source : [o.source];
    const labels: string[] = [];
    for (const s of srcsRaw) {
      if (typeof s !== "string") continue;
      const idx = parseInt(s.replace(/\D/g, ""), 10);
      if (Number.isInteger(idx) && idx >= 1 && idx <= sourceCount) {
        const label = `S${idx}`;
        if (!labels.includes(label)) labels.push(label);
      }
    }
    const c = claim.trim();
    if (c.length < 10 || labels.length === 0) continue; // a claim must be a real sentence with a cited source
    n++;
    out.push({
      claim_id: `C${n}`,
      claim_text: c.slice(0, MAX_CLAIM_CHARS),
      source_labels: labels,
      supporting_passage: passageRaw.trim().slice(0, MAX_PASSAGE_CHARS),
    });
  }
  return out;
}

/**
 * Deterministic claim extraction from plain text (fallback / offline path):
 * sentences carrying concrete factual markers (numbers, percentages, years)
 * are the individually verifiable factual claims. Used when a model plan is
 * unavailable so the pipeline still has claims to verify — never invented.
 */
export function extractFactualSentences(text: string, max = MAX_CLAIMS): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    if (out.length >= max) break;
    if (s.length < 15 || s.length > MAX_CLAIM_CHARS) continue;
    if (!/\d/.test(s)) continue; // factual marker: contains a figure
    out.push(s);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Passage location (verbatim, whitespace/quote tolerant)              */
/* ------------------------------------------------------------------ */

/**
 * Locates a supporting passage inside the stored retrieved content and
 * returns its character offsets IN THE STORED CONTENT. Tolerates whitespace
 * and smart-quote differences; everything else must match verbatim — a
 * paraphrase is NOT evidence.
 */
export function locatePassage(passage: string, content: string): { start: number; end: number } | null {
  const p = passage.trim();
  if (p.length < 8 || !content) return null;
  const esc = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokens = p.split(/\s+/).map(esc);
  if (tokens.length === 0) return null;
  const pattern = tokens.join("[\\s\\u00A0]+")
    .replace(/\\"/g, '[“”"]') // tolerate smart/straight quote variants
    .replace(/\\'/g, "[‘’']");
  let re: RegExp;
  try { re = new RegExp(pattern, "i"); } catch { return null; }
  const m = re.exec(content);
  if (m) return { start: m.index, end: m.index + m[0].length };
  return null;
}

/* ------------------------------------------------------------------ */
/* Numeric consistency — figures must come from the source             */
/* ------------------------------------------------------------------ */

function numericTokens(text: string): string[] {
  return (text.match(/\d[\d,]*\.?\d*%?/g) ?? []).map((t) => t.replace(/,/g, "").replace(/%$/, ""));
}

/**
 * Every concrete figure in the claim must appear in the passage. A claim
 * saying "45 percent" supported by a passage saying "40 percent" is NOT
 * supported — the number is the fact, and it must come from the source.
 */
export function claimNumbersSupported(claim: string, passage: string): { ok: boolean; missing: string[] } {
  const needed = numericTokens(claim);
  const have = new Set(numericTokens(passage));
  const missing = needed.filter((t) => !have.has(t));
  return { ok: missing.length === 0, missing };
}

/* ------------------------------------------------------------------ */
/* Authority (deterministic, reusing the domain heuristics)            */
/* ------------------------------------------------------------------ */

const JOURNAL_DOMAINS = /(jstor|doi\.org|pubmed|ncbi|scholar|springer|sciencedirect|nature\.com|oup\.com|cambridge\.org|wiley|elsevier|lancet|bmj\.com|nejm\.org|plos\.org)/;

/** Authority 1–9, deterministic from the source record. Never a vibe. */
export function authorityScore(source: Pick<SourceForClaims, "domain" | "doi">): number {
  const domain = (source.domain ?? "").toLowerCase().replace(/^www\./, "");
  if (source.doi || JOURNAL_DOMAINS.test(domain)) return 9;
  if (/\.gov$/.test(domain)) return 8;
  if (/\.edu$|\.ac\.[a-z]{2}$/.test(domain)) return 7;
  if (/(wikipedia\.org|britannica\.com)/.test(domain)) return 4;
  if (domain.endsWith(".org") || domain.endsWith(".edu.*")) return 5;
  if (domain) return 3;
  return 1;
}

/**
 * Does the source satisfy the assignment's authority requirement
 * (research_spec.sourceType)? "any" always passes; "peer-reviewed" needs a
 * DOI or a known journal domain; "government" needs .gov; "university"
 * needs .edu. Honest: it returns a reason, never a silent pass.
 */
export function authorityVerdict(
  source: Pick<SourceForClaims, "domain" | "doi">,
  sourceType: string | null | undefined
): { ok: boolean; reason: string } {
  const st = (sourceType ?? "").toLowerCase();
  const domain = (source.domain ?? "").toLowerCase().replace(/^www\./, "");
  if (!st || st === "any" || st === "any reputable") {
    return { ok: true, reason: "No specific source-type requirement." };
  }
  if (/peer[- ]?review|journal|scholarly|academic source/.test(st)) {
    if (source.doi || JOURNAL_DOMAINS.test(domain)) return { ok: true, reason: "Peer-reviewed: DOI or recognized journal domain." };
    return { ok: false, reason: `Requirement is peer-reviewed, but "${domain || "this source"}" has no DOI and is not a recognized journal domain.` };
  }
  if (/government|gov\b/.test(st)) {
    if (/\.gov$/.test(domain)) return { ok: true, reason: "Government (.gov) source." };
    return { ok: false, reason: `Requirement is a government source, but "${domain || "this source"}" is not .gov.` };
  }
  if (/university|edu\b/.test(st)) {
    if (/\.edu$|\.ac\.[a-z]{2}$/.test(domain)) return { ok: true, reason: "University (.edu) source." };
    return { ok: false, reason: `Requirement is a university source, but "${domain || "this source"}" is not .edu.` };
  }
  return { ok: true, reason: "Source-type requirement not recognized as a hard filter; recorded honestly." };
}

/* ------------------------------------------------------------------ */
/* Claim → source verification (the heart of the requirement)           */
/* ------------------------------------------------------------------ */

export interface ClaimCheck {
  status: ClaimStatus;
  confidence: number;
  evidence_start: number | null;
  evidence_end: number | null;
  reasons: string[];
}

const SUPPORT_WORDCOUNT = (claim: string) => (claim.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).length;

function overlapRatio(claim: string, passage: string): number {
  const stop = new Set(["the", "a", "an", "of", "and", "or", "in", "on", "to", "is", "are", "was", "were", "be", "been", "that", "this", "for", "with", "as", "by", "it", "its", "their", "they", "have", "has", "had", "not", "but", "from", "at", "which", "who", "than", "then", "so", "such", "can", "may", "might", "will", "would", "should", "could", "more", "most", "some", "any", "all", "no"]);
  const words = (s: string) => new Set((s.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((w) => !stop.has(w)));
  const c = words(claim);
  const p = words(passage);
  if (c.size === 0) return 0;
  let hits = 0;
  c.forEach((w) => { if (p.has(w)) hits++; });
  return hits / c.size;
}

/**
 * Verifies ONE claim against ONE source. A claim is VERIFIED only when the
 * retrieved content actually supports it:
 *   1. the source's content must be available (dead/inaccessible → UNVERIFIED,
 *      never guessed);
 *   2. a supporting passage must be supplied and located VERBATIM in the
 *      stored content (paraphrased/fabricated evidence → UNSUPPORTED);
 *   3. every figure in the claim must appear in the passage;
 *   4. the claim must overlap the passage substantively.
 */
export function verifyClaimAgainstSource(
  claim: string,
  passage: string,
  source: Pick<SourceForClaims, "content" | "verification_status" | "id">
): ClaimCheck {
  const content = String(source.content ?? "");
  const srcStatus = source.verification_status ?? "unverified";

  // 1. Source content must be available — a claim about a dead source can
  //    never be verified, and we never invent the content.
  if (srcStatus === "failed" || srcStatus === "inaccessible" || content.trim().length === 0) {
    return {
      status: "unverified",
      confidence: 0,
      evidence_start: null,
      evidence_end: null,
      reasons: ["The source content is not available (dead or inaccessible) — marked unverified, never guessed."],
    };
  }

  // 2. A supporting passage must exist and be locatable verbatim.
  const p = (passage ?? "").trim();
  if (p.length < 8) {
    return {
      status: "unverified",
      confidence: 0,
      evidence_start: null,
      evidence_end: null,
      reasons: ["No supporting passage was supplied for this claim — cannot verify; the system will not guess evidence."],
    };
  }
  const loc = locatePassage(p, content);
  if (!loc) {
    return {
      status: "unsupported",
      confidence: 0,
      evidence_start: null,
      evidence_end: null,
      reasons: ["The cited supporting passage does not appear verbatim in the retrieved content of this source — paraphrased or fabricated evidence is rejected."],
    };
  }

  // 3. Figures must come from the passage.
  const nums = claimNumbersSupported(claim, p);
  if (!nums.ok) {
    return {
      status: "unsupported",
      confidence: 0,
      evidence_start: loc.start,
      evidence_end: loc.end,
      reasons: [`The claim states figure(s) (${nums.missing.join(", ")}) that are not present in the cited passage — the number is the fact, and it must come from the source.`],
    };
  }

  // 4. Substantive overlap between claim and passage.
  const r = overlapRatio(claim, p);
  const words = SUPPORT_WORDCOUNT(claim);
  const full = claimSupportsDeterministic(claim, p);
  if (full) {
    return {
      status: "verified",
      confidence: Math.min(0.95, Math.round((0.6 + 0.35 * r) * 100) / 100),
      evidence_start: loc.start,
      evidence_end: loc.end,
      reasons: ["Supporting passage located verbatim in the retrieved content; claim figures and wording are supported by it."],
    };
  }
  if (r >= 0.3 && words >= 2) {
    return {
      status: "partially_supported",
      confidence: Math.min(0.6, Math.round((0.3 + 0.5 * r) * 100) / 100),
      evidence_start: loc.start,
      evidence_end: loc.end,
      reasons: ["The passage overlaps the claim only partially — the claim must be revised or a closer source found."],
    };
  }
  return {
    status: "unsupported",
    confidence: 0,
    evidence_start: loc.start,
    evidence_end: loc.end,
    reasons: ["The retrieved content of this source does not substantively support the claim."],
  };
}

const RANK: Record<ClaimStatus, number> = { unverified: 0, unsupported: 1, partially_supported: 2, verified: 3 };

/**
 * Verifies every candidate against every cited source and produces the full
 * trace rows (one row per claim × cited source). A claim backed by multiple
 * sources gets multiple rows; the claim-level status is the BEST row status,
 * but every attempted pairing is recorded for traceability.
 */
export function verifyClaims(
  candidates: ClaimCandidate[],
  sources: SourceForClaims[],
  opts: { assignment_id: string | null; now: string }
): ClaimEvidenceRecord[] {
  const byLabel = new Map<string, SourceForClaims>();
  sources.forEach((s, i) => byLabel.set(`S${i + 1}`, s));
  const rows: ClaimEvidenceRecord[] = [];
  for (const c of candidates) {
    // Without a supporting passage no source can be checked, so exactly one
    // trace row is emitted (against the first cited source) — the claim is
    // UNVERIFIED, never guessed, and no fan-out of identical rows is kept.
    const labels = c.supporting_passage.trim().length >= 8 ? c.source_labels : [c.source_labels[0]];
    for (const label of labels) {
      const src = byLabel.get(label);
      if (!src) continue;
      const check = verifyClaimAgainstSource(c.claim_text, c.supporting_passage, src);
      rows.push({
        claim_id: c.claim_id,
        assignment_id: opts.assignment_id,
        claim_text: c.claim_text,
        source_id: src.id,
        source_url: src.url,
        source_title: src.title,
        exact_supporting_passage: c.supporting_passage,
        evidence_start: check.evidence_start,
        evidence_end: check.evidence_end,
        verification_status: check.status,
        confidence: check.confidence,
        authority_score: authorityScore(src),
        verified_at: opts.now,
        reasons: check.reasons,
      });
    }
  }
  return rows;
}

/** Best status across all evidence rows for one claim. */
export function claimLevelStatus(rows: Pick<ClaimEvidenceRecord, "claim_id" | "verification_status">[]): Map<string, ClaimStatus> {
  const best = new Map<string, ClaimStatus>();
  for (const r of rows) {
    const cur = best.get(r.claim_id) ?? "unverified";
    if (RANK[r.verification_status] > RANK[cur]) best.set(r.claim_id, r.verification_status);
    else if (!best.has(r.claim_id)) best.set(r.claim_id, r.verification_status);
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Research integrity report                                           */
/* ------------------------------------------------------------------ */

const ACTION_REVISE = "Claim must be revised or source replaced.";

function reasonForStatus(status: ClaimStatus, reasons: string[]): string {
  const specific = reasons[0] ?? "";
  switch (status) {
    case "unsupported": return specific || "Cited source does not support the claim.";
    case "partially_supported": return specific || "Claim is only partially supported by the cited source.";
    case "unverified": return specific || "Claim could not be verified against the source content.";
    default: return "";
  }
}

/**
 * Builds the final Research Integrity report:
 *   counts of supported claims / resolving URLs / matching titles /
 *   authority-satisfying sources, the explicit failure list (claim id,
 * reason, action), and research_complete — which is TRUE only when every
 * factual claim is supported, every cited URL resolves, every title
 * matches, and every source satisfies the assignment's authority
 * requirement. The essay generator is blocked from declaring research
 * complete whenever this is false.
 */
export function buildIntegrityReport(
  rows: ClaimEvidenceRecord[],
  input: IntegrityReportInput
): IntegrityReport {
  const statuses = claimLevelStatus(rows);
  const claims_total = statuses.size;
  let supported = 0, partial = 0, unsupported = 0, unverified = 0;
  const failures: IntegrityFailure[] = [];
  statuses.forEach((status, claimId) => {
    if (status === "verified") supported++;
    else if (status === "partially_supported") {
      partial++;
      const row = rows.find((r) => r.claim_id === claimId);
      failures.push({ claim_id: claimId, claim_text: row?.claim_text ?? "", reason: reasonForStatus(status, row?.reasons ?? []), action: ACTION_REVISE });
    } else if (status === "unsupported") {
      unsupported++;
      const row = rows.find((r) => r.claim_id === claimId);
      failures.push({ claim_id: claimId, claim_text: row?.claim_text ?? "", reason: reasonForStatus(status, row?.reasons ?? []), action: ACTION_REVISE });
    } else {
      unverified++;
      const row = rows.find((r) => r.claim_id === claimId);
      failures.push({ claim_id: claimId, claim_text: row?.claim_text ?? "", reason: reasonForStatus(status, row?.reasons ?? []), action: "Claim must be revised, source replaced, or the source re-verified — it cannot stand as verified." });
    }
  });

  // Per-source checks for every CITED source (any source a claim points at).
  const citedIds = new Set(rows.map((r) => r.source_id));
  let urls_total = 0, urls_resolve = 0, titles_total = 0, titles_match = 0, authority_total = 0, authority_satisfied = 0;
  for (const id of Array.from(citedIds)) {
    urls_total++;
    if (input.url_resolves[id]) urls_resolve++;
    titles_total++;
    if (input.title_match[id]) titles_match++;
    authority_total++;
    const row = rows.find((r) => r.source_id === id);
    if (input.url_resolves[id] !== true) {
      failures.push({
        claim_id: "",
        claim_text: `Source: ${row?.source_title ?? id}`,
        reason: "The source URL did not resolve at verification time.",
        action: "Replace the source with a live one — a claim cannot stand on a dead source.",
      });
    } else if (input.title_match[id] !== true) {
      failures.push({
        claim_id: "",
        claim_text: `Source: ${row?.source_title ?? id}`,
        reason: "The page title does not correspond to the title the search provider listed.",
        action: "Confirm the correct source was cited; replace it if it is a mismatch.",
      });
    }
    if (input.authority_ok[id]) authority_satisfied++;
    else {
      failures.push({
        claim_id: "",
        claim_text: `Source: ${row?.source_title ?? id}`,
        reason: "This source does not satisfy the assignment's authority requirement.",
        action: "Replace with a source that satisfies the assignment's source-type requirement.",
      });
    }
  }

  const research_complete =
    claims_total > 0 &&
    failures.length === 0 &&
    urls_resolve === urls_total &&
    titles_match === titles_total &&
    authority_satisfied === authority_total;

  return {
    claims_total, claims_supported: supported, claims_partially_supported: partial,
    claims_unsupported: unsupported, claims_unverified: unverified,
    urls_total, urls_resolve, titles_total, titles_match,
    authority_total, authority_satisfied, authority_required: input.authority_required,
    research_complete, failures,
  };
}

/** Human-readable form of the report (the "Research Integrity" block). */
export function formatIntegrityReport(report: IntegrityReport): string {
  const lines = [
    "Research Integrity",
    `${report.claims_supported}/${report.claims_total} factual claims supported`,
    `${report.urls_resolve}/${report.urls_total} URLs resolve`,
    `${report.titles_match}/${report.titles_total} titles match`,
    `${report.authority_satisfied}/${report.authority_total} sources satisfy assignment authority requirements`,
  ];
  if (report.failures.length > 0) {
    lines.push("", "FAILED:");
    for (const f of report.failures) {
      lines.push(f.claim_id ? `Claim ${f.claim_id}` : f.claim_text);
      lines.push(`Reason: ${f.reason}`);
      lines.push(`Action: ${f.action}`);
    }
  }
  return lines.join("\n");
}
