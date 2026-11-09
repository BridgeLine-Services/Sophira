import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/guard";
import { memberMediaPath, validateMediaUpload } from "@/lib/media/pipeline";

export const runtime = "nodejs";

/**
 * POST /api/media/upload-url
 *
 * Why this exists instead of an upload endpoint: a lecture recording is far
 * larger than a serverless request may carry (about 4.5 MB). The browser
 * therefore uploads the file DIRECTLY into the member's own folder in the
 * private bucket using a short-lived signed URL, and never passes through the
 * application server.
 *
 * Security:
 *  - the caller must be a signed-in, currently-authorized member (requireUser),
 *  - the FILE PATH IS NEVER TAKEN FROM THE CLIENT. It is built here from the
 *    verified user id and a database-generated asset id, so an upload cannot
 *    be aimed at another member's folder or escape it with "../",
 *  - the row is created through the RLS-scoped client, so the database itself
 *    enforces user_id = auth.uid(),
 *  - the signed URL is the only thing the client receives; it expires.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const user = guard.data.user;

  let body: { filename?: string; mime?: string; byteSize?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body describing the recording." }, { status: 400 });
  }

  const check = validateMediaUpload(body);
  if (!check.ok) {
    // Honest, member-facing refusal: nothing was created.
    return NextResponse.json({ error: check.memberNote, code: check.code }, { status: 400 });
  }

  const mime = String(body.mime ?? "").toLowerCase();
  const kind: "video" | "audio" = mime.startsWith("video/") ? "video" : "audio";
  const filename = String(body.filename ?? "recording").replace(/[^\w.\-() ]+/g, "_").slice(0, 120) || "recording";

  const { data: asset, error } = await supabase
    .from("media_assets")
    .insert({
      user_id: user.id,
      kind,
      original_filename: filename,
      mime,
      byte_size: Math.round(Number(body.byteSize)),
      status: "uploaded",
      member_note: "Saved. Start transcription when you are ready.",
    })
    .select("id")
    .single();

  if (error || !asset?.id) {
    return NextResponse.json({ error: "Sophira could not reserve storage for that recording. Please try again." }, { status: 500 });
  }

  const path = memberMediaPath(user.id, String(asset.id), filename, mime);

  const admin = createAdminClient();
  const { data: signed, error: signErr } = await admin.storage.from("private-docs").createSignedUploadUrl(path);

  if (signErr || !signed) {
    // Roll the placeholder row back so a failed upload leaves nothing behind.
    await supabase.from("media_assets").delete().eq("id", asset.id);
    return NextResponse.json({ error: "Sophira could not prepare the upload right now. Please try again." }, { status: 503 });
  }

  await supabase.from("media_assets").update({ storage_path: path, updated_at: new Date().toISOString() }).eq("id", asset.id);

  return NextResponse.json({
    data: {
      assetId: asset.id,
      bucket: "private-docs",
      path,
      token: signed.token,
      // The browser uploads to this URL directly; it is short-lived.
      signedUrl: signed.signedUrl,
      expiresInSeconds: 120,
    },
  });
}
