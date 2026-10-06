import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { buildArtifact } from "@/lib/notebook/artifacts";
import type { ArtifactType, NotebookSource, NotebookSourceType, ProcessingStatus, VerificationStatus } from "@/lib/notebook/types";

export const runtime = "nodejs";

/**
 * Artifact generation (2026-10-06):
 *   GET  /api/notebooks/:id/artifacts        — list stored artifacts
 *   POST /api/notebooks/:id/artifacts { type, topic?, citation_style? }
 *        — deterministic, source-provenance-retaining generation
 */

const ALLOWED: ArtifactType[] = ["study_guide", "quiz", "flashcards", "outline", "briefing", "evidence_table", "research_plan", "essay_plan", "bibliography"];

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { data, error } = await supabase
    .from("notebook_artifacts")
    .select("*")
    .eq("notebook_id", id)
    .eq("user_id", guard.data.user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load artifacts." }, { status: 500 });
  return NextResponse.json({ artifacts: data ?? [] });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  const { data: notebook } = await supabase.from("notebooks").select("id,title").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!notebook) return NextResponse.json({ error: "Notebook not found." }, { status: 404 });

  let body: { type?: string; topic?: string; citation_style?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const type = body.type as ArtifactType;
  if (!ALLOWED.includes(type)) return NextResponse.json({ error: "Unknown artifact type." }, { status: 400 });

  const { data: srcRows, error: srcErr } = await supabase
    .from("notebook_sources")
    .select("*")
    .eq("notebook_id", id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (srcErr) return NextResponse.json({ error: "Could not load sources." }, { status: 500 });
  const sources: NotebookSource[] = (srcRows ?? []).map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    title: row.title,
    sourceType: row.source_type as NotebookSourceType,
    originalUrl: row.original_url ?? "",
    canonicalUrl: row.canonical_url ?? "",
    contentHash: row.content_hash ?? "",
    uploadedAt: row.created_at,
    retrievedAt: row.retrieved_at ?? null,
    extractedText: row.extracted_text ?? "",
    pageMetadata: row.page_metadata ?? [],
    sectionMetadata: row.section_metadata ?? [],
    processingStatus: row.processing_status as ProcessingStatus,
    verificationStatus: row.verification_status as VerificationStatus,
    included: row.included,
    pinned: row.pinned,
    authority: row.authority ?? {},
    whySelected: row.why_selected ?? {},
  }));

  const { data: evRows } = await supabase
    .from("notebook_evidence")
    .select("source_id,quote,chars_start,chars_end,label")
    .eq("notebook_id", id)
    .eq("user_id", user.id)
    .limit(300);

  const artifact = buildArtifact({
    type,
    topic: (body.topic || notebook.title || "notebook").trim(),
    sources,
    evidence: (evRows ?? []).map((r) => ({
      sourceId: r.source_id as string,
      quote: r.quote as string,
      charsStart: r.chars_start as number | null,
      charsEnd: r.chars_end as number | null,
      label: r.label as "SOURCE-SUPPORTED" | "INFERENCE" | "NOT VERIFIED",
    })),
    citationStyle: body.citation_style,
  });

  const { data, error } = await supabase
    .from("notebook_artifacts")
    .insert({
      notebook_id: id,
      user_id: user.id,
      artifact_type: type,
      title: artifact.title,
      content: { sections: artifact.sections, honestNote: artifact.honestNote },
      provenance: { sources: artifact.provenance, usedSources: Array.from(new Set(artifact.sections.flatMap((s) => s.sources))) },
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: "Could not save the artifact." }, { status: 500 });
  return NextResponse.json({ artifact: data, rendered: artifact });
}
