import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { needsRefresh } from "@/lib/integrations/oauth-state";
import { canvasConfigured, normalizeInstanceUrl, refreshAccessToken } from "@/lib/integrations/canvas";
import { getConnection, updateTokens } from "@/lib/integrations/connections";
import { runCanvasSync } from "@/lib/integrations/canvas-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A first sync walks every enrolled course; give it room, but keep it bounded.
export const maxDuration = 60;

/**
 * POST /api/integrations/canvas/sync — refreshes this student's own Canvas
 * assignments into Sophira.
 *
 * Safe to call repeatedly: reconciliation is idempotent (planAssignmentSync), so
 * a second run with unchanged Canvas data creates nothing. Writes use the
 * user-scoped client, so RLS — not this code — enforces ownership. Nothing is
 * ever submitted to Canvas.
 */
export async function POST() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  if (!canvasConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Canvas is not set up for this school's Sophira yet." },
      { status: 503 }
    );
  }

  const conn = await getConnection(guard.data.user.id, "canvas");
  if (!conn) {
    return NextResponse.json(
      {
        ok: false,
        connected: false,
        error: "Connect your Canvas account first, then Sophira can find your assignments.",
      },
      { status: 409 }
    );
  }

  const baseUrl = normalizeInstanceUrl(conn.base_url);
  if (!baseUrl) {
    return NextResponse.json(
      { ok: false, error: "The saved Canvas address is not usable. Please reconnect your Canvas account." },
      { status: 409 }
    );
  }

  let accessToken = conn.access_token;
  if (needsRefresh(conn.expires_at, Date.now()) && conn.refresh_token) {
    try {
      const fresh = await refreshAccessToken(
        baseUrl, process.env.CANVAS_CLIENT_ID!, process.env.CANVAS_CLIENT_SECRET!, conn.refresh_token
      );
      accessToken = fresh.access_token;
      await updateTokens(guard.data.user.id, "canvas", fresh.access_token, fresh.expires_at);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          expired: true,
          error: "Canvas needs you to sign in again. Reconnect your account and Sophira will pick up where it left off.",
        },
        { status: 401 }
      );
    }
  }

  const summary = await runCanvasSync(supabase, guard.data.user.id, baseUrl, accessToken);

  // Show the student what actually changed, newest first, without raw payloads.
  const { data: changed } = await supabase
    .from("canvas_assignments")
    .select("title, due_at, sync_state, updated_at, canvas_course_id")
    .eq("user_id", guard.data.user.id)
    .eq("sync_state", "active")
    .order("updated_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    ok: summary.ok,
    message: summary.message,
    courses: summary.courses,
    created: summary.created,
    updated: summary.updated,
    missing: summary.missing,
    restored: summary.restored,
    notices: summary.notices,
    changes: summary.changes,
    recent: changed ?? [],
  });
}
