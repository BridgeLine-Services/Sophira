import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { getConnection, updateTokens } from "@/lib/integrations/connections";
import { microsoftConfigured, downloadDriveItem, refreshAccessToken } from "@/lib/integrations/microsoft";
import { needsRefresh } from "@/lib/integrations/oauth-state";
import { eligibilityFor } from "@/lib/integrations/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/microsoft/file-content?id=...&mime=...&drive=... —
 * reads a file's TEXT through the SIGNED-IN user's own connection for
 * read-only assistance. Listing, reading, and writing are separate states;
 * this route never claims write access, and provider refusals are honest.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  if (!microsoftConfigured()) return NextResponse.json({ ok: false, error: "Microsoft integration is not configured in this deployment yet." }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const mime = params.get("mime") ?? "";
  const drive = params.get("drive");
  if (!id) return NextResponse.json({ ok: false, error: "A file id is required." }, { status: 400 });
  const eligible = eligibilityFor(mime);
  if (!eligible.readable_text) return NextResponse.json({ ok: false, error: `This file cannot be read as text yet: ${eligible.reason}.` }, { status: 415 });
  const conn = await getConnection(guard.data.user.id, "microsoft");
  if (!conn) return NextResponse.json({ ok: false, error: "No Microsoft account is connected for your user yet." }, { status: 400 });
  let accessToken = conn.access_token;
  if (needsRefresh(conn.expires_at, Date.now()) && conn.refresh_token) {
    try {
      const fresh = await refreshAccessToken(conn.refresh_token);
      accessToken = fresh.access_token;
      await updateTokens(guard.data.user.id, "microsoft", fresh.access_token, fresh.expires_at);
    } catch {
      return NextResponse.json({ ok: false, error: "The Microsoft connection has expired or was revoked. Reconnect it." }, { status: 401 });
    }
  }
  const dl = await downloadDriveItem(accessToken, id, drive || null);
  if (!dl.ok || !dl.bytes) return NextResponse.json({ ok: false, error: dl.error ?? "The file could not be read." }, { status: 502 });
  try {
    const mammoth = (await import("mammoth")) as typeof import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: dl.bytes });
    return NextResponse.json({ ok: true, text: value, access_state: "read" });
  } catch {
    return NextResponse.json({ ok: false, error: "The document's text could not be extracted (unsupported or corrupted file). A downloadable copy is available instead." }, { status: 415 });
  }
}
