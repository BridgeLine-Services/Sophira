import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { getSearchProvider, searchProviderConfigured, SearchNotConfiguredError } from "@/lib/research/provider";
import { fetchAndVerify, titlesCorrespond } from "@/lib/research/verify";
import { generateQueries, dedupeSources, rankCandidates } from "@/lib/research/research";
import { parseISODateLoose } from "@/lib/research/citation";

export const runtime = "nodejs";
export const maxDuration = 240;

/**
 * Verified web research (specs §7-§14) — server-side only:
 *   POST  /api/research  — run the workflow for a topic/assignment:
 *     generate assignment-specific queries → real external search →
 *     dedupe → rank objectively → FETCH AND VERIFY every candidate
 *     (redirects followed, final URL recorded, content + metadata
 *     extracted, dead/blocked/thin pages detected) → persist everything
 *     with honest verification statuses.
 *   GET   /api/research?project_id=…      — full project state.
 *   PATCH /api/research { source_id, action } — approve/reject sources.
 *
 * The search API key never leaves the server. Retrieved page content is
 * stored as untrusted data and is never executed or obeyed.
 */

const MAX_QUERIES = 3;
const MAX_CANDIDATES = 8;

interface ResearchBody {
  assignment_id?: string | null;
  topic?: string;
  question?: string | null;
  academic_level?: string | null;
  source_type?: string | null;
  min_sources?: number | null;
  date_range?: string | null;
  citation_style?: string | null;
  teacher_requirements?: string | null;
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  let body: ResearchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const topic = (body.topic || "").trim();
  if (topic.length < 3) {
    return NextResponse.json({ error: "Provide the research topic (what the essay needs sources for)." }, { status: 400 });
  }

  const spec = {
    topic,
    question: body.question ?? null,
    academicLevel: body.academic_level ?? null,
    sourceType: body.source_type ?? null,
    minSources: Math.min(Math.max(body.min_sources ?? 4, 1), 10),
    dateRange: body.date_range ?? null,
    citationStyle: body.citation_style ?? null,
    teacherRequirements: body.teacher_requirements ?? null,
  };

  const { data: project, error: pErr } = await supabase
    .from("research_projects")
    .insert({
      user_id: user.id,
      assignment_id: body.assignment_id || null,
      topic,
      research_spec: spec,
      status: "searching",
    })
    .select("id")
    .single();
  if (pErr || !project) {
    return NextResponse.json({ error: "Could not start the research project: " + (pErr?.message ?? "unknown") }, { status: 500 });
  }

  // 1. Assignment-specific queries.
  const queries = generateQueries(spec, MAX_QUERIES);
  const { data: queryRows } = await supabase
    .from("research_queries")
    .insert(queries.map((q) => ({ user_id: user.id, project_id: project.id, query: q.query, provider: searchProviderConfigured() ? (process.env.SEARCH_PROVIDER || "brave") : "", status: "pending" })))
    .select("id, query");
  const queryIdFor = new Map((queryRows ?? []).map((r) => [r.query, r.id]));

  // 2. Real external search — honestly reported when not configured.
  if (!searchProviderConfigured()) {
    await supabase.from("research_projects").update({
      status: "failed",
      failure_reason:
        "No search provider is configured on the server. Set SEARCH_PROVIDER and SEARCH_API_KEY (server-side environment variables) — Sophira will not invent sources.",
      updated_at: new Date().toISOString(),
    }).eq("id", project.id);
    return NextResponse.json({
      data: {
        project_id: project.id,
        status: "failed",
        queries: queries.map((q) => q.query),
        sources: [],
        warning:
          "Research did not run: no search provider is configured (SEARCH_PROVIDER / SEARCH_API_KEY). Sophira will not fabricate sources — configure a provider and retry.",
      },
    });
  }

  let provider: ReturnType<typeof getSearchProvider>;
  try {
    provider = getSearchProvider();
  } catch {
    return NextResponse.json({ error: "Search provider misconfigured on the server." }, { status: 503 });
  }

