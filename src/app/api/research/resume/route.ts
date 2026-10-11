import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { searchProviderConfigured } from "@/lib/research/provider";
import { executeResearchPass, isResumable, type ResearchRunSpec } from "@/lib/research/run";

export const runtime = "nodejs";
export const maxDuration = 240;

/**
 * RESUMABLE RESEARCH (2026-10-11): a run that died mid-request (browser
 * closed, network drop, deploy restart) leaves the project 'searching'
 * forever; a 'failed' project may become retryable once the operator
 * configures a search provider. POST { project_id } resumes such a
 * project through the SAME execution core as a fresh run:
 *   - queries are re-searched for real (nothing fabricated),
 *   - sources ALREADY STORED for the project are never duplicated or
 *     re-verified (progress = stored sources),
 *   - only NEW candidates are fetched, verified, and persisted.
 *
 * Guard rails (isResumable): only 'failed' projects, or 'searching'
 * projects stale for >= RESUME_STALE_MS, may resume — a project updated
 * moments ago is treated as a LIVE run and refused, so there are no
 * concurrent double-passes. This is server-persisted resumability, not
 * background processing: the pass runs while the student waits.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  let body: { project_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const projectId = (body.project_id || "").trim();
  if (!projectId) return NextResponse.json({ error: "Missing project id." }, { status: 400 });

  // RLS scopes this to the user's own project.
  const { data: project } = await supabase
    .from("research_projects")
    .select("id, status, failure_reason, updated_at, research_spec")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Research project not found." }, { status: 404 });

  const gate = isResumable(project.status, project.updated_at);
  if (!gate.ok) return NextResponse.json({ error: gate.reason ?? "Not resumable." }, { status: 409 });

  if (!searchProviderConfigured()) {
    const reason =
      "No search provider is configured on the server. Set SEARCH_PROVIDER and SEARCH_API_KEY (server-side environment variables) — Sophira will not invent sources.";
    await supabase.from("research_projects").update({
      status: "failed", failure_reason: reason, updated_at: new Date().toISOString(),
    }).eq("id", projectId);
    return NextResponse.json({ error: reason }, { status: 503 });
  }

  const specRow = (project.research_spec ?? {}) as Record<string, unknown>;
  const spec: ResearchRunSpec = {
    topic: String(specRow.topic ?? ""),
    question: (specRow.question as string | null) ?? null,
    academicLevel: (specRow.academicLevel as string | null) ?? null,
    sourceType: (specRow.sourceType as string | null) ?? null,
    minSources: Math.min(Math.max(Number(specRow.minSources) || 4, 1), 10),
    dateRange: (specRow.dateRange as string | null) ?? null,
    citationStyle: (specRow.citationStyle as string | null) ?? null,
    teacherRequirements: (specRow.teacherRequirements as string | null) ?? null,
  };
  if (!spec.topic) {
    return NextResponse.json({ error: "The stored research spec is missing its topic — start a new project instead." }, { status: 409 });
  }

  // Existing query rows (created with the project); resume re-searches them.
  const { data: queryRowsRaw } = await supabase
    .from("research_queries")
    .select("id, query")
    .eq("project_id", projectId);
  const queryRows = (queryRowsRaw ?? []) as { id: string; query: string }[];
  if (queryRows.length === 0) {
    return NextResponse.json({ error: "This project has no stored queries — start a new project instead." }, { status: 409 });
  }

  // Mark the resumed run honestly before executing.
  await supabase.from("research_projects").update({
    status: "searching", updated_at: new Date().toISOString(),
  }).eq("id", projectId);

  const { stored, searchFailures } = await executeResearchPass(
    supabase, user.id, projectId, spec, queryRows, 8,
  );

  // Sources already present BEFORE this pass (resume must not lose them).
  // priorVerified drives the honest sufficiency check; priorTotal the display.
  const { count: priorTotal } = await supabase
    .from("research_sources")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  const { count: priorVerified } = await supabase
    .from("research_sources")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("verification_status", "verified");

  if (stored.length === 0 && (priorTotal ?? 0) === 0) {
    const reason = searchFailures.length
      ? `Resume found no usable sources: ${searchFailures.join("; ")}.`
      : "The search provider returned no usable results for this topic.";
    await supabase.from("research_projects").update({
      status: "failed", failure_reason: reason, updated_at: new Date().toISOString(),
    }).eq("id", projectId);
    return NextResponse.json({ data: { project_id: projectId, status: "failed", sources: [], resumed: true, warning: reason } });
  }

  const verifiedCount = stored.filter((s) => s.status === "verified").length;
  await supabase.from("research_projects").update({
    status: "verified", updated_at: new Date().toISOString(),
  }).eq("id", projectId);

  return NextResponse.json({
    data: {
      project_id: projectId,
      status: "verified",
      resumed: true,
      new_sources: stored.length,
      total_sources: stored.length + Math.max(priorTotal ?? 0, 0),
      search_failures: searchFailures,
      sources: stored,
      verified_count: verifiedCount,
      min_sources: spec.minSources,
      sources_sufficient: verifiedCount + Math.max(priorVerified ?? 0, 0) >= spec.minSources,
      warning:
        stored.length === 0
          ? `No NEW sources found — the ${priorTotal ?? 0} already-stored source(s) are kept. Review them or run a new project.`
          : null,
    },
  });
}
