import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { needsRefresh } from "@/lib/integrations/oauth-state";
import { microsoftConfigured, verifyDrive, refreshAccessToken } from "@/lib/integrations/microsoft";
import { getConnection, updateTokens } from "@/lib/integrations/connections";

/**
 * GET /api/integrations/microsoft/status — honest connection state for the
 * signed-in user. 'connected' means tokens exist; 'verified' means a REAL
 * provider call just succeeded (or the token was refreshed and verified).
 * Token values are NEVER returned — only statuses and a display label.
 */
export async function GET() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  if (!microsoftConfigured()) {
    return NextResponse.json({ ok: true, configured: false, connected: false, verified: false });
  }
  let conn = await getConnection(guard.data.user.id, "microsoft");
  if (!conn) {
    return NextResponse.json({ ok: true, configured: true, connected: false, verified: false });
  }
  let accessToken = conn.access_token;
  if (needsRefresh(conn.expires_at, Date.now()) && conn.refresh_token) {
    try {
      const fresh = await refreshAccessToken(conn.refresh_token);
      accessToken = fresh.access_token;
      await updateTokens(guard.data.user.id, "microsoft", fresh.access_token, fresh.expires_at);
    } catch {
      // Expired/revoked: the row stays (user can reconnect); status is honest.
      return NextResponse.json({ ok: true, configured: true, connected: true, verified: false, expired: true });
    }
  }
  const { ok: verified, label } = await verifyDrive(accessToken);
  return NextResponse.json({ ok: true, configured: true, connected: true, verified, expired: !verified && !needsRefresh(conn.expires_at, Date.now()), account: label });
}
