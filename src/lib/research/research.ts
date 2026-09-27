/**
 * Research workflow helpers (spec §14): assignment-aware query generation,
 * deduplication, and objective candidate ranking (spec §10 — no
 * ideological filtering; domain quality is a documented heuristic).
 */

import type { SearchHit } from "./provider";

export interface ResearchSpecInput {
  topic: string;
  question?: string | null;
  thesis?: string | null;
  academicLevel?: string | null;
  course?: string | null;
  sourceType?: string | null;
  minSources?: number | null;
  dateRange?: string | null;
  citationStyle?: string | null;
  teacherRequirements?: string | null;
}

export interface GeneratedQuery {
  query: string;
  rationale: string;
}

/** Focused, assignment-specific search queries — deterministic templates. */
export function generateQueries(spec: ResearchSpecInput, max = 3): GeneratedQuery[] {
  const topic = spec.topic.trim();
  const out: GeneratedQuery[] = [];
  const angle = spec.question ? ` ${spec.question.trim().slice(0, 80)}` : "";

  const domainHint =
    /peer[- ]?review|journal|scholarly|academic source/i.test(spec.sourceType ?? "")
      ? " study journal"
      : /government|gov\b/i.test(spec.sourceType ?? "")
        ? " site:.gov"
        : /university|edu\b/i.test(spec.sourceType ?? "")
          ? " site:.edu"
          : "";

  out.push({ query: `${topic}${domainHint}${angle}`, rationale: "core topic" });
  if (spec.academicLevel) {
    out.push({ query: `${topic} ${spec.academicLevel} explanation analysis`, rationale: "academic-level framing" });
  } else {
    out.push({ query: `${topic} analysis research`, rationale: "analysis angle" });
  }
  out.push({ query: `${topic} evidence data statistics${domainHint}`, rationale: "evidence/statistics angle" });
  if (spec.dateRange === "recent" || spec.dateRange === "last-5-years") {
    out.push({ query: `${topic} 2024 2025 recent developments`, rationale: "recency requirement" });
  }
  if (spec.thesis) {
    out.push({ query: `${spec.thesis.trim().slice(0, 100)} ${topic} evidence`, rationale: "thesis support" });
  }
  return out.slice(0, max);
}

/** Normalize a URL for dedup: strip tracking params, fragment, trailing slash. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    const keys: string[] = [];
    u.searchParams.forEach((_v, k) => keys.push(k));
    for (const key of keys) {
      if (/^(utm_|fbclid|gclid|ref_?)/i.test(key) || key === "ref" || key === "mc_cid" || key === "mc_eid") {
        u.searchParams.delete(key);
      }
    }
    let s = u.toString();
    if (s.endsWith("/") && !u.search) s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

/**
 * Dedupe by canonical-ish URL, then cap duplicates per domain so one site
 * cannot crowd out the rest.
 */
export function dedupeSources(hits: SearchHit[], maxPerDomain = 2): SearchHit[] {
  const seen = new Set<string>();
  const domainCount = new Map<string, number>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    const key = normalizeUrl(h.url);
    if (seen.has(key)) continue;
    let domain = "";
    try { domain = new URL(h.url).hostname.replace(/^www\./, ""); } catch { continue; }
    const count = domainCount.get(domain) ?? 0;
    if (count >= maxPerDomain) continue;
    seen.add(key);
    domainCount.set(domain, count + 1);
    out.push(h);
  }
  return out;
}

/**
 * Objective candidate priority (spec §10): primary/official sources first
 * (gov/edu/peer-reviewed domains), no ideological filtering. Also strips
 * obviously unusable hits.
 */
export function rankCandidates(hits: SearchHit[]): SearchHit[] {
  const score = (h: SearchHit): number => {
    let s = 0;
    let domain = "";
    try { domain = new URL(h.url).hostname.replace(/^www\./, ""); } catch { return -1; }
    if (h.url.startsWith("http://")) s -= 5;
    if (/\.gov$|\.edu$|\.ac\.[a-z]{2}$/.test(domain)) s += 3;
    if (/(jstor|doi\.org|pubmed|ncbi|scholar|springer|sciencedirect|nature\.com|oup\.com|cambridge\.org|wiley)/.test(domain)) s += 3;
    if (/(wikipedia\.org|britannica\.com)/.test(domain)) s -= 1; // encyclopedic: usable but not primary
    if (h.title && h.snippet) s += 1;
    if (!h.url.startsWith("http")) return -10;
    return s;
  };
  return hits
    .filter((h) => score(h) > -4) // plain http + no other merit is filtered out
    .sort((a, b) => score(b) - score(a));
}
