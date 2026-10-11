import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { getConnection, updateTokens } from "@/lib/integrations/connections";
import { googleConfigured, getGoogleDocSnapshot, locateSectionInsertion, buildGuardedInsertRequest, applyGoogleDocUpdate, refreshAccessToken } from "@/lib/integrations/google";
import { needsRefresh } from "@/lib/integrations/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/google/doc-update — write the user's draft into
 * their SELECTED Google Doc, section-scoped and revision-guarded
 * (Objective 5). The flow: read the CURRENT snapshot -> write ONLY at
 * the user's stated position (after their section heading, or at the
 * end) -> Google refuses (409) if anyone changed the document in
 * between -> the draft is returned so no work is ever lost. Write
 * success updates the workload selection's access_state to "write".
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  if (!googleConfigured()) return NextResponse.json({ ok: false, error: "Google integration is not configured in this deployment yet." }, { status: 503 });
  let body: { document_id?: unknown; text?: unknown; section_heading?: unknown } = {};
  try { body = (await request.json()) as typeof body; } catch { /* validated below */ }
  const documentId = typeof body.document_id === "string" ? body.document_id.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const sectionHeading = typeof body.section_heading === "string" ? body.section_heading.trim() : "";
  if (!documentId) return NextResponse.json({ ok: false, error: "A document id is required." }, { status: 400 });
  if (text === "" || text.length > 20000) return NextResponse.json({ ok: false, error: "Provide the draft to write (up to 20,000 characters)." }, { status: 400 });
  const conn = await getConnection(guard.data.user.id, "google");
  if (!conn) return NextResponse.json({ ok: false, error: "No Google account is connected for your user yet." }, { status: 400 });
  let accessToken = conn.access_token;
  if (needsRefresh(conn.expires_at, Date.now()) && conn.refresh_token) {
    try {
      const fresh = await refreshAccessToken(conn.refresh_token);
      accessToken = fresh.access_token;
      await updateTokens(guard.data.user.id, "google", fresh.access_token, fresh.expires_at);
    } catch {
      return NextResponse.json({ ok: false, error: "The Google connection has expired or was revoked. Reconnect it." }, { status: 401 });
    }
  }
  const snap = await getGoogleDocSnapshot(accessToken, documentId);
  if (!snap.ok || !snap.revisionId) return NextResponse.json({ ok: false, error: snap.error ?? "The document could not be read, so nothing was written." }, { status: 502 });
  // Section-scoped placement: write directly under the user's heading
  // when they stated one. A heading that is NOT found in the document
  // NEVER produces a write at a guessed spot — nothing is written.
  if (sectionHeading !== "") {
    const located = locateSectionInsertion(snap.blocks, sectionHeading);
    if (located === null) {
      return NextResponse.json({ ok: false, conflict: false, error: `The section heading "${sectionHeading}" was not found in that document, so nothing was written. Your draft is preserved below — check the heading text and try again.`, preserved_draft: text }, { status: 400 });
    }
    var insertIndex = located;
  } else {
    var insertIndex = Math.max(1, (snap.endIndex ?? 2) - 1);
  }
  const payload = buildGuardedInsertRequest(text, insertIndex, snap.revisionId);
  const result = await applyGoogleDocUpdate(accessToken, documentId, payload);
  if (result.conflict) {
    return NextResponse.json({ ok: false, conflict: true, error: result.error, preserved_draft: text }, { status: 409 });
  }
  if (!result.ok) {
    return NextResponse.json({ ok: false, conflict: false, error: result.error, preserved_draft: text }, { status: 502 });
  }
  // The provider confirmed the write: record it honestly on the selection.
  try {
    await supabase
      .from("workload_selections")
      .update({ access_state: "write", updated_at: new Date().toISOString() })
      .eq("user_id", guard.data.user.id)
      .eq("provider", "google")
      .eq("provider_document_id", documentId);
  } catch { /* best-effort metadata; the write itself already succeeded */ }
  return NextResponse.json({ ok: true, revision_id: result.revisionId, written: true });
}
