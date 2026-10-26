import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { loadArtifact, artifactAsDocx } from "@/lib/integrations/artifact-loader";
import { microsoftConfigured, uploadOfficeFile, overwriteDocxGuarded, getItemMetadata, listItemVersions } from "@/lib/integrations/microsoft";
import { getConnection, updateTokens } from "@/lib/integrations/connections";
import { needsRefresh } from "@/lib/integrations/oauth-state";
import { refreshAccessToken as refreshMs } from "@/lib/integrations/microsoft";
import { recordHistoryEvent, fingerprintBytes, evaluatePrecondition } from "@/lib/integrations/history";

/**
 * GET /api/integrations/microsoft/documents?item_id=...&versions=1
 * Returns the CURRENT metadata (including the eTag the user must review
 * before a replacement) and, when requested, the provider's version list.
 * The eTag is never cacheable — a stale listing is not proof of anything.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  if (!microsoftConfigured()) return NextResponse.json({ ok: false, error: "Microsoft is not configured for this deployment yet." }, { status: 503 });
  const itemId = (request.nextUrl.searchParams.get("item_id") ?? "").trim();
  if (!itemId) return NextResponse.json({ ok: false, error: "An item id is required." }, { status: 400 });
  const conn = await getConnection(guard.data.user.id, "microsoft");
  if (!conn) return NextResponse.json({ ok: false, error: "Connect a Microsoft account first." }, { status: 401 });
  let accessToken = conn.access_token;
  if (needsRefresh(conn.expires_at, Date.now()) && conn.refresh_token) {
    try {
      const fresh = await refreshMs(conn.refresh_token);
      accessToken = fresh.access_token;
      await updateTokens(guard.data.user.id, "microsoft", fresh.access_token, fresh.expires_at);
    } catch {
      return NextResponse.json({ ok: false, error: "Microsoft access expired. Reconnect in Settings → Integrations." }, { status: 401 });
    }
  }
  const meta = await getItemMetadata(accessToken, itemId);
  if (!meta.ok) return NextResponse.json({ ok: false, error: meta.error ?? "The file could not be read." }, { status: 502 });
  const versions = request.nextUrl.searchParams.get("versions") === "1" ? await listItemVersions(accessToken, itemId) : null;
  return NextResponse.json({
    ok: true,
    item: { id: meta.id, name: meta.name, webUrl: meta.webUrl, eTag: meta.eTag, lastModifiedDateTime: meta.lastModifiedDateTime, size: meta.size },
    versions: versions ? { ok: versions.ok, items: versions.versions, error: versions.error } : null,
    note: "Sophira replaces a Word file as a WHOLE FILE built from your Sophira artifact. Existing Word comments, tracked changes, and formatting you added in Word are not preserved by a replacement.",
  });
}

/**
 * POST /api/integrations/microsoft/documents { artifact_id, notebook_id?, format?, overwrite?, item_id?, expected_etag?, selection_id? }
 * - create: conflict=fail — an existing file is NEVER silently overwritten.
 * - replace: requires the explicit flags AND the eTag of the version the user
 *   actually reviewed. The write is conditional (If-Match); a stale eTag is
 *   refused BEFORE anything is sent, and a concurrent change is refused by
 *   the provider (412). Every attempt/result is recorded in document history.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  if (!microsoftConfigured()) {
    return NextResponse.json({ ok: false, error: "Microsoft is not configured for this deployment yet (see docs/WORD_GOOGLE_DOCS_SETUP.md)." }, { status: 503 });
  }
  let body: { artifact_id?: string; notebook_id?: string; overwrite?: boolean; item_id?: string; expected_etag?: string; format?: string; selection_id?: string };
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
  const baseEvent = {
    userId: guard.data.user.id,
    provider: "microsoft" as const,
    documentId: (body.item_id || "").trim() || "pending-create",
    selectionId: (body.selection_id || "").trim() || null,
  };
  try {
    const { bytes, baseName } = await artifactAsDocx(artifact);
    const contentFingerprint = fingerprintBytes(bytes);

    if (body.overwrite) {
      const itemId = (body.item_id || "").trim();
      const expectedEtag = (body.expected_etag || "").trim();
      if (!itemId) return NextResponse.json({ ok: false, error: "A file id is required to replace an existing document." }, { status: 400 });
      if (!expectedEtag) {
        return NextResponse.json({
          ok: false, conflict: true,
          error: "Sophira needs the version you actually reviewed before replacing a file. Open the file's latest version in Sophira first, then confirm the replacement — nothing was overwritten.",
        }, { status: 409 });
      }
      const historyBase = { ...baseEvent, documentId: itemId };
      const meta = await getItemMetadata(accessToken, itemId);
      if (!meta.ok) {
        return NextResponse.json({ ok: false, error: meta.error ?? "The file's current version could not be checked, so nothing was replaced." }, { status: 502 });
      }
      const verdict = evaluatePrecondition(expectedEtag, meta.eTag);
      if (verdict !== "ok") {
        const conflictEvent = await recordHistoryEvent({
          ...historyBase, eventType: "conflict_detected", actor: "external", provenance: "external-observed",
          outcome: "conflicted", errorCategory: verdict === "stale" ? "etag_stale" : "etag_unknown",
          providerRevision: meta.eTag, previousRevision: expectedEtag,
          documentTitle: meta.name, documentUrl: meta.webUrl, summary: "Replacement refused before writing: the file version did not match the one reviewed.",
        });
        return NextResponse.json({
          ok: false, conflict: true, history_event_id: conflictEvent.id,
          error: "This file changed in OneDrive since you reviewed it. Nothing was overwritten. Your draft is safe — review the latest version and try again.",
          current: { eTag: meta.eTag, lastModifiedDateTime: meta.lastModifiedDateTime },
        }, { status: 409 });
      }
      const attempt = await recordHistoryEvent({
        ...historyBase, eventType: "replacement_attempted", actor: "sophira", provenance: "sophira-generated",
        outcome: "pending", providerRevision: meta.eTag, documentTitle: meta.name, documentUrl: meta.webUrl,
        snapshotFormat: "provider-version", contentFingerprint,
        summary: "Whole-file replacement started (existing Word comments/tracked changes are not preserved).",
      });
      const replaced = await overwriteDocxGuarded(accessToken, itemId, bytes, meta.eTag!);
      if (replaced.conflict) {
        const conflictEvent = await recordHistoryEvent({
          ...historyBase, eventType: "conflict_detected", actor: "external", provenance: "external-observed",
          outcome: "conflicted", errorCategory: "etag_concurrent_change", providerRevision: null,
          previousRevision: meta.eTag, documentTitle: meta.name, documentUrl: meta.webUrl,
          parentEventId: attempt.id, summary: "The file changed during the replacement. Nothing was overwritten; the draft was preserved.",
        });
        return NextResponse.json({ ok: false, conflict: true, history_event_id: conflictEvent.id, error: replaced.error }, { status: 409 });
      }
      if (!replaced.saved) {
        await recordHistoryEvent({
          ...historyBase, eventType: "replacement_attempted", actor: "sophira", provenance: "unknown",
          outcome: "failed", errorCategory: "provider_write_failed", previousRevision: meta.eTag,
          documentTitle: meta.name, documentUrl: meta.webUrl, parentEventId: attempt.id,
          summary: "The replacement was refused or failed. The original file was left intact.",
        });
        return NextResponse.json({ ok: false, error: replaced.error }, { status: 502 });
      }
      const after = await getItemMetadata(accessToken, itemId);
      const confirmed = await recordHistoryEvent({
        ...historyBase, eventType: "replacement_confirmed", actor: "sophira", provenance: "sophira-inserted",
        outcome: "confirmed", providerRevision: after.eTag ?? replaced.eTag, previousRevision: meta.eTag,
        contentFingerprint, documentTitle: meta.name ?? after.name, documentUrl: replaced.url ?? after.webUrl,
        snapshotFormat: "provider-version", parentEventId: attempt.id,
        summary: "Whole-file replacement confirmed by OneDrive. The recoverable copy is OneDrive's own version history.",
      });
      return NextResponse.json({
        ok: true, saved: true, replaced: true, url: replaced.url,
        eTag: after.eTag ?? replaced.eTag,
        history_event_id: confirmed.id,
        history_warning: confirmed.ok ? null : "The file was replaced, but the history record could not be saved. The replacement DID happen.",
        note: "The file was replaced as a whole document built from your Sophira artifact — not an in-place edit.",
      });
    }

    const kind = body.format === "pptx" ? "pptx" : "docx";
    const result = await uploadOfficeFile(accessToken, baseName, bytes, kind);
    const after = await getItemMetadata(accessToken, result.id);
    const created = await recordHistoryEvent({
      ...baseEvent, documentId: result.id, eventType: "document_created", actor: "sophira",
      provenance: "sophira-inserted", outcome: "confirmed", providerRevision: after.eTag,
      contentFingerprint, documentTitle: after.name ?? baseName, documentUrl: result.url,
      summary: `New ${kind === "pptx" ? "PowerPoint" : "Word"} file created from a Sophira artifact.`,
    });
    return NextResponse.json({
      ok: true, saved: true, created: true, id: result.id, url: result.url, eTag: after.eTag ?? null,
      history_event_id: created.id,
      history_warning: created.ok ? null : "The file was created, but the history record could not be saved.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "The save failed." }, { status: 502 });
  }
}
