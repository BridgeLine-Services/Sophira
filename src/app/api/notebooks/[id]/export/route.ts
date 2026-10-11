import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { buildDocx, buildPdf, digestOf, exportFilename, type ExportArtifact } from "@/lib/documents/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DOCUMENT WORKFLOW — EXPORT STAGE (2026-10-11):
 * POST /api/notebooks/:id/export { artifact_id, format: "docx" | "pdf" }
 *
 * Verification at this stage: the file is built FROM THE STORED ARTIFACT
 * ROW (RLS: the user's own notebook + artifact; never regenerated), and
 * the response carries a SHA-256 digest (X-Sophira-Digest) of the exact
 * bytes, so the exported file can be checked against the stored artifact.
 * The provenance block is always embedded — an export can never silently
 * drop its sources.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  let body: { artifact_id?: string; format?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const artifactId = (body.artifact_id || "").trim();
  const format = (body.format || "").trim().toLowerCase();
  if (!artifactId) return NextResponse.json({ error: "Missing artifact id." }, { status: 400 });
  if (format !== "docx" && format !== "pdf") {
    return NextResponse.json({ error: "format must be 'docx' or 'pdf'." }, { status: 400 });
  }

  // The STORED artifact row — the notebook and artifact both belong to this
  // user under RLS; a mismatched pair is refused.
  const { data: row } = await supabase
    .from("notebook_artifacts")
    .select("id, notebook_id, artifact_type, title, content, provenance, created_at")
    .eq("id", artifactId)
    .eq("notebook_id", id) // belt-and-suspenders with RLS: artifact must be in THIS notebook
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Artifact not found." }, { status: 404 });

  const content = (row.content ?? {}) as {
    sections?: { heading: string; items: string[]; sources: string[] }[];
    honestNote?: string;
  };
  const artifact: ExportArtifact = {
    title: row.title,
    artifactType: row.artifact_type,
    sections: content.sections ?? [],
    provenance: (row.provenance as { sources?: { sourceLabel: string; title: string; locator: string }[] })?.sources ?? [],
    honestNote: content.honestNote,
    artifactId: row.id,
    notebookId: row.notebook_id,
    createdAt: row.created_at,
  };

  const bytes = format === "docx" ? await buildDocx(artifact) : buildPdf(artifact);
  const digest = digestOf(bytes);
  const filename = exportFilename(artifact, format);

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type":
        format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Verification: digest of the EXACT bytes + the stored artifact identity.
      "X-Sophira-Digest": digest,
      "X-Sophira-Artifact": `${row.id}`,
    },
  });
}
