import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { getConnection, updateTokens } from "@/lib/integrations/connections";
import { googleConfigured, listAppCreatedFiles, listAllAccessibleFiles, refreshAccessToken } from "@/lib/integrations/google";
import { needsRefresh } from "@/lib/integrations/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/google/files — honest about what drive.file
 * permits: by default ONLY files created through Sophira are listed.
 * Full browsing (including files shared with the user) requires the
 * OPTIONAL drive.readonly consent granted through the browse intent —
 * never silently broadened.
 */
export async function GET(_request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  if (!googleConfigured()) return NextResponse.json({ ok: false, error: "Google integration is not configured in this deployment yet." }, { status: 503 });
  const conn = await getConnection(guard.data.user.id, "google");
  if (!conn) return NextResponse.json({ ok: false, error: "No Google account is connected for your user yet. Connect one first." }, { status: 400 });
  let accessToken = conn.access_token;
  if (needsRefresh(conn.expires_at, Date.now()) && conn.refresh_token) {
    try {
      const fresh = await refreshAccessToken(conn.refresh_token);
      accessToken = fresh.access_token;
      await updateTokens(guard.data.user.id, "google", fresh.access_token, fresh.expires_at);
    } catch {
      return NextResponse.json({ ok: false, error: "The Google connection has expired or was revoked. Reconnect it in Settings → Integrations." }, { status: 401 });
    }
  }
  const granted = conn.granted_scopes ?? "";
  const canBrowse = granted.includes("drive.readonly") || /\/auth\/drive($| )/.test(granted);
  const listing = canBrowse ? await listAllAccessibleFiles(accessToken) : await listAppCreatedFiles(accessToken);
  return NextResponse.json({
    ok: listing.ok,
    files: listing.files,
    note: listing.note,
    browse_enabled: canBrowse,
    browse_consent_url: canBrowse ? null : "/api/integrations/google/authorize?intent=browse",
  }, { status: listing.ok ? 200 : 502 });
}
