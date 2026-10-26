import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { getConnection, updateTokens } from "@/lib/integrations/connections";
import { googleConfigured, getGoogleDocSnapshot, locateSectionInsertion, buildGuardedInsertRequest, applyGoogleDocUpdate, refreshAccessToken } from "@/lib/integrations/google";
import { needsRefresh } from "@/lib/integrations/oauth-state";
import { recordHistoryEvent, computeDiff, fingerprintText } from "@/lib/integrations/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const docUrl = (id: string) => `https://docs.google.com/document/d/${id}/edit`;

/**
 * POST /api/integrations/google/doc-update — write the user's draft into
 * their SELECTED Google Doc, section-scoped and revision-guarded.
 * Flow: read CURRENT snapshot (baseline) -> record a PENDING history event
 * -> write ONLY at the user's stated position -> Google refuses (409) if the
 * document changed -> re-read the confirmed result -> record the confirmed
 * history event. Every failure preserves the draft; a confirmed write is
 * never reported as failed because a *history* write failed (that is
 * reported separately as history_warning).
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  if (!googleConfigured()) return NextResponse.json({ ok: false, error: "Google integration is not configured in this deployment yet." }, { status: 503 });
  let body: { document_id?: unknown; text?: unknown; section_heading?: unknown; selection_id?: unknown } = {};
  try { body = (await request.json()) as typeof body; } catch { /* validated below */ }
  const documentId = typeof body.document_id === "string" ? body.document_id.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const sectionHeading = typeof body.section_heading === "string" ? body.section_heading.trim() : "";
  const selectionId = typeof body.selection_id === "string" ? body.selection_id.trim() : "";
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

  const beforeText = snap.blocks.map((b) => b.text).join("\n");
  const beforeFingerprint = fingerprintText(beforeText);
  const baseEvent = {
    userId: guard.data.user.id,
    provider: "google" as const,
    documentId,
    selectionId: selectionId || null,
    documentUrl: docUrl(documentId),
  };

  // Section-scoped placement: a heading that is NOT found NEVER produces a
  // write at a guessed spot.
  let insertIndex: number;
  if (sectionHeading !== "") {
    const located = locateSectionInsertion(snap.blocks, sectionHeading);
    if (located === null) {
      await recordHistoryEvent({
        ...baseEvent, eventType: "insertion_attempted", actor: "sophira",
        provenance: "unknown", outcome: "failed", errorCategory: "section_not_found",
        providerRevision: snap.revisionId, contentFingerprint: beforeFingerprint,
        snapshotText: beforeText, snapshotFormat: "google-docs-text", targetSection: sectionHeading,
        summary: `Draft not written: section heading "${sectionHeading}" was not found.`,
      });
      return NextResponse.json({ ok: false, conflict: false, error: `The section heading "${sectionHeading}" was not found in that document, so nothing was written. Your draft is preserved below — check the heading text and try again.`, preserved_draft: text }, { status: 400 });
    }
    insertIndex = located;
  } else {
    insertIndex = Math.max(1, (snap.endIndex ?? 2) - 1);
  }

  const attempt = await recordHistoryEvent({
    ...baseEvent, eventType: "insertion_attempted", actor: "sophira",
    provenance: "sophira-generated", outcome: "pending",
    providerRevision: snap.revisionId, contentFingerprint: beforeFingerprint, previousFingerprint: beforeFingerprint,
    snapshotText: beforeText, snapshotFormat: "google-docs-text",
    targetSection: sectionHeading || null,
    summary: sectionHeading ? `Draft prepared for section "${sectionHeading}"` : "Draft prepared at the end of the document",
  });

  const payload = buildGuardedInsertRequest(text, insertIndex, snap.revisionId);
  const result = await applyGoogleDocUpdate(accessToken, documentId, payload);

  if (result.conflict) {
    await recordHistoryEvent({
      ...baseEvent, eventType: "conflict_detected", actor: "external",
      provenance: "external-observed", outcome: "conflicted",
      providerRevision: null, previousRevision: snap.revisionId,
      contentFingerprint: null, previousFingerprint: beforeFingerprint,
      targetSection: sectionHeading || null, errorCategory: "revision_conflict",
      parentEventId: attempt.id,
      summary: "The document changed while Sophira prepared the update. Nothing was written; the draft was preserved.",
    });
    return NextResponse.json({ ok: false, conflict: true, error: result.error, preserved_draft: text, history_event_id: attempt.id }, { status: 409 });
  }
  if (!result.ok) {
    await recordHistoryEvent({
      ...baseEvent, eventType: "insertion_attempted", actor: "sophira",
      provenance: "unknown", outcome: "failed", errorCategory: "provider_write_failed",
      providerRevision: null, previousRevision: snap.revisionId, previousFingerprint: beforeFingerprint,
      targetSection: sectionHeading || null, parentEventId: attempt.id,
      summary: "The draft was not written (the provider refused or failed the write).",
    });
    return NextResponse.json({ ok: false, conflict: false, error: result.error, preserved_draft: text }, { status: 502 });
  }

  // Provider confirmed the write. Re-read the RESULT (step 8) so the history
  // records the actual new content, not an assumption.
  const after = await getGoogleDocSnapshot(accessToken, documentId);
  const afterText = after.ok ? after.blocks.map((b) => b.text).join("\n") : null;
  const confirmed = await recordHistoryEvent({
    ...baseEvent, eventType: "insertion_confirmed", actor: "sophira",
    provenance: "sophira-inserted", outcome: "confirmed",
    providerRevision: after.revisionId ?? result.revisionId, previousRevision: snap.revisionId,
    contentFingerprint: afterText ? fingerprintText(afterText) : null, previousFingerprint: beforeFingerprint,
    snapshotText: afterText, snapshotFormat: afterText ? "google-docs-text" : null,
    targetSection: sectionHeading || null, parentEventId: attempt.id,
    diff: afterText ? computeDiff(beforeText, afterText) : null,
    summary: sectionHeading ? `Draft inserted under section "${sectionHeading}" (provider-confirmed)` : "Draft inserted at the end of the document (provider-confirmed)",
  });

  try {
    await supabase
      .from("workload_selections")
      .update({ access_state: "write", updated_at: new Date().toISOString() })
      .eq("user_id", guard.data.user.id)
      .eq("provider", "google")
      .eq("provider_document_id", documentId);
  } catch { /* best-effort metadata; the write itself already succeeded */ }

  return NextResponse.json({
    ok: true, revision_id: result.revisionId, written: true,
    history_event_id: confirmed.id,
    history_warning: confirmed.ok ? null : "The document was written, but the history record could not be saved. The write did happen — retry history later; do not repeat the insertion.",
  });
}
