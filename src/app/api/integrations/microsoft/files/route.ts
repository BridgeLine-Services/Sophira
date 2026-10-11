import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { getConnection, updateTokens } from "@/lib/integrations/connections";
import { microsoftConfigured, listDriveFiles, refreshAccessToken } from "@/lib/integrations/microsoft";
import { needsRefresh } from "@/lib/integrations/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/microsoft/files — lists documents the SIGNED-IN
 * user's own connection can see (their own files + files explicitly shared
 * with that account, where the tenant permits). Listed is NEVER the same
 * as writable; tenant restrictions surface as honest notes, never as an
 * empty "connected" list.
 */
export async function GET() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  if (!microsoftConfigured()) return NextResponse.json({ ok: false, error: "Microsoft integration is not configured in this deployment yet." }, { status: 503 });
  const conn = await getConnection(guard.data.user.id, "microsoft");
  if (!conn) return NextResponse.json({ ok: false, error: "No Microsoft account is connected for your user yet. Connect one first." }, { status: 400 });
  let accessToken = conn.access_token;
  if (needsRefresh(conn.expires_at, Date.now()) && conn.refresh_token) {
    try {
      const fresh = await refreshAccessToken(conn.refresh_token);
      accessToken = fresh.access_token;
      await updateTokens(guard.data.user.id, "microsoft", fresh.access_token, fresh.expires_at);
    } catch {
      return NextResponse.json({ ok: false, error: "The Microsoft connection has expired or was revoked. Reconnect it in Settings → Integrations." }, { status: 401 });
    }
  }
  const listing = await listDriveFiles(accessToken);
  return NextResponse.json({ ok: listing.ok, files: listing.files, note: listing.note }, { status: listing.ok ? 200 : 502 });
}
