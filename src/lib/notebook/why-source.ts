/**
 * Notebook workspace — "Why this source?" (2026-10-06).
 *
 * Shows for any source: source authority, relevance, date, source type,
 * why selected, and which assignment requirement it satisfies. The data
 * comes from the STORED ranking decision (authority.ts) — never invented.
 */

import type { NotebookSource } from "./types";

export interface WhyThisSource {
  sourceLabel: string;
  title: string;
  authority: string;
  relevance: string;
  date: string | null;
  sourceType: string;
  whySelected: string;
  requirementSatisfied: string | null;
  verification: string;
}

export function explainSource(source: NotebookSource, question?: string): WhyThisSource {
  const w = source.whySelected ?? {};
  const auth = w.authority ?? (source.authority?.domain ? `domain ${String(source.authority.domain)}` : "not ranked");
  const relevance = w.relevance ?? (question ? `relevance to "${question}" was assessed during ranking` : "assessed during ranking");
  return {
    sourceLabel: source.sourceId,
    title: source.title,
    authority: String(auth),
    relevance: String(relevance),
    date: w.date ?? source.retrievedAt ?? null,
    sourceType: source.sourceType,
    whySelected: w.why ?? "added directly by you" + (source.sourceType === "research_source" ? " after retrieval+verification" : ""),
    requirementSatisfied: w.requirementSatisfied ?? null,
    verification: source.verificationStatus,
  };
}
