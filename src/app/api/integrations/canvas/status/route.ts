import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { needsRefresh } from "@/lib/integrations/oauth-state";
import {
  canvasConfigured,
  verifyProfile,
  refreshAccessToken,
  normalizeInstanceUrl,
} from "@/lib/integrations/canvas";
import { getConnection, updateTokens } from "@/lib/integrations/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/canvas/status — honest, plain-language state for the
 * signed-in student: whether Canvas is configured at this deployment, whether
 * THEIR account is connected, and whether a real Canvas call just succeeded.
 *
 * "connected" only means a token exists. "verified" means Canvas answered for
 * this student moments ago. Never returns a token, and never shows raw API text.
 */
export async function GET() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  if (!canvasConfigured()) {
    return NextResponse.json({ ok: true, configured: false, connected: false, verified: false });
  }

  let conn = await getConnection(guard.data.user.id, "canvas");
  if (!conn) {
    return NextResponse.json({ ok: true, configured: true, connected: false, verified: false });
  }

  const baseUrl = normalizeInstanceUrl(conn.base_url);
  if (!baseUrl) {
    // Row exists but the instance address is unusable: say so instead of guessing.
    return NextResponse.json({
      ok: true, configured: true, connected: true, verified: false,
      expired: false, unverifiedReason: "instance-missing",
    });
  }

  let accessToken = conn.access_token;
  let expired = false;
  if (needsRefresh(conn.expires_at, Date.now()) && conn.refresh_token) {
    try {
      const fresh = await refreshAccessToken(
        baseUrl, process.env.CANVAS_CLIENT_ID!, process.env.CANVAS_CLIENT_SECRET!, conn.refresh_token
      );
      accessToken = fresh.access_token;
      await updateTokens(guard.data.user.id, "canvas", fresh.access_token, fresh.expires_at);
    } catch {
      expired = true;
    }
  }

  const profile = expired ? { ok: false, label: conn.account_label } : await verifyProfile(baseUrl, accessToken);

  const [{ count: courseCount }, { count: assignmentCount }, { count: missingCount }] = await Promise.all([
    supabase.from("canvas_courses").select("id", { count: "exact", head: true }).eq("user_id", guard.data.user.id),
    supabase.from("canvas_assignments").select("id", { count: "exact", head: true })
      .eq("user_id", guard.data.user.id).eq("sync_state", "active"),
    supabase.from("canvas_assignments").select("id", { count: "exact", head: true })
      .eq("user_id", guard.data.user.id).eq("sync_state", "missing"),
  ]);

  const { data: recent } = await supabase
    .from("canvas_sync_events")
    .select("kind, detail, created_at")
    .eq("user_id", guard.data.user.id)
    .order("created_at", { ascending: false })
    .limit(8);

  const lastSync = (recent ?? []).find((e) => e.kind === "sync_completed")?.created_at ?? null;

  return NextResponse.json({
    ok: true,
    configured: true,
    connected: true,
    verified: profile.ok,
    expired,
    accountLabel: profile.label ?? conn.account_label ?? null,
    lastSyncAt: lastSync,
    instance: baseUrl,
    courses: courseCount ?? 0,
    assignments: assignmentCount ?? 0,
    missing: missingCount ?? 0,
    recent: recent ?? [],
  });
}
