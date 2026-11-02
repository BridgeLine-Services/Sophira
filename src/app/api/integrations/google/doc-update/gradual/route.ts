import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { getConnection, updateTokens } from "@/lib/integrations/connections";
import { googleConfigured, getGoogleDocSnapshot, locateSectionInsertion, buildGuardedInsertRequest, applyGoogleDocUpdate } from "@/lib/integrations/google";
import { refreshAccessToken } from "@/lib/integrations/google";
import { needsRefresh } from "@/lib/integrations/oauth-state";
import { recordHistoryEvent, fingerprintText } from "@/lib/integrations/history";
import { planInsertionChunks, remainingText, recoveryNote } from "@/lib/integrations/gradual-insert";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/integrations/google/doc-update/gradual
 *
 * Inserts approved text in a few CONFIRMED steps so a student can follow along.
 * Stateless by design: each call writes up to `max_chunks` chunks and reports how
 * many characters the provider actually confirmed. The client loops, which is what
 * makes pause / resume / stop work across page reloads and network drops.
 *
 * Honesty rules enforced here:
 *  - `inserted_chars` only ever counts text the provider confirmed.
 *  - A revision change between our read and our write is a CONFLICT: we stop,
 *    record it, and never overwrite.
 *  - Stopping (or a conflict / failure) stores whatever was NOT written as a real
 *    recovery copy event, so nothing is silently lost.
 *  - No artificial delays, no typos, no simulated typing.
 */
