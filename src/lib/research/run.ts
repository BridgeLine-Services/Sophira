import type { SupabaseClient } from "@supabase/supabase-js";
import { getSearchProvider } from "./provider";
import { fetchAndVerify, titlesCorrespond } from "./verify";
import { dedupeSources, rankCandidates } from "./research";
import { rankCandidatesForAssignment } from "./authority";
import { parseISODateLoose } from "./citation";

/**
 * SHARED RESEARCH EXECUTION CORE (resumable research round, 2026-10-11).
 *
 * Both the fresh run (POST /api/research) and the resume
 * (POST /api/research/resume) execute THIS function — one execution path,
 * never two divergent backends. RESUME SEMANTICS: a pass is resumable at
 * the persistence layer — queries are re-searched for real (nothing is
 * cached client-side), but sources ALREADY STORED for the project are
 * never duplicated or re-verified: progress = stored sources.
 *
 * RESUMABLE GATE (isResumable): only 'failed' projects, or 'searching'
 * projects whose last update is older than RESUME_STALE_MS (a run that
 * died mid-request), may resume. A project updated moments ago is treated
 * as a live run and refused — no concurrent double-passes.
 *
 * This is server-persisted resumability, not background processing: the
 * pass runs while the student waits, and an interruption at ANY point
 * leaves state that a later resume completes without loss or duplication.
 */

export const RESUME_STALE_MS = 5 * 60 * 1000;

export interface ResearchRunSpec {
  topic: string;
  question: string | null;
  academicLevel: string | null;
  sourceType: string | null;
  minSources: number;
  dateRange: string | null;
  citationStyle: string | null;
  teacherRequirements: string | null;
}

export interface StoredSourceResult {
  source_id: string | null;
  title: string;
  url: string;
  status: string;
  http_status: number | null;
  redirect_count: number;
  title_match: boolean;
  content_chars: number;
  author: string | null;
  publication_date: string | null;
  notes: string[];
  authority: Record<string, unknown>;
}

export interface ResearchPassResult {
  stored: StoredSourceResult[];
  searchFailures: string[];
}

/** May this project be resumed right now? (pure, testable) */
export function isResumable(
  status: string,
  updatedAt: string | null | undefined,
  nowMs: number = Date.now(),
): { ok: boolean; reason?: string } {
  if (status === "failed") return { ok: true };
  if (status === "searching") {
    if (!updatedAt) return { ok: false, reason: "Unknown progress timestamp — cannot tell whether a run is still active." };
    const updated = Date.parse(updatedAt);
    if (Number.isNaN(updated)) return { ok: false, reason: "Invalid progress timestamp." };
    if (nowMs - updated < RESUME_STALE_MS) {
      return { ok: false, reason: "A run for this project may still be in progress — try again in a few minutes." };
    }
    return { ok: true };
  }
  return { ok: false, reason: `A project with status '${status}' cannot be resumed — start a new one instead.` };
}

/**
 * Search the project's queries for real and verify every NEW candidate.
 * queryRows are the project's existing research_queries rows
 * ({ id, query }) — created fresh by POST, loaded from storage on resume.
 */
export async function executeResearchPass(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  spec: ResearchRunSpec,
  queryRows: { id: string; query: string }[],
  maxCandidates: number,
): Promise<ResearchPassResult> {
  const provider = getSearchProvider();

  // Sources already stored for this project — resume never duplicates them.
  const { data: existing } = await supabase
    .from("research_sources")
    .select("original_url, canonical_url")
    .eq("project_id", projectId);
  const knownUrls = new Set<string>();
  for (const r of (existing ?? []) as { original_url: string | null; canonical_url: string | null }[]) {
    if (r.original_url) knownUrls.add(r.original_url);
    if (r.canonical_url) knownUrls.add(r.canonical_url);
  }

  const allHits: Awaited<ReturnType<typeof provider.search>> = [];
  const searchFailures: string[] = [];
  for (const q of queryRows) {
    try {
      const hits = await provider.search(q.query, { maxResults: 6 });
      for (const h of hits) allHits.push(h);
      await supabase.from("research_queries").update({ status: "ok" }).eq("id", q.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "search failed";
      searchFailures.push(`${q.query}: ${msg}`);
      await supabase.from("research_queries").update({ status: "failed" }).eq("id", q.id);
    }
  }

  const ranked = rankCandidatesForAssignment(
    dedupeSources(allHits.filter((h) => !knownUrls.has(h.url))),
    spec,
  );
  const candidates = ranked.slice(0, maxCandidates);

  const stored: StoredSourceResult[] = [];
  for (const { hit, decision } of candidates) {
    const v = await fetchAndVerify(hit.url);
    const titleMatch = titlesCorrespond(hit.title, v.title || hit.title);
    let status = v.status;
    const notes = [...v.notes];
    if (status === "verified" && !titleMatch) {
      status = "partially_verified";
      notes.push("Search-listed title does not clearly correspond to the page title — metadata mismatch flagged.");
    }
    if (status === "verified" && titleMatch) {
      notes.push("URL resolves, page is live and meaningful, listed title matches the page.");
    }

    const { data: row } = await supabase
      .from("research_sources")
      .insert({
        user_id: userId,
        project_id: projectId,
        original_url: hit.url,
        final_url: v.finalUrl,
        canonical_url: v.canonicalUrl,
        domain: v.domain,
        title: v.title || hit.title,
        listed_title: hit.title,
        author: v.author,
        publisher: v.domain,
        publication_date: parseISODateLoose(v.publicationDate),
        source_type: "web",
        doi: null,
        http_status: v.httpStatus,
        redirect_count: v.redirectCount,
        verification_status: status,
        verification_notes: notes.join(" ") || "No notes.",
        content_extract: v.text.slice(0, 60_000),
        content_chars: v.textChars,
        integrity_hash: v.hash,
        approval: "pending",
        authority_category: decision.category,
        authority_decision: decision,
      })
      .select("id")
      .single();

    if (row) {
      await supabase.from("research_verifications").insert({
        user_id: userId,
        source_id: row.id,
        checked_at: new Date().toISOString(),
        http_status: v.httpStatus,
        final_url: v.finalUrl,
        reachable: v.ok && v.textChars > 0,
        content_chars: v.textChars,
        title_match: titleMatch,
        notes: notes.join(" "),
        status,
      });
    }

    stored.push({
      source_id: row?.id ?? null,
      title: v.title || hit.title,
      url: v.finalUrl || hit.url,
      status,
      http_status: v.httpStatus,
      redirect_count: v.redirectCount,
      title_match: titleMatch,
      content_chars: v.textChars,
      author: v.author,
      publication_date: parseISODateLoose(v.publicationDate),
      notes,
      authority: {
        category: decision.category,
        tier: decision.tier,
        tier_name: decision.tier_name,
        teacher_required: decision.teacher_required,
        primary_source: decision.primary_source,
        peer_reviewed: decision.peer_reviewed,
        reasons: decision.reasons,
      },
    });
  }

  return { stored, searchFailures };
}
