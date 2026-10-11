import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { getConnection, updateTokens } from "@/lib/integrations/connections";
import { googleConfigured, readGoogleFileText, refreshAccessToken } from "@/lib/integrations/google";
import { needsRefresh } from "@/lib/integrations/oauth-state";
import { eligibilityFor } from "@/lib/integrations/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/google/file-content?id=...&mime=... — reads a
 * Google Doc (or plain-text file) as text through the SIGNED-IN user's own
 * connection, for read-only assistance. Read access is never reported as
 * write access; provider refusals are honest errors.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  if (!googleConfigured()) return NextResponse.json({ ok: false, error: "Google integration is not configured in this deployment yet." }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const mime = params.get("mime") ?? "";
  if (!id) return NextResponse.json({ ok: false, error: "A file id is required." }, { status: 400 });
  const eligible = eligibilityFor(mime);
  if (!eligible.readable_text) return NextResponse.json({ ok: false, error: `This file cannot be read as text yet: ${eligible.reason}.` }, { status: 415 });
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
  const read = await readGoogleFileText(accessToken, id, mime);
  return read.ok
    ? NextResponse.json({ ok: true, text: read.text, access_state: "read" })
    : NextResponse.json({ ok: false, error: read.error ?? "The document could not be read." }, { status: 502 });
}
