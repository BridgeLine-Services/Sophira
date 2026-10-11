import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { loadArtifact, artifactAsDocx } from "@/lib/integrations/artifact-loader";
import { microsoftConfigured, uploadDocx, overwriteDocx } from "@/lib/integrations/microsoft";
import { getConnection, updateTokens } from "@/lib/integrations/connections";
import { needsRefresh } from "@/lib/integrations/oauth-state";
import { refreshAccessToken as refreshMs } from "@/lib/integrations/microsoft";

/**
 * POST /api/integrations/microsoft/documents { artifact_id, notebook_id?, overwrite?, item_id? }
 * Saves the STORED artifact as a real Word document in the user's OneDrive.
 * - create: conflict=fail — an existing file is NEVER silently overwritten
 * - overwrite: requires the explicit flags AND the known item id
 * The response reports what actually happened, with the real document URL.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  if (!microsoftConfigured()) {
    return NextResponse.json({ ok: false, error: "Microsoft is not configured for this deployment yet (see docs/WORD_GOOGLE_DOCS_SETUP.md)." }, { status: 503 });
  }
  let body: { artifact_id?: string; notebook_id?: string; overwrite?: boolean; item_id?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const artifactId = (body.artifact_id || "").trim();
  if (!artifactId) return NextResponse.json({ error: "Missing artifact id." }, { status: 400 });
  const conn = await getConnection(guard.data.user.id, "microsoft");
  if (!conn) return NextResponse.json({ error: "Connect a Microsoft account first (Settings → Integrations)." }, { status: 401 });
  let accessToken = conn.access_token;
  if (needsRefresh(conn.expires_at, Date.now()) && conn.refresh_token) {
    try {
      const fresh = await refreshMs(conn.refresh_token);
      accessToken = fresh.access_token;
      await updateTokens(guard.data.user.id, "microsoft", fresh.access_token, fresh.expires_at);
    } catch {
      return NextResponse.json({ error: "Microsoft access expired. Please reconnect in Settings → Integrations." }, { status: 401 });
    }
  }
  const artifact = await loadArtifact(supabase, artifactId, body.notebook_id);
  if (!artifact) return NextResponse.json({ error: "Artifact not found." }, { status: 404 });
  try {
    const { bytes, baseName } = await artifactAsDocx(artifact);
    if (body.overwrite && body.item_id) {
      const result = await overwriteDocx(accessToken, body.item_id, bytes);
      return NextResponse.json({ ok: true, saved: true, replaced: true, url: result.url });
    }
    const result = await uploadDocx(accessToken, baseName, bytes);
    return NextResponse.json({ ok: true, saved: true, created: true, id: result.id, url: result.url });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "The save failed." }, { status: 502 });
  }
}
