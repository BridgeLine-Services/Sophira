/**
 * CITATION INVARIANT ENGINE (2026-10-06 hardening round).
 *
 * THE FINAL INVARIANT: NO VERIFIED CITATION WITHOUT VERIFIED SOURCE.
 *
 * Every citation must pass ALL 12 steps before it can be VERIFIED:
 *   1. search result exists          7. content was extracted
 *   2. URL is syntactically valid    8. source title was extracted
 *   3. URL was actually requested    9. supporting passage exists
 *   4. redirect chain was followed  10. claim overlaps the passage
 *   5. final URL recorded           11. source meets authority requirements
 *   6. HTTP response succeeded      12. citation generated from stored metadata
 *
 * If ANY step fails → the citation is UNVERIFIED (or UNAVAILABLE / STALE,
 * see below) — and the final submission gate KNOWS. A failed source is
 * never replaced with a guessed one. This module COMPOSES the existing
 * research engine (provider.ts, research.ts, claims.ts, citation.ts,
 * authority.ts, verify.ts — all preserved) rather than replacing it.
 */

import { locatePassage } from "./claims";
import { formatCitation, type CitationSource } from "./citation";

/* ------------------------------------------------------------------ */
/* Statuses (shown in the UI, with explanations)                       */
/* ------------------------------------------------------------------ */

export type CitationStatus = "VERIFIED" | "UNVERIFIED" | "UNAVAILABLE" | "STALE";

export interface CitationStep {
  step: number;
  name: string;
  ok: boolean;
  /** what failed, in plain words — never a guess, never silent */
  detail: string;
}

export interface CitationEvidence {
  /* inputs — all from STORED records, never assumed */
  searchResultExisted: boolean;
  originalUrl: string;
  finalUrl: string;
  /** the fetch record from verify.ts fetchAndVerify (already includes
   *  redirect chain, http status, content, title, hash) */
  retrieval: {
    requested: boolean;          // step 3: the URL was actually requested
    redirectCount: number;        // step 4: chain followed and recorded
    httpOk: boolean;             // step 6
    contentChars: number;        // step 7
    title: string;               // step 8
    contentHash: string;
    notes: string[];
  } | null;
  passage: string | null;        // step 9
  claim: string | null;          // step 10
  authorityOk: boolean;          // step 11
  citationSource: CitationSource; // step 12 input: stored metadata
}

export interface CitationVerdict {
  status: CitationStatus;
  steps: CitationStep[];
  explanation: string;
  /** the formatted citation — only honest when VERIFIED */
  citation: string | null;
}

/* ------------------------------------------------------------------ */
/* The 12-step invariant                                               */
/* ------------------------------------------------------------------ */

export function checkUrlSyntax(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) && !/\s/.test(url);
  } catch {
    return false;
  }
}

