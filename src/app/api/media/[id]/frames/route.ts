import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/guard";
import { ocrImage } from "@/lib/extract/ocr";
import {
  classifyFrame,
  dedupeFrame,
  frameConfidence,
  frameNote,
  frameRowFor,
  samplingSummary,
  textFingerprint,
  validateFrameUpload,
} from "@/lib/media/frames";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET  /api/media/[id]/frames  - what has already been read from this recording.
 * POST /api/media/[id]/frames  - submit ONE sampled still (multipart: image + at_sec).
 *
 * Why one frame per request: the browser reads the video it already has, so no
 * server-side ffmpeg is needed, each request stays small, and a failure half way
 * through sampling never loses the frames already read.
 *
 * Honesty rules:
 *  - only frames the owner's own asset produced are accepted (RLS read first),
 *  - an unreadable frame is stored with EMPTY text and a plain reason, never a guess,
 *  - identical recognised text is deduplicated and the duplicate is reported,
 *  - the frame limit is enforced with its real number in the message.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const { data: asset } = await supabase.from("media_assets").select("id").eq("id", id).maybeSingle();
  if (!asset) return NextResponse.json({ error: "That recording was not found in your library." }, { status: 404 });

  const { data: rows } = await supabase
    .from("media_frames")
    .select("id, at_sec, recognised_text, frame_kind, confidence, member_note")
    .eq("asset_id", id)
    .order("at_sec", { ascending: true });

  return NextResponse.json({ data: { frames: rows ?? [], count: (rows ?? []).length } });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const user = guard.data.user;

  // RLS read: a member can only add frames to their own recording.
  const { data: asset } = await supabase
    .from("media_assets")
    .select("id, frames_sampled")
    .eq("id", id)
    .maybeSingle();
  if (!asset) return NextResponse.json({ error: "That recording was not found in your library." }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a sampled image and a time." }, { status: 400 });
  }

  const image = form.get("frame");
  if (!(image instanceof File)) {
    return NextResponse.json({ error: "No sampled frame was attached." }, { status: 400 });
  }
  const atSecRaw = Number(form.get("at_sec"));
  const atSec = Number.isFinite(atSecRaw) ? atSecRaw : Number.NaN;

  const existingCount = Number(asset.frames_sampled ?? 0);
  const check = validateFrameUpload({ mime: image.type, byteSize: image.size, atSec, existingCount });
  if (!check.ok) {
    return NextResponse.json({ error: check.memberNote, code: check.code }, { status: 400 });
  }

  const bytes = Buffer.from(await image.arrayBuffer());

  // Read the frame with the member's own OCR service (no cloud vision, no vendor).
  const ocr = await ocrImage(bytes, image.type || "image/jpeg", { timeoutMs: 30_000 });
  const text = ocr.ok ? ocr.text.trim() : "";
  const kind = classifyFrame({ text, meanConfidence: ocr.meanConfidence, ok: ocr.ok });
  const confidence = frameConfidence({ ok: ocr.ok, text, meanConfidence: ocr.meanConfidence });

  // Deduplicate against frames already stored for this recording.
  const { data: priorFrames } = await supabase
    .from("media_frames")
    .select("at_sec, recognised_text")
    .eq("asset_id", id);
  const fingerprint = textFingerprint(text);
  const prior = (priorFrames ?? []).map((f) => ({
    atSec: Number(f.at_sec),
    fingerprint: textFingerprint(String(f.recognised_text ?? "")),
  }));
  const dup = dedupeFrame({ fingerprint }, prior);

  if (dup.duplicate) {
    return NextResponse.json({
      data: {
        duplicate: true,
        duplicateOfAtSec: dup.duplicateOfAtSec,
        text: "",
        kind,
        confidence,
        memberNote: `Same slide as the frame at ${Math.floor((dup.duplicateOfAtSec ?? 0) / 60)}:${String(Math.floor((dup.duplicateOfAtSec ?? 0) % 60)).padStart(2, "0")}, so it was not stored twice.`,
      },
    });
  }

  // Keep the still privately so the member can check what was read.
  let storagePath = "";
  try {
    const admin = createAdminClient();
    const ext = image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
    const path = `${user.id}/media/${id}/frames/${Math.round(atSec * 10)}.${ext}`;
    const { error: upErr } = await admin.storage.from("private-docs").upload(path, bytes, {
      contentType: image.type || "image/jpeg",
      upsert: true,
    });
    if (!upErr) storagePath = path;
  } catch {
    /* the still is a convenience: the recognised text is still useful without it */
  }

  const note = frameNote(kind, confidence, text.length);
  const row = frameRowFor({
    assetId: id,
    userId: user.id,
    atSec,
    storagePath,
    text,
    kind,
    confidence,
    memberNote: ocr.ok ? note : ocr.notes || note,
  });

  const { data: inserted, error } = await supabase.from("media_frames").insert(row).select("id, at_sec").single();
  if (error) {
    return NextResponse.json(
      { error: "Sophira read this frame but could not save it. Please try again." },
      { status: 500 }
    );
  }

  await supabase
    .from("media_assets")
    .update({ frames_sampled: existingCount + 1, updated_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({
    data: {
      duplicate: false,
      frameId: inserted?.id ?? null,
      atSec: row.at_sec,
      text,
      kind,
      confidence,
      memberNote: row.member_note,
      storageKept: Boolean(storagePath),
      summary: samplingSummary({
        stored: existingCount + 1,
        duplicates: 0,
        unreadable: text.length === 0 ? 1 : 0,
      }),
    },
  });
}