  const allHits: Awaited<ReturnType<typeof provider.search>> = [];
  const searchFailures: string[] = [];
  for (const q of queries) {
    try {
      const hits = await provider.search(q.query, { maxResults: 6 });
      for (const h of hits) allHits.push(h);
      await supabase.from("research_queries").update({ status: "ok" })
        .eq("id", queryIdFor.get(q.query) ?? "");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "search failed";
      searchFailures.push(`${q.query}: ${msg}`);
      await supabase.from("research_queries").update({ status: "failed" })
        .eq("id", queryIdFor.get(q.query) ?? "");
    }
  }

  const candidates = rankCandidates(dedupeSources(allHits)).slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) {
    const reason = searchFailures.length
      ? `All searches failed: ${searchFailures.join("; ")}.`
      : "The search provider returned no usable results for this topic.";
    await supabase.from("research_projects").update({
      status: "failed", failure_reason: reason, updated_at: new Date().toISOString(),
    }).eq("id", project.id);
    return NextResponse.json({ data: { project_id: project.id, status: "failed", sources: [], warning: reason } });
  }

  // 3. Verify each candidate — actually fetch it.
  const stored: Record<string, unknown>[] = [];
  for (const hit of candidates) {
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
        user_id: user.id,
        project_id: project.id,
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
      })
      .select("id")
      .single();

    // Verification log — a logging failure never corrupts the research.
    if (row) {
      await supabase.from("research_verifications").insert({
        user_id: user.id,
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
      source_id: row?.id,
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
    });
  }

  const verifiedCount = stored.filter((s) => s.status === "verified").length;
  await supabase.from("research_projects").update({
    status: "verified",
    updated_at: new Date().toISOString(),
  }).eq("id", project.id);

  return NextResponse.json({
    data: {
      project_id: project.id,
      status: "verified",
      queries: queries.map((q) => q.query),
      search_failures: searchFailures,
      sources: stored,
      verified_count: verifiedCount,
      min_sources: spec.minSources,
      sources_sufficient: verifiedCount >= spec.minSources,
      warning: verifiedCount < spec.minSources
        ? `Only ${verifiedCount} of ${spec.minSources} needed sources verified. Sophira will not fabricate the rest — review the sources, retry, or continue with fewer sources knowingly.`
        : null,
    },
  });
}

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "Missing project id." }, { status: 400 });

  const { data: project } = await supabase.from("research_projects").select("*").eq("id", projectId).maybeSingle();
  if (!project) return NextResponse.json({ error: "Research project not found." }, { status: 404 });

  const { data: queries } = await supabase.from("research_queries")
    .select("id, query, status, created_at").eq("project_id", projectId);
  const { data: sources } = await supabase.from("research_sources")
    .select("id, original_url, final_url, canonical_url, domain, title, author, publisher, publication_date, retrieval_date, source_type, http_status, redirect_count, verification_status, verification_notes, approval, content_chars")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  const { data: claims } = await supabase.from("research_claims")
    .select("id, claim, source_id, evidence, quote, status, response_id").eq("project_id", projectId);

  return NextResponse.json({ data: { project, queries: queries ?? [], sources: sources ?? [], claims: claims ?? [] } });
}

export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  let body: { source_id?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const id = (body.source_id || "").trim();
  const action = body.action || "";
  if (!id) return NextResponse.json({ error: "Missing source id." }, { status: 400 });

  // RLS scopes this update to the requesting user's own sources.
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Use approve or reject." }, { status: 400 });
  }
  const { data: updated, error } = await supabase
    .from("research_sources")
    .update({ approval: action })
    .eq("id", id)
    .select("id, approval")
    .single();
  if (error || !updated) return NextResponse.json({ error: "Source not found." }, { status: 404 });
  return NextResponse.json({ data: { source_id: updated.id, approval: updated.approval } });
}
