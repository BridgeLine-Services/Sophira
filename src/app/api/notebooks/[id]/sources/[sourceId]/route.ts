import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { explainSource } from "@/lib/notebook/why-source";
import type { NotebookSource } from "@/lib/notebook/types";

export const runtime = "nodejs";

/**
 * Source controls + "Why this source?" — OWNER ONLY (RLS):
 *   GET   /api/notebooks/:id/sources/:sourceId — "Why this source?" report
 *   PATCH /api/notebooks/:id/sources/:sourceId — { action: 'include'|'exclude'|'pin'|'unpin'|'verify'|'unverify' }
 *   DELETE — remove the source (and its evidence) permanently
 */

async function load(supabase: Awaited<ReturnType<typeof createClient>>, notebookId: string, sourceId: string, userId: string) {
  const { data, error } = await supabase
    .from("notebook_sources")
    .select("*")
    .eq("id", sourceId)
    .eq("notebook_id", notebookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

function toNotebookSource(row: Record<string, unknown>): NotebookSource {
  return {
    id: row.id as string,
    sourceId: row.source_id as string,
    title: row.title as string,
    sourceType: row.source_type as NotebookSource["sourceType"],
    originalUrl: (row.original_url as string) ?? "",
    canonicalUrl: (row.canonical_url as string) ?? "",
    contentHash: (row.content_hash as string) ?? "",
    uploadedAt: row.created_at as string,
    retrievedAt: (row.retrieved_at as string) ?? null,
    extractedText: (row.extracted_text as string) ?? "",
    pageMetadata: (row.page_metadata as NotebookSource["pageMetadata"]) ?? [],
    sectionMetadata: (row.section_metadata as NotebookSource["sectionMetadata"]) ?? [],
    processingStatus: row.processing_status as NotebookSource["processingStatus"],
    verificationStatus: row.verification_status as NotebookSource["verificationStatus"],
    included: row.included as boolean,
    pinned: row.pinned as boolean,
    authority: (row.authority as Record<string, unknown>) ?? {},
    whySelected: (row.why_selected as NotebookSource["whySelected"]) ?? {},
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const row = await load(supabase, id, sourceId, guard.data.user.id);
  if (!row) return NextResponse.json({ error: "Source not found." }, { status: 404 });
  const q = new URL(request.url).searchParams.get("question") ?? undefined;
  return NextResponse.json({ why: explainSource(toNotebookSource(row), q) });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const row = await load(supabase, id, sourceId, guard.data.user.id);
  if (!row) return NextResponse.json({ error: "Source not found." }, { status: 404 });
  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  switch (body.action) {
    case "include": patch.included = true; break;
    case "exclude": patch.included = false; break;
    case "pin": patch.pinned = true; break;
    case "unpin": patch.pinned = false; break;
    case "verify":
      // verify = user-confirmed check for owner-uploaded docs; web sources
      // only reach 'verified' through the actual retrieval pipeline.
      patch.verification_status = row.source_type === "web_url" || row.source_type === "research_source"
        ? row.verification_status
        : "verified";
      break;
    case "unverify": patch.verification_status = "unverified"; break;
    default:
      return NextResponse.json(
        { error: "Unknown action. Use include|exclude|pin|unpin|verify|unverify." },
        { status: 400 }
      );
  }
  const { data, error } = await supabase
    .from("notebook_sources")
    .update(patch)
    .eq("id", sourceId)
    .eq("user_id", guard.data.user.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: "Could not update the source." }, { status: 500 });
  return NextResponse.json({ source: data });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const row = await load(supabase, id, sourceId, guard.data.user.id);
  if (!row) return NextResponse.json({ error: "Source not found." }, { status: 404 });
  await supabase.from("notebook_evidence").delete().eq("source_id", sourceId).eq("user_id", guard.data.user.id);
  const { error } = await supabase.from("notebook_sources").delete().eq("id", sourceId).eq("user_id", guard.data.user.id);
  if (error) return NextResponse.json({ error: "Could not remove the source." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
