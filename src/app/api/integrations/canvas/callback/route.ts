import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { verifyState, STATE_COOKIE } from "@/lib/integrations/oauth-state";
import { exchangeCode, verifyProfile, normalizeInstanceUrl, CANVAS_SCOPES } from "@/lib/integrations/canvas";
import { upsertConnection, saveConnectionMeta } from "@/lib/integrations/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/canvas/callback — completes the Canvas connection.
 *
 * Checks, in order: signed-in student, CSRF state matches the httpOnly cookie,
 * consent not denied, code present. Tokens are exchanged server-side and stored
 * only for that student. The account label is captured from a REAL Canvas
 * response (verifyProfile), never from the callback query string, so a tampered
 * callback cannot relabel a connection.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const sp = new URL(request.url).searchParams;
  const back = (status: string) => {
    const res = NextResponse.redirect(
      new URL(`/settings/integrations?canvas=${status}`, request.url)
    );
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  if (sp.get("error")) return back("denied");

  const code = sp.get("code") ?? "";
  const state = sp.get("state") ?? "";
  if (!code || !verifyState(request.cookies.get(STATE_COOKIE)?.value, state)) {
    return back("state-mismatch");
  }

  const baseUrl = normalizeInstanceUrl(process.env.CANVAS_BASE_URL);
  const clientId = process.env.CANVAS_CLIENT_ID;
  const clientSecret = process.env.CANVAS_CLIENT_SECRET;
  if (!baseUrl || !clientId || !clientSecret) return back("not-configured");

  try {
    const redirectUri = new URL(request.url).origin + "/api/integrations/canvas/callback";
    const tokens = await exchangeCode(baseUrl, clientId, clientSecret, code, redirectUri);

    // Real provider call: only claim "connected" if Canvas answers as this student.
    const profile = await verifyProfile(baseUrl, tokens.access_token);
    if (!profile.ok) return back("verification-failed");

    await upsertConnection(guard.data.user.id, "canvas", {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at,
      granted_scopes: CANVAS_SCOPES.join(" "),
      base_url: baseUrl,
    });
    await saveConnectionMeta(guard.data.user.id, "canvas", {
      account_label: profile.label,
      provider_account_id: profile.userId,
    });
    await supabase.from("canvas_sync_events").insert({
      user_id: guard.data.user.id,
      kind: "connected",
      detail: { instance: baseUrl },
    });

    return back("connected");
  } catch {
    // Never leak provider error bodies or tokens into the redirect.
    return back("error");
  }
}
