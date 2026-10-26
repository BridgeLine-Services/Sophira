import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { getConnection, updateTokens } from "@/lib/integrations/connections";
import { needsRefresh } from "@/lib/integrations/oauth-state";
import { googleConfigured, getGoogleDocSnapshot, createDocFromArtifact, refreshAccessToken as refreshGoogle } from "@/lib/integrations/google";
import { microsoftConfigured, getItemMetadata, restoreItemVersion, refreshAccessToken as refreshMs } from "@/lib/integrations/microsoft";
import {
  recordHistoryEvent, listHistoryEvents, recentSnapshots, latestSnapshotEvent, getOwnedSnapshot,
  computeDiff, fingerprintText, evaluatePrecondition, HISTORY_DISCLAIMER, type HistoryProvider,
} from "@/lib/integrations/history";
import type { ExportArtifact } from "@/lib/documents/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readProvider(raw: string | null): HistoryProvider | null {
  return raw === "google" || raw === "microsoft" ? raw : null;
}

/** GET ?provider=&document_id=&compare=1 — owner-scoped timeline + optional comparison. */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const provider = readProvider(request.nextUrl.searchParams.get("provider"));
  const documentId = (request.nextUrl.searchParams.get("document_id") ?? "").trim();
  if (!provider) return NextResponse.json({ ok: false, error: "A provider (google or microsoft) is required." }, { status: 400 });
  if (!documentId) return NextResponse.json({ ok: false, error: "A document id is required." }, { status: 400 });
  const listed = await listHistoryEvents(guard.data.user.id, provider, documentId, 50);
  if (!listed.ok) return NextResponse.json({ ok: false, error: listed.error }, { status: 502 });
  let compare: { ok: boolean; added: string[]; removed: string[]; unchangedCount: number; truncated: boolean; older: { id: string; recorded_at: string } | null; newer: { id: string; recorded_at: string } | null; note: string } | null = null;
  if (request.nextUrl.searchParams.get("compare") === "1") {
    const snaps = await recentSnapshots(guard.data.user.id, provider, documentId, 2);
    if (snaps.length >= 2) {
      const diff = computeDiff(snaps[1].snapshot, snaps[0].snapshot);
      compare = {
        ok: true,
        added: diff.added.slice(0, 200),
        removed: diff.removed.slice(0, 200),
        unchangedCount: diff.unchangedCount,
        truncated: diff.truncated || diff.added.length > 200 || diff.removed.length > 200,
        older: { id: snaps[1].id, recorded_at: snaps[1].recorded_at },
        newer: { id: snaps[0].id, recorded_at: snaps[0].recorded_at },
        note: "A difference shows that content changed between two observed versions. It does not prove who made the change.",
      };
    } else {
      compare = { ok: false, added: [], removed: [], unchangedCount: 0, truncated: false, older: null, newer: null, note: "Sophira needs at least two preserved versions before it can compare them." };
    }
  }
  return NextResponse.json({ ok: true, events: listed.events, disclaimer: HISTORY_DISCLAIMER, compare });
}

