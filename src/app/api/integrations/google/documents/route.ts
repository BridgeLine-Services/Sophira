import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { loadArtifact } from "@/lib/integrations/artifact-loader";
import { googleConfigured, createDocFromArtifact } from "@/lib/integrations/google";
import { getConnection, updateTokens } from "@/lib/integrations/connections";
import { needsRefresh } from "@/lib/integrations/oauth-state";
import { refreshAccessToken as refreshGoogle } from "@/lib/integrations/google";

/**
 * POST /api/integrations/google/documents { artifact_id, notebook_id? }
 * Creates a real Google Doc from the STORED artifact in the user's account
 * (drive.file scope: only documents Sophira creates). The response carries
 * the document's real URL once Google confirms it.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  if (!googleConfigured()) {
    return NextResponse.json({ ok: false, error: "Google is not configured for this deployment yet (see docs/WORD_GOOGLE_DOCS_SETUP.md)." }, { status: 503 });
  }
  let body: { artifact_id?: string; notebook_id?: string; format?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const artifactId = (body.artifact_id || "").trim();
  if (!artifactId) return NextResponse.json({ error: "Missing artifact id." }, { status: 400 });
  const conn = await getConnection(guard.data.user.id, "google");
  if (!conn) return NextResponse.json({ error: "Connect a Google account first (Settings → Integrations)." }, { status: 401 });
  let accessToken = conn.access_token;
  if (needsRefresh(conn.expires_at, Date.now()) && conn.refresh_token) {
    try {
      const fresh = await refreshGoogle(conn.refresh_token);
      accessToken = fresh.access_token;
      await updateTokens(guard.data.user.id, "google", fresh.access_token, fresh.expires_at);
    } catch {
      return NextResponse.json({ error: "Google access expired. Please reconnect in Settings → Integrations." }, { status: 401 });
    }
  }
  const artifact = await loadArtifact(supabase, artifactId, body.notebook_id);
  if (!artifact) return NextResponse.json({ error: "Artifact not found." }, { status: 404 });
  try {
    if (body.format === "pptx") {
      const { artifactAsPptx } = await import("@/lib/integrations/artifact-loader");
      const { bytes, baseName } = await artifactAsPptx(artifact);
      const { uploadPptxAsSlides } = await import("@/lib/integrations/google");
      const slides = await uploadPptxAsSlides(accessToken, baseName, bytes);
      return NextResponse.json({ ok: true, saved: true, created: true, kind: "slides", url: slides.url });
    }
    const result = await createDocFromArtifact(accessToken, artifact);
    return NextResponse.json({ ok: true, saved: true, created: true, url: result.url });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "The save failed." }, { status: 502 });
  }
}
