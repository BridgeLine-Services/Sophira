import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";

/**
 * GET /api/media/[id]/stream
 *
 * Hands the member a short-lived link to their own recording inside the private
 * bucket. The player needs a URL it can seek, and the bytes must never be public,
 * so the link is signed, expires quickly, and is only issued after a
 * row-level-security read confirms the asset belongs to the caller.
 *
 * The bucket name and object path come from the database, never from the
 * request, so a member cannot ask for somebody else's file by guessing a path.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  // RLS-scoped: an asset belonging to anyone else simply is not there.
  const { data: asset } = await supabase
    .from("media_assets")
    .select("id, storage_path, mime")
    .eq("id", id)
    .maybeSingle();
  if (!asset || !asset.storage_path) {
    return NextResponse.json({ error: "That recording was not found in your library." }, { status: 404 });
  }

  const { data: signed, error } = await supabase.storage
    .from("private-docs")
    .createSignedUrl(asset.storage_path, 600);

  if (error || !signed?.signedUrl) {
    return NextResponse.json(
      { error: "Sophira could not open that recording just now. Try again in a moment." },
      { status: 503 },
    );
  }

  return NextResponse.json({
    data: { url: signed.signedUrl, mime: asset.mime, expiresInSeconds: 600 },
  });
}
