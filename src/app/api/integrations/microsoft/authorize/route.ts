import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createState, microsoftAuthorizeUrl, STATE_COOKIE, STATE_MAX_AGE_SECONDS } from "@/lib/integrations/oauth-state";
import { microsoftConfigured } from "@/lib/integrations/microsoft";

/**
 * POST /api/integrations/microsoft/authorize — starts the OAuth flow for the
 * signed-in user ONLY. Returns the provider's real authorization URL plus an
 * httpOnly state cookie (CSRF protection). If the provider is not configured
 * in this deployment, the response says so honestly instead of faking a link.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  if (!microsoftConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        missing: "MICROSOFT_CONFIG",
        error:
          "This deployment is not set up for this provider yet: the server-side OAuth credentials are missing. Follow docs/WORD_GOOGLE_DOCS_SETUP.md — the values go only in your hosting provider's secure environment settings, never in chat or files.",
      },
      { status: 503 },
    );
  }
  const state = createState();
  const redirectUri = new URL(request.url).origin + "/api/integrations/microsoft/callback";
  const url = microsoftAuthorizeUrl(process.env.MICROSOFT_CLIENT_ID!, redirectUri, state);
  const res = NextResponse.json({ ok: true, url });
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: STATE_MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
