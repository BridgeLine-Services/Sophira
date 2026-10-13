/**
 * SHARED ARTIFACT LOADER for the integration routes (2026-10-11).
 * Loads the STORED artifact row through the requesting user's RLS client —
 * exactly like the export route: the row must exist and (when a notebook id
 * is supplied) belong to that notebook. Another user's artifact is simply
 * not visible under RLS, so cross-user access is impossible.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDocx, exportFilename, type ExportArtifact } from "@/lib/documents/export";
import { buildPptx } from "@/lib/documents/pptx";

export async function loadArtifact(
  supabase: SupabaseClient,
  artifactId: string,
  notebookId?: string,
): Promise<ExportArtifact | null> {
  let q = supabase
    .from("notebook_artifacts")
    .select("id, notebook_id, artifact_type, title, content, provenance, created_at")
    .eq("id", artifactId)
    .is("archived_at", null);
  if (notebookId) q = q.eq("notebook_id", notebookId);
  const { data: row } = await q.maybeSingle();
  if (!row) return null;
  const content = (row.content ?? {}) as {
    sections?: { heading: string; items: string[]; sources: string[] }[];
    honestNote?: string;
  };
  return {
    title: row.title,
    artifactType: row.artifact_type,
    sections: content.sections ?? [],
    provenance: (row.provenance as { sources?: { sourceLabel: string; title: string; locator: string }[] })?.sources ?? [],
    honestNote: content.honestNote,
    artifactId: row.id,
    notebookId: row.notebook_id,
    createdAt: row.created_at,
  };
}

/** The DOCX bytes + base filename for provider uploads (same builder as local export). */
export async function artifactAsDocx(a: ExportArtifact): Promise<{ bytes: Buffer; baseName: string }> {
  const bytes = await buildDocx(a);
  const baseName = exportFilename(a, "docx").replace(/\.docx$/, "");
  return { bytes, baseName };
}

/** The PPTX bytes + base filename for provider uploads (same builder as local export). */
export async function artifactAsPptx(a: ExportArtifact): Promise<{ bytes: Buffer; baseName: string }> {
  const bytes = await buildPptx(a);
  const baseName = exportFilename(a, "pptx").replace(/\.pptx$/, "");
  return { bytes, baseName };
}
