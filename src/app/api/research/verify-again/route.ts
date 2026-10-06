import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { fetchAndVerify } from "@/lib/research/verify";
import { verifyAllSourcesAgain, researchCompletionLine, type RefetchResult } from "@/lib/research/citation-invariant";

export const runtime = "nodejs";
export const maxDuration = 240;

/**
 * "Verify all sources again" (2026-10-06 hardening) — run BEFORE final
 * submission:
 *   POST /api/research/verify-again { project_id }
 *
 * Re-fetches every approved source of the project with the REAL engine
 * (fetchAndVerify) and classifies each:
 *   VERIFIED    — still retrievable, content hash unchanged
 *   UNAVAILABLE — dead/unreachable now: its claims are DEMOTED
 *                 (verification_status → 'unverified'); never replaced by a guess
 *   STALE       — content changed since retrieval: claims DEMOTED the same way
 *   UNVERIFIED  — stored record was never really verifiable
 * Then claims citing demoted sources are demoted and the stored integrity
 * summary is recomputed so the FINAL GATE sees the truth.
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
  const projectId = body.project_id;
  if (!projectId) return NextResponse.json({ error: "Provide project_id." }, { status: 400 });

  const { data: project } = await supabase
    .from("research_projects")
    .select("id,user_id,research_integrity")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Research project not found." }, { status: 404 });

  const { data: sources } = await supabase
    .from("research_sources")
    .select("id,final_url,integrity_hash,original_url,verification_status")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .eq("approval", "approved")
    .limit(100);

  const rows = sources ?? [];
  const results: Record<string, RefetchResult> = await verifyAllSourcesAgain(
    rows.map((r) => ({
      sourceId: r.id,
      url: r.final_url || r.original_url,
      contentHash: r.integrity_hash ?? "",
    })),
    { fetchAndVerify }
  );

  // persist statuses + demote claims citing demoted sources
  const demotedSourceIds: string[] = [];
  for (const r of rows) {
    const verdict = results[r.id];
    if (!verdict) continue;
    const newStatus =
      verdict.status === "VERIFIED" ? "verified"
      : verdict.status === "UNAVAILABLE" ? "inaccessible"
      : "unverified"; // STALE + UNVERIFIED both demote to unverified
    if (verdict.status !== "VERIFIED") demotedSourceIds.push(r.id);
    await supabase
      .from("research_sources")
      .update({
        verification_status: newStatus,
        verification_notes: `re-verified ${new Date().toISOString()}: ${verdict.explanation}`,
      })
      .eq("id", r.id)
      .eq("user_id", user.id);
    await supabase
      .from("research_claims")
      .update({ verification_status: "unverified", reasons: { demoted_at: new Date().toISOString(), why: verdict.explanation } })
      .eq("source_url", r.final_url || r.original_url)
      .eq("user_id", user.id);
  }

  // recompute the stored integrity summary so the FINAL GATE sees the truth
  const { count: claimsTotal } = await supabase
    .from("research_claims")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", (project as unknown as { assignment_id?: string }).assignment_id ?? projectId)
    .eq("user_id", user.id);
  const { count: claimsSupported } = await supabase
    .from("research_claims")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", (project as unknown as { assignment_id?: string }).assignment_id ?? projectId)
    .eq("user_id", user.id)
    .eq("verification_status", "verified");

  const summary = {
    verified: Object.values(results).filter((r) => r.status === "VERIFIED").length,
    unverified: Object.values(results).filter((r) => r.status === "UNVERIFIED").length,
    unavailable: Object.values(results).filter((r) => r.status === "UNAVAILABLE").length,
    stale: Object.values(results).filter((r) => r.status === "STALE").length,
    total: rows.length,
    blockers: Object.values(results).filter((r) => r.status !== "VERIFIED").map((r) => r.explanation),
  };

  await supabase
    .from("research_projects")
    .update({
      research_integrity: {
        research_complete: summary.verified === summary.total && summary.total > 0,
        claims_supported: claimsSupported ?? 0,
        claims_total: claimsTotal ?? 0,
        urls_resolve: summary.verified,
        urls_total: summary.total,
        authority_satisfied: summary.verified,
        authority_total: summary.total,
        failures: Object.values(results).filter((r) => r.status !== "VERIFIED").map((r) => ({ claim_text: r.sourceId, reason: r.explanation })),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId)
    .eq("user_id", user.id);

  return NextResponse.json({
    results: Object.fromEntries(
      rows.map((r) => [r.final_url || r.original_url, results[r.id] ?? null])
    ),
    summary,
    completion: researchCompletionLine(summary),
    demotedSourceIds,
  });
}