const MAX_CHARS = 20000;
const DEFAULT_CHUNKS = 3;

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  if (!googleConfigured()) {
    return NextResponse.json({ ok: false, error: "Google integration is not configured in this deployment yet." }, { status: 503 });
  }

  let body: {
    document_id?: unknown; text?: unknown; section_heading?: unknown;
    inserted_chars?: unknown; action?: unknown; max_chunks?: unknown; selection_id?: unknown;
  } = {};
  try { body = (await request.json()) as typeof body; } catch { /* validated below */ }

  const documentId = typeof body.document_id === "string" ? body.document_id.trim() : "";
  const text = typeof body.text === "string" ? body.text.replace(/\r\n/g, "\n") : "";
  const sectionHeading = typeof body.section_heading === "string" ? body.section_heading.trim() : "";
  const selectionId = typeof body.selection_id === "string" ? body.selection_id.trim() : "";
  const action = body.action === "stop" ? "stop" : "insert";
  const insertedChars = typeof body.inserted_chars === "number" && Number.isFinite(body.inserted_chars)
    ? Math.max(0, Math.floor(body.inserted_chars)) : 0;
  const maxChunks = typeof body.max_chunks === "number" && Number.isFinite(body.max_chunks)
    ? Math.min(10, Math.max(1, Math.floor(body.max_chunks))) : DEFAULT_CHUNKS;

  if (!documentId) return NextResponse.json({ ok: false, error: "A document id is required." }, { status: 400 });
  if (text.trim() === "") return NextResponse.json({ ok: false, error: "There is no text to insert." }, { status: 400 });
  if (text.length > MAX_CHARS) {
    return NextResponse.json({ ok: false, error: `Gradual insertion handles up to ${MAX_CHARS.toLocaleString()} characters at a time. Nothing was written.` }, { status: 400 });
  }

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

  const baseEvent = {
    userId: guard.data.user.id,
    provider: "google" as const,
    documentId,
    selectionId: selectionId || null,
    documentUrl: `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`,
  };

  const remaining = remainingText(text, insertedChars);

  // STOP: keep what was not written as a real recovery copy, then report honestly.
  if (action === "stop") {
    const recovery = remaining.trim()
      ? await recordHistoryEvent({
          ...baseEvent, eventType: "recovery_copy_created", actor: "sophira",
          provenance: "sophira-generated", outcome: "confirmed",
          snapshotText: remaining, summary: `Recovery copy of ${remaining.length} unwritten characters.`,
        })
      : { ok: false, id: null as string | null, sequence: null, error: null };
    const stopped = await recordHistoryEvent({
      ...baseEvent, eventType: "insertion_stopped", actor: "user",
      provenance: "user-requested", outcome: "confirmed",
      summary: "You stopped the insertion. " + recoveryNote(remaining.length),
    });
    return NextResponse.json({
      ok: true, stopped: true, inserted_chars: insertedChars, done: false,
      recovery_copy_event_id: recovery.id, stopped_event_id: stopped.id,
      message: `Stopped. ${recoveryNote(remaining.length)}`,
    });
  }

  if (remaining.trim() === "") {
    return NextResponse.json({ ok: true, done: true, inserted_chars: text.length, conflict: false, message: "Everything was already inserted." });
  }

  const snap = await getGoogleDocSnapshot(accessToken, documentId);
  if (!snap.ok || !snap.revisionId) {
    return NextResponse.json({ ok: false, error: snap.error ?? "The document could not be read, so nothing was written." }, { status: 502 });
  }

  let insertIndex: number;
  if (sectionHeading !== "") {
    const located = locateSectionInsertion(snap.blocks, sectionHeading);
    if (located === null) {
      return NextResponse.json({
        ok: false, conflict: false, inserted_chars: insertedChars,
        error: `The section heading "${sectionHeading}" was not found, so nothing was written. Your text is still here.`,
      }, { status: 400 });
    }
    insertIndex = located;
  } else {
    insertIndex = Math.max(1, (snap.endIndex ?? 2) - 1);
  }

  // Record the request ONCE at the start of a run, as PENDING. The timeline then
  // shows "requested, not confirmed yet" until a confirmed event arrives, instead
  // of the run appearing only after it succeeds.
  if (insertedChars === 0) {
    await recordHistoryEvent({
      ...baseEvent, eventType: "insertion_attempted", actor: "sophira",
      provenance: "sophira-inserted", outcome: "pending",
      targetSection: sectionHeading || null,
      summary: `Gradual insertion requested for ${text.length.toLocaleString()} characters. Not confirmed yet.`,
    });
  }

  const chunks = planInsertionChunks(remaining);
  let confirmed = 0;
  let revisionId = snap.revisionId;
  let doneChunks = 0;
  let lastError: string | null = null;

  for (const chunk of chunks.slice(0, maxChunks)) {
    const payload = buildGuardedInsertRequest(chunk, insertIndex + confirmed, revisionId);
    const result = await applyGoogleDocUpdate(accessToken, documentId, payload);
    if (result.conflict) {
      // The document moved under us. Write nothing further and keep the remainder.
      const recovery = await recordHistoryEvent({
        ...baseEvent, eventType: "recovery_copy_created", actor: "sophira",
        provenance: "sophira-generated", outcome: "confirmed",
        snapshotText: remainingText(remaining, confirmed),
        summary: `Recovery copy after a conflict (${remaining.length - confirmed} characters unwritten).`,
      });
      await recordHistoryEvent({
        ...baseEvent, eventType: "conflict_detected", actor: "external",
        provenance: "external-observed", outcome: "conflicted", errorCategory: "revision_conflict",
        summary: recoveryNote(remaining.length - confirmed),
      });
      return NextResponse.json({
        ok: false, conflict: true, inserted_chars: insertedChars + confirmed,
        done: false, recovery_copy_event_id: recovery.id,
        error: "The document changed while Sophira was inserting, so it stopped to avoid overwriting someone else's edit.",
      }, { status: 409 });
    }
    if (!result.ok) {
      lastError = result.error ?? "Google did not confirm that write.";
      break;
    }
    confirmed += chunk.length;
    doneChunks += 1;
    if (result.revisionId) revisionId = result.revisionId;
  }

  const totalInserted = insertedChars + confirmed;
  const done = totalInserted >= text.length;

  if (lastError) {
    const recovery = await recordHistoryEvent({
      ...baseEvent, eventType: "recovery_copy_created", actor: "sophira",
      provenance: "sophira-generated", outcome: "confirmed",
      snapshotText: remainingText(text, totalInserted),
      summary: `Recovery copy after a failed write (${text.length - totalInserted} characters unwritten).`,
    });
    await recordHistoryEvent({
      ...baseEvent, eventType: "insertion_attempted", actor: "sophira",
      provenance: "sophira-inserted", outcome: "failed", errorCategory: "provider_error",
      summary: `Stopped after a provider error with ${text.length - totalInserted} characters unwritten.`,
    });
    return NextResponse.json({
      ok: false, conflict: false, inserted_chars: totalInserted, done: false,
      recovery_copy_event_id: recovery.id,
      error: `${lastError} Sophira stopped and kept the rest of your text as a recovery copy.`,
    }, { status: 502 });
  }

  if (done) {
    await recordHistoryEvent({
      ...baseEvent, eventType: "insertion_confirmed", actor: "sophira",
      provenance: "sophira-inserted", outcome: "confirmed",
      contentFingerprint: fingerprintText(text),
      summary: `Inserted in ${doneChunks + 0} confirmed step(s) of a gradual insertion.`,
    });
  }

  return NextResponse.json({
    ok: true, done, conflict: false,
    inserted_chars: totalInserted,
    chunks_written: doneChunks,
    remaining_chars: Math.max(0, text.length - totalInserted),
    revision_id: revisionId,
    message: done
      ? "Finished. Google confirmed the whole insertion."
      : `${doneChunks} part(s) confirmed by Google. You can continue, pause, or stop.`,
  });
}