/** POST actions: observe | recovery_copy | restore_version (all owner-scoped, never unconditional). */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  let body: { action?: string; provider?: string; document_id?: string; event_id?: string; item_id?: string; version_id?: string; expected_etag?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const userId = guard.data.user.id;
  const action = (body.action ?? "").trim();

  if (action === "observe") {
    const provider = readProvider(body.provider ?? null);
    const documentId = (body.document_id ?? "").trim();
    if (!provider || !documentId) return NextResponse.json({ ok: false, error: "A provider and document id are required." }, { status: 400 });
    if (provider === "google") {
      if (!googleConfigured()) return NextResponse.json({ ok: false, error: "Google integration is not configured in this deployment yet." }, { status: 503 });
      const conn = await getConnection(userId, "google");
      if (!conn) return NextResponse.json({ ok: false, error: "No Google account is connected." }, { status: 400 });
      let accessToken = conn.access_token;
      if (needsRefresh(conn.expires_at, Date.now()) && conn.refresh_token) {
        try { const fresh = await refreshGoogle(conn.refresh_token); accessToken = fresh.access_token; await updateTokens(userId, "google", fresh.access_token, fresh.expires_at); }
        catch { return NextResponse.json({ ok: false, error: "The Google connection expired. Reconnect it." }, { status: 401 }); }
      }
      const snap = await getGoogleDocSnapshot(accessToken, documentId);
      if (!snap.ok || !snap.revisionId) return NextResponse.json({ ok: false, error: snap.error ?? "The document could not be read." }, { status: 502 });
      const text = snap.blocks.map((b) => b.text).join("\n");
      const fp = fingerprintText(text);
      const latest = await latestSnapshotEvent(userId, provider, documentId);
      if (!latest.fingerprint) {
        const ev = await recordHistoryEvent({
          userId, provider, documentId, eventType: "baseline_captured", actor: "sophira",
          provenance: "provider-reported", outcome: "confirmed", providerRevision: snap.revisionId,
          contentFingerprint: fp, snapshotText: text, snapshotFormat: "google-docs-text",
          summary: "Baseline captured: current document version preserved for comparison.",
        });
        return NextResponse.json({ ok: true, changed: false, baseline: true, fingerprint: fp, event_id: ev.id, note: "Baseline saved. Future checks compare against this version." });
      }
      if (latest.fingerprint === fp) {
        return NextResponse.json({ ok: true, changed: false, fingerprint: fp, note: "No change since the last preserved version." });
      }
      const diff = latest.snapshot ? computeDiff(latest.snapshot, text) : null;
      const ev = await recordHistoryEvent({
        userId, provider, documentId, eventType: "external_change_observed", actor: "external",
        provenance: "external-observed", outcome: "confirmed", providerRevision: snap.revisionId,
        contentFingerprint: fp, previousFingerprint: latest.fingerprint,
        snapshotText: text, snapshotFormat: "google-docs-text", diff,
        summary: "A change outside a confirmed Sophira write was observed. Origin unknown.",
      });
      return NextResponse.json({ ok: true, changed: true, fingerprint: fp, previous_fingerprint: latest.fingerprint, event_id: ev.id, note: "Change recorded as observed — not attributed to any person." });
    }
    if (!microsoftConfigured()) return NextResponse.json({ ok: false, error: "Microsoft is not configured in this deployment yet." }, { status: 503 });
    const conn = await getConnection(userId, "microsoft");
    if (!conn) return NextResponse.json({ ok: false, error: "No Microsoft account is connected." }, { status: 400 });
    let accessToken = conn.access_token;
    if (needsRefresh(conn.expires_at, Date.now()) && conn.refresh_token) {
      try { const fresh = await refreshMs(conn.refresh_token); accessToken = fresh.access_token; await updateTokens(userId, "microsoft", fresh.access_token, fresh.expires_at); }
      catch { return NextResponse.json({ ok: false, error: "Microsoft access expired. Reconnect it." }, { status: 401 }); }
    }
    const meta = await getItemMetadata(accessToken, documentId);
    if (!meta.ok) return NextResponse.json({ ok: false, error: meta.error ?? "The file could not be checked." }, { status: 502 });
    const listed = await listHistoryEvents(userId, provider, documentId, 1);
    const previousRevision = listed.events[0]?.provider_revision ?? null;
    if (!previousRevision) {
      const ev = await recordHistoryEvent({
        userId, provider, documentId, eventType: "baseline_captured", actor: "sophira",
        provenance: "provider-reported", outcome: "confirmed", providerRevision: meta.eTag,
        documentTitle: meta.name, documentUrl: meta.webUrl, snapshotFormat: "provider-version",
        summary: "Baseline captured: file identity and version recorded. Word file bytes are not stored; OneDrive's version history is the recoverable copy.",
      });
      return NextResponse.json({ ok: true, changed: false, baseline: true, eTag: meta.eTag, event_id: ev.id, note: "Baseline saved (metadata only)." });
    }
    if (previousRevision === meta.eTag) {
      return NextResponse.json({ ok: true, changed: false, eTag: meta.eTag, note: "No version change since the last recorded state." });
    }
    const ev = await recordHistoryEvent({
      userId, provider, documentId, eventType: "external_change_observed", actor: "external",
      provenance: "provider-reported", outcome: "confirmed", providerRevision: meta.eTag, previousRevision,
      documentTitle: meta.name, documentUrl: meta.webUrl, snapshotFormat: "provider-version",
      summary: "The file version changed outside a confirmed Sophira write. Origin unknown.",
    });
    return NextResponse.json({ ok: true, changed: true, eTag: meta.eTag, previous_revision: previousRevision, event_id: ev.id, note: "Change recorded from provider metadata. Sophira cannot show a Word content diff without downloading the file." });
  }

  if (action === "recovery_copy") {
    const eventId = (body.event_id ?? "").trim();
    if (!eventId) return NextResponse.json({ ok: false, error: "A history event is required." }, { status: 400 });
    const owned = await getOwnedSnapshot(userId, eventId);
    if (!owned.ok || !owned.snapshot || !owned.documentId) {
      return NextResponse.json({ ok: false, error: "That preserved version is not available (or belongs to another account)." }, { status: 404 });
    }
    if (owned.provider !== "google") {
      return NextResponse.json({
        ok: false,
        error: "Sophira does not store Word file bytes. For Word, use OneDrive's own version history — Sophira can list and restore those versions for you from the document page.",
      }, { status: 400 });
    }
    if (!googleConfigured()) return NextResponse.json({ ok: false, error: "Google integration is not configured in this deployment yet." }, { status: 503 });
    const conn = await getConnection(userId, "google");
    if (!conn) return NextResponse.json({ ok: false, error: "No Google account is connected." }, { status: 400 });
    let accessToken = conn.access_token;
    if (needsRefresh(conn.expires_at, Date.now()) && conn.refresh_token) {
      try { const fresh = await refreshGoogle(conn.refresh_token); accessToken = fresh.access_token; await updateTokens(userId, "google", fresh.access_token, fresh.expires_at); }
      catch { return NextResponse.json({ ok: false, error: "The Google connection expired. Reconnect it." }, { status: 401 }); }
    }
    const artifact: ExportArtifact = {
      title: `Sophira recovery copy — ${new Date().toISOString().slice(0, 10)}`,
      artifactType: "recovery_copy",
      artifactId: eventId,
      notebookId: "",
      createdAt: new Date().toISOString(),
      sections: [{ heading: "Recovered version", items: owned.snapshot.split("\n").filter((l) => l.trim() !== "").slice(0, 500), sources: [] }],
      provenance: [{ sourceLabel: "Sophira document history", title: "Preserved snapshot", locator: eventId }],
      honestNote: owned.truncated ? "This recovered copy is TRUNCATED: the preserved snapshot exceeded Sophira's storage cap. The original document was not modified." : "This is a NEW document. The original was not modified.",
    };
    const created = await createDocFromArtifact(accessToken, artifact);
    const ev = await recordHistoryEvent({
      userId, provider: "google", documentId: owned.documentId, eventType: "restore_completed",
      actor: "user", provenance: "user-confirmed", outcome: "confirmed", documentUrl: created.url,
      summary: "Recovery copy created from a preserved snapshot (the original document was not modified).",
    });
    return NextResponse.json({ ok: true, url: created.url, event_id: ev.id, note: "A new Google Doc was created from the preserved version. Your original document was left untouched." });
  }

  if (action === "restore_version") {
    const itemId = (body.item_id ?? "").trim();
    const versionId = (body.version_id ?? "").trim();
    const expectedEtag = (body.expected_etag ?? "").trim();
    if (!itemId || !versionId || !expectedEtag) {
      return NextResponse.json({ ok: false, error: "A file id, version id, and the version (eTag) you reviewed are required." }, { status: 400 });
    }
    if (!microsoftConfigured()) return NextResponse.json({ ok: false, error: "Microsoft is not configured in this deployment yet." }, { status: 503 });
    const conn = await getConnection(userId, "microsoft");
    if (!conn) return NextResponse.json({ ok: false, error: "No Microsoft account is connected." }, { status: 400 });
    let accessToken = conn.access_token;
    if (needsRefresh(conn.expires_at, Date.now()) && conn.refresh_token) {
      try { const fresh = await refreshMs(conn.refresh_token); accessToken = fresh.access_token; await updateTokens(userId, "microsoft", fresh.access_token, fresh.expires_at); }
      catch { return NextResponse.json({ ok: false, error: "Microsoft access expired. Reconnect it." }, { status: 401 }); }
    }
    const meta = await getItemMetadata(accessToken, itemId);
    if (!meta.ok) return NextResponse.json({ ok: false, error: meta.error ?? "The file could not be checked." }, { status: 502 });
    const verdict = evaluatePrecondition(expectedEtag, meta.eTag);
    if (verdict !== "ok") {
      const ev = await recordHistoryEvent({
        userId, provider: "microsoft", documentId: itemId, eventType: "restore_refused", actor: "external",
        provenance: "external-observed", outcome: "conflicted", errorCategory: "etag_mismatch",
        providerRevision: meta.eTag, previousRevision: expectedEtag, documentTitle: meta.name, documentUrl: meta.webUrl,
        summary: "Restore refused: the file changed since the version you reviewed.",
      });
      return NextResponse.json({ ok: false, conflict: true, event_id: ev.id, error: "This file changed since you reviewed it. Nothing was restored — review the latest version and try again." }, { status: 409 });
    }
    const attempted = await recordHistoryEvent({
      userId, provider: "microsoft", documentId: itemId, eventType: "restore_attempted", actor: "user",
      provenance: "user-confirmed", outcome: "pending", providerRevision: expectedEtag,
      documentTitle: meta.name, documentUrl: meta.webUrl, summary: `Restore of provider version ${versionId.slice(0, 12)} requested.`,
    });
    const restored = await restoreItemVersion(accessToken, itemId, versionId, expectedEtag);
    if (!restored.ok) {
      const ev = await recordHistoryEvent({
        userId, provider: "microsoft", documentId: itemId, eventType: "restore_refused", actor: "sophira",
        provenance: restored.conflict ? "external-observed" : "unknown",
        outcome: restored.conflict ? "conflicted" : "failed", errorCategory: restored.conflict ? "etag_concurrent_change" : "provider_restore_failed",
        previousRevision: expectedEtag, documentTitle: meta.name, parentEventId: attempted.id,
        summary: "The restore did not complete; the current file was left as it was.",
      });
      return NextResponse.json({ ok: false, conflict: restored.conflict, event_id: ev.id, error: restored.error }, { status: restored.conflict ? 409 : 502 });
    }
    const after = await getItemMetadata(accessToken, itemId);
    const ev = await recordHistoryEvent({
      userId, provider: "microsoft", documentId: itemId, eventType: "restore_completed", actor: "user",
      provenance: "user-confirmed", outcome: "confirmed", providerRevision: after.eTag, previousRevision: expectedEtag,
      documentTitle: meta.name, documentUrl: after.webUrl, parentEventId: attempted.id,
      summary: "OneDrive restored the selected version; the resulting version is recorded.",
    });
    return NextResponse.json({ ok: true, url: after.webUrl, eTag: after.eTag, event_id: ev.id });
  }

  return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
}
