import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { verifyState, STATE_COOKIE } from "@/lib/integrations/oauth-state";
import { exchangeCode as exchangeCode, } from "@/lib/integrations/microsoft";
import { upsertConnection } from "@/lib/integrations/connections";

/**
 * GET /api/integrations/microsoft/callback — completes the OAuth flow.
 * The state cookie MUST match (CSRF); consent denial is reported honestly;
 * tokens are exchanged server-side and stored ONLY for the signed-in user.
 * Nothing sensitive is ever included in the redirect URL.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const sp = new URL(request.url).searchParams;
  const back = (status: string) => {
    const res = NextResponse.redirect(new URL(`/settings/integrations?microsoft=${status}`, request.url));
    res.cookies.delete(STATE_COOKIE);
    return res;
  };
  if (sp.get("error")) return back("denied");
  const code = sp.get("code") ?? "";
  const state = sp.get("state") ?? "";
  if (!code || !verifyState(request.cookies.get(STATE_COOKIE)?.value, state)) return back("state-mismatch");
  try {
    const redirectUri = new URL(request.url).origin + "/api/integrations/microsoft/callback";
    const tokens = await exchangeCode(code, redirectUri);
    await upsertConnection(guard.data.user.id, "microsoft", {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at,
    });
    return back("connected");
  } catch {
    return back("error");
  }
}