export function verifyCitation(evidence: CitationEvidence): CitationVerdict {
  const steps: CitationStep[] = [];

  const add = (step: number, name: string, ok: boolean, detail: string) =>
    steps.push({ step, name, ok, detail: ok ? "ok" : detail });

  // 1. search result exists
  add(1, "Search result exists", evidence.searchResultExisted,
    "no search result backs this URL — it may have been invented");
  // 2. URL syntactically valid
  add(2, "URL is syntactically valid", checkUrlSyntax(evidence.originalUrl || ""),
    `URL "${evidence.originalUrl || "(empty)"}" is not a valid http(s) URL`);
  // 3. URL actually requested
  const r = evidence.retrieval;
  add(3, "URL was actually requested", r?.requested === true,
    "the URL was never requested — no retrieval record exists");
  // 4. redirect chain followed + 5. final URL recorded
  add(4, "Redirect chain followed", r != null && r.redirectCount >= 0 && !!r.contentHash,
    "no redirect-resolved fetch record exists");
  add(5, "Final URL recorded", !!evidence.finalUrl,
    "the final URL after redirects was not recorded");
  // 6. HTTP success
  add(6, "HTTP response succeeded", r?.httpOk === true,
    "the request failed (dead, blocked, or error status)");
  // 7. content extracted
  add(7, "Content was extracted", (r?.contentChars ?? 0) > 400,
    `no meaningful page content was extracted (${r?.contentChars ?? 0} chars)`);
  // 8. title extracted
  add(8, "Source title was extracted", !!r?.title?.trim(),
    "the page exposed no real title — a title must never be invented");
  // 9. supporting passage exists
  add(9, "Supporting passage exists", !!evidence.passage && evidence.passage.trim().length >= 12,
    "no supporting passage was stored");
  // 10. claim overlaps the passage
  const overlapOk = (() => {
    if (!evidence.claim || !evidence.passage) return false;
    const words = evidence.claim.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
    const low = evidence.passage.toLowerCase();
    return words.length > 0 && words.filter((w) => low.includes(w)).length >= Math.max(2, Math.ceil(words.length * 0.5));
  })();
  add(10, "Claim overlaps the supporting passage", overlapOk,
    "the claim is not supported by the stored passage (insufficient overlap)");
  // 11. authority requirements
  add(11, "Source meets authority requirements", evidence.authorityOk,
    "the source does not meet the authority requirements for the assignment");
  // 12. citation generated from stored metadata
  const citOk = (() => {
    try {
      return formatCitation(evidence.citationSource).length > 5 && !!evidence.citationSource.url;
    } catch {
      return false;
    }
  })();
  add(12, "Citation generated from stored metadata", citOk,
    "the citation could not be generated from stored source metadata");

  const failed = steps.filter((s) => !s.ok);
  const status: CitationStatus = failed.length === 0 ? "VERIFIED" : "UNVERIFIED";

  const explanation =
    status === "VERIFIED"
      ? "All 12 checks passed: this citation traces to a retrieved, verified, stored source."
      : `FAILED at step${failed[0].step === failed[failed.length - 1].step ? "" : "s"} ${failed.map((f) => f.step).join(", ")}: ${failed.map((f) => `${f.name} — ${f.detail}`).join("; ")}. The citation stays UNVERIFIED; the source is never replaced by a guess.`;

  return {
    status,
    steps,
    explanation,
    citation: status === "VERIFIED" ? formatCitation(evidence.citationSource) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Re-verification ("Verify all sources again" before submission)       */
/* ------------------------------------------------------------------ */

export interface StoredSource {
  sourceId: string;
  url: string;
  /** sha256 of the content as it was when the essay's claims were verified */
  contentHash: string;
}

export interface RefetchResult {
  sourceId: string;
  status: "VERIFIED" | "UNVERIFIED" | "UNAVAILABLE" | "STALE";
  explanation: string;
  newHash: string | null;
}

export interface RefetchDeps {
  /** real fetchAndVerify from verify.ts (injected for testability) */
  fetchAndVerify: (url: string, opts?: { fetchImpl?: typeof fetch; maxRedirects?: number; timeoutMs?: number; maxBytes?: number }) => Promise<{
    ok: boolean; finalUrl: string; text: string; textChars: number; hash: string; status: string; notes: string[];
  }>;
  fetchImpl?: typeof fetch;
}

/** Re-fetches a stored source to check it STILL says what it said.
 *  - unreachable/dead → UNAVAILABLE
 *  - content changed since claims were verified → STALE (claims demoted)
 *  - unchanged and readable → VERIFIED
 *  Never returns a guess; never silently accepts changed content. */
export async function refetchSource(source: StoredSource, deps: RefetchDeps): Promise<RefetchResult> {
  if (!checkUrlSyntax(source.url)) {
    return { sourceId: source.sourceId, status: "UNVERIFIED", explanation: "stored URL is syntactically invalid", newHash: null };
  }
  try {
    const page = await deps.fetchAndVerify(source.url, { fetchImpl: deps.fetchImpl });
    if (!page.ok || page.textChars < 400) {
      return {
        sourceId: source.sourceId,
        status: "UNAVAILABLE",
        explanation: `the source can no longer be retrieved (${page.status})${page.notes.length ? `: ${page.notes.join("; ")}` : ""} — its claims are demoted and the submission gate is informed`,
        newHash: null,
      };
    }
    if (page.hash !== source.contentHash) {
      return {
        sourceId: source.sourceId,
        status: "STALE",
        explanation: "the source content CHANGED since the claims were verified — the stored passages may no longer match; claims citing it are demoted until re-verification",
        newHash: page.hash,
      };
    }
    return {
      sourceId: source.sourceId,
      status: "VERIFIED",
      explanation: "re-retrieved; content hash matches the stored record exactly",
      newHash: page.hash,
    };
  } catch (e) {
    return {
      sourceId: source.sourceId,
      status: "UNAVAILABLE",
      explanation: `retrieval failed (${(e as Error).message}) — treated as unavailable, never guessed`,
      newHash: null,
    };
  }
}

/** Verify ALL sources again (the pre-submission action). */
export async function verifyAllSourcesAgain(
  sources: StoredSource[],
  deps: RefetchDeps
): Promise<Record<string, RefetchResult>> {
  const out: Record<string, RefetchResult> = {};
  for (const s of sources) {
    out[s.sourceId] = await refetchSource(s, deps);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Gate integration: the final submission gate MUST know                */
/* ------------------------------------------------------------------ */

export interface CitationGateSummary {
  verified: number;
  unverified: number;
  unavailable: number;
  stale: number;
  total: number;
  blockers: string[];
}

export function summarizeCitations(verdicts: { status: CitationStatus; explanation: string }[]): CitationGateSummary {
  const count = (st: CitationStatus) => verdicts.filter((v) => v.status === st).length;
  const blockers: string[] = [];
  for (const v of verdicts) {
    if (v.status === "UNVERIFIED") blockers.push(v.explanation);
    if (v.status === "UNAVAILABLE") blockers.push(v.explanation);
    if (v.status === "STALE") blockers.push(v.explanation);
  }
  return {
    verified: count("VERIFIED"),
    unverified: count("UNVERIFIED"),
    unavailable: count("UNAVAILABLE"),
    stale: count("STALE"),
    total: verdicts.length,
    blockers,
  };
}

/** Honest research-completion line: "Research complete" is FORBIDDEN when
 *  any cited source is UNVERIFIED, UNAVAILABLE, or STALE. */
export function researchCompletionLine(summary: CitationGateSummary): string {
  if (summary.total === 0) return "No citations checked yet — nothing is claimed as complete.";
  if (summary.unverified + summary.unavailable + summary.stale > 0) {
    const parts: string[] = [];
    if (summary.unverified) parts.push(`${summary.unverified} unverified`);
    if (summary.unavailable) parts.push(`${summary.unavailable} unavailable`);
    if (summary.stale) parts.push(`${summary.stale} stale`);
    return `RESEARCH INCOMPLETE: ${parts.join(", ")} of ${summary.total} citations. The submission gate is informed; nothing is replaced by guesses.`;
  }
  return `All ${summary.verified} citations verified against retrieved sources.`;
}
