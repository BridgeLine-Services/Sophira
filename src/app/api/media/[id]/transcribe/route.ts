import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/guard";
import { readSelfHostedConfig } from "@/lib/media/selfhost";
import { MAX_MEDIA_BYTES, transcribeMedia } from "@/lib/media/transcribe";
import { MEDIA_LIMITS, transcriptRowFor, withinSyncBudget } from "@/lib/media/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/media/[id]/transcribe
 *
 * Transcribes a recording that the browser already uploaded to the member's
 * own private folder, using the member's OWN Whisper server. No vendor is
 * called, no audio leaves the operator's machines.
 *
 * Honesty rules enforced here:
 *  - nothing is transcribed unless the row belongs to the caller (RLS read),
 *  - if no local transcription service is configured the member is told so
 *    plainly and the recording stays saved (status untouched, no fake text),
 *  - only text the engine returned is stored; untimed or empty segments are
 *    dropped and the dropped count is reported,
 *  - the status is 'partial' whenever coverage is low or anything was dropped,
 *    so a thin transcript never presents itself as complete.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const user = guard.data.user;

  // RLS-scoped read: a member can only ever load their own recording.
  const { data: asset } = await supabase
    .from("media_assets")
    .select("id, kind, original_filename, mime, byte_size, storage_path, status")
    .eq("id", id)
    .maybeSingle();

  if (!asset) {
    return NextResponse.json({ error: "That recording was not found in your library." }, { status: 404 });
  }
  if (!asset.storage_path) {
    return NextResponse.json(
      { error: "That recording has no uploaded file yet. Upload it again and then start transcription." },
      { status: 409 }
    );
  }

  const cfg = readSelfHostedConfig("asr", process.env);
  if (!cfg.configured) {
    // Never pretend: the file is safe, the service is simply not set up.
    const note = "Transcription needs your own Whisper server. Add SOPHIRA_ASR_URL in Settings, then start transcription again. The recording is saved and unchanged.";
    await supabase.from("media_assets").update({ member_note: note, updated_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ error: note, code: "asr_not_configured", state: "unchanged" }, { status: 501 });
  }

  if (Number(asset.byte_size ?? 0) > MAX_MEDIA_BYTES) {
    const note = `That recording is larger than the ${Math.round(MAX_MEDIA_BYTES / 1024 / 1024)} MB in-browser limit. Process it with the desktop app, which has no upload limit.`;
    return NextResponse.json({ error: note, code: "too_large", state: "unchanged" }, { status: 413 });
  }

  await supabase
    .from("media_assets")
    .update({ status: "transcribing", error_code: null, member_note: "Transcribing now. This takes a few minutes for a long recording.", updated_at: new Date().toISOString() })
    .eq("id", id);

  const fail = async (code: string, memberNote: string, httpStatus = 200) => {
    await supabase
      .from("media_assets")
      .update({ status: "failed", error_code: code, member_note: memberNote, updated_at: new Date().toISOString() })
      .eq("id", id);
    return NextResponse.json({ error: memberNote, code, state: "failed" }, { status: httpStatus });
  };

  // Download the member's own object with the service client (storage only;
  // the row itself was already authorized by RLS above).
  let bytes: Uint8Array;
  try {
    const admin = createAdminClient();
    const { data: blob, error } = await admin.storage.from("private-docs").download(asset.storage_path as string);
    if (error || !blob) {
      return await fail("storage_unavailable", "Sophira could not read the stored recording. Please upload it again.", 503);
    }
    bytes = new Uint8Array(await blob.arrayBuffer());
  } catch {
    return await fail("storage_unavailable", "Sophira could not read the stored recording. Please upload it again.", 503);
  }

  let result;
  try {
    result = await transcribeMedia(bytes, String(asset.original_filename ?? "recording"), String(asset.mime ?? ""), {
      timeoutMs: 240_000,
    });
  } catch {
    return await fail("service_error", "Your Whisper server did not answer. Check that it is running, then try again. The recording is still saved.");
  }

  if (!result.ok) {
    return await fail(
      result.engine === "none" ? "asr_unreachable" : "no_speech",
      result.notes || "Sophira could not transcribe this recording. Nothing was invented."
    );
  }

  if (!withinSyncBudget(result.durationSec)) {
    return await fail(
      "too_long_for_browser",
      `This recording is ${Math.round((result.durationSec ?? 0) / 60)} minutes long. In-browser transcription is limited to ${MEDIA_LIMITS.maxSyncDurationSec / 60} minutes; use the desktop app for longer lectures. Nothing was stored.`
    );
  }

  const mapped = transcriptRowFor(result, { assetId: id, userId: user.id });

  const { data: transcript, error: tErr } = await supabase
    .from("media_transcripts")
    .insert({
      asset_id: id,
      user_id: user.id,
      engine: result.engine,
      model: result.model ?? "",
      language: result.language,
      coverage: mapped.coverage,
      confidence: mapped.confidence,
      member_note: mapped.memberNote,
    })
    .select("id")
    .single();

  if (tErr || !transcript?.id) {
    return await fail("store_failed", "The transcript was produced but could not be saved. Please try again.");
  }

  const transcriptId = String(transcript.id);
  const withTranscript = mapped.rows.map((r) => ({ ...r, transcript_id: transcriptId }));

  // Batched insert: a 20-minute lecture can produce hundreds of segments.
  for (let i = 0; i < withTranscript.length; i += 200) {
    const batch = withTranscript.slice(i, i + 200);
    const { error: sErr } = await supabase.from("media_segments").insert(batch);
    if (sErr) {
      return await fail("segments_failed", "Part of the transcript could not be saved, so Sophira stopped rather than show you an incomplete transcript.");
    }
  }

  await supabase
    .from("media_assets")
    .update({
      status: mapped.status,
      duration_sec: result.durationSec,
      member_note: mapped.memberNote,
      error_code: mapped.dropped > 0 ? "segments_dropped" : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({
    data: {
      state: mapped.status,
      transcriptId,
      segments: withTranscript.length,
      dropped: mapped.dropped,
      coverage: mapped.coverage,
      confidence: mapped.confidence,
      durationSec: result.durationSec,
      language: result.language,
      engine: result.engine,
      speakers: result.speakers,
      memberNote: mapped.memberNote,
    },
  });
}
