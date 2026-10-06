import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { researchTopic, approvedCandidateToSource } from "@/lib/notebook/research-topic";
import { getSearchProvider, SearchNotConfiguredError, searchProviderConfigured } from "@/lib/research/provider";
import { rankCandidatesForAssignment } from "@/lib/research/authority";
import type { ResearchCandidate } from "@/lib/notebook/types";

export const runtime = "nodejs";
export const maxDuration = 240;

/**
 * "Research this topic" (2026-10-06) — builds on the EXISTING research
 * engine (never replaces it):
 *   POST { topic }                      — runs the 10-step pipeline, returns
 *                                        VERIFIED CANDIDATES for approval
 *                                        (nothing is added until approved)
 *   POST { approve: [ {…candidate} ] }  — user-approved candidates become
 *                                        real notebook sources
 *
 * Never invents a source; never cites an unretrieved URL; never uses a
 * dead URL; never treats a search snippet as verified content.
 */

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  const { data: notebook } = await supabase.from("notebooks").select("id,assignment_id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!notebook) return NextResponse.json({ error: "Notebook not found." }, { status: 404 });

  let body: { topic?: string; approve?: ResearchCandidate[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  /* -------- step 9→10: approve flow -------- */
  if (Array.isArray(body.approve)) {
    const approved = body.approve.filter((c) => c && typeof c.url === "string");
    if (approved.length === 0) return NextResponse.json({ error: "No candidates to approve." }, { status: 400 });
    // source label allocation
    const { data: existing } = await supabase.from("notebook_sources").select("source_id").eq("notebook_id", id);
    const used = new Set((existing ?? []).map((r: { source_id: string }) => r.source_id));
    const added: unknown[] = [];
    const rejected: { url: string; reason: string }[] = [];
    for (const cand of approved) {
      try {
        let label = "";
        for (let i = 1; i <= 500; i++) {
          if (!used.has(`S${i}`)) { label = `S${i}`; break; }
        }
        const row = approvedCandidateToSource(cand, id, label);
        const { data, error } = await supabase
          .from("notebook_sources")
          .insert({
            notebook_id: id,
            user_id: user.id,
            source_id: label,
            title: row.title,
            source_type: row.sourceType,
            original_url: row.originalUrl,
            canonical_url: row.canonicalUrl,
            content_hash: row.contentHash,
            retrieved_at: row.retrievedAt,
            extracted_text: row.extractedText,
            page_metadata: [],
            section_metadata: [],
            processing_status: row.processingStatus,
            verification_status: row.verificationStatus,
            included: true,
            pinned: false,
            authority: row.authority as Record<string, unknown>,
            why_selected: row.whySelected as Record<string, unknown>,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        used.add(label);
        added.push(data);
      } catch (e) {
        rejected.push({ url: cand.url, reason: (e as Error).message });
      }
    }
    return NextResponse.json({ added, rejected });
  }

  /* -------- steps 1-8: run the pipeline -------- */
  const topic = (body.topic || "").trim();
  if (topic.length < 3) return NextResponse.json({ error: "Provide a research topic." }, { status: 400 });
  if (!searchProviderConfigured()) {
    return NextResponse.json(
      { error: "Web search is not configured on this server, so no candidates can be honestly found. You can still add sources manually." },
      { status: 503 }
    );
  }
  try {
    const provider = getSearchProvider();
    const { analysis, candidates, notes } = await researchTopic(topic, {
      provider,
      ranker: (hits) =>
        rankCandidatesForAssignment(hits, { topic, academicLevel: "high" }).map((r) => r.hit),
      maxCandidates: 6,
    });
    return NextResponse.json({ analysis, candidates, notes });
  } catch (e) {
    if (e instanceof SearchNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    return NextResponse.json({ error: `Research failed: ${(e as Error).message}` }, { status: 500 });
  }
}
