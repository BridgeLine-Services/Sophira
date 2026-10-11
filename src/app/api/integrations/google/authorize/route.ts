import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createState, googleAuthorizeUrl, STATE_COOKIE, STATE_MAX_AGE_SECONDS } from "@/lib/integrations/oauth-state";
import { googleConfigured } from "@/lib/integrations/google";

/**
 * POST /api/integrations/google/authorize — starts the OAuth flow for the
 * signed-in user ONLY. Returns the provider's real authorization URL plus an
 * httpOnly state cookie (CSRF protection). If the provider is not configured
 * in this deployment, the response says so honestly instead of faking a link.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  if (!googleConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        missing: "GOOGLE_CONFIG",
        error:
          "This deployment is not set up for this provider yet: the server-side OAuth credentials are missing. Follow docs/WORD_GOOGLE_DOCS_SETUP.md — the values go only in your hosting provider's secure environment settings, never in chat or files.",
      },
      { status: 503 },
    );
  }
  const state = createState();
  const redirectUri = new URL(request.url).origin + "/api/integrations/google/callback";
  // Incremental consent (2026-10-12): ONLY when the user explicitly enables
  // Drive browsing does the flow request the additional read-only scope.
  // The default flow stays at the least-privilege drive.file.
  const intent = new URL(request.url).searchParams.get("intent");
  const extraScopes = intent === "browse" ? ["https://www.googleapis.com/auth/drive.readonly"] : [];
  const url = googleAuthorizeUrl(process.env.GOOGLE_CLIENT_ID!, redirectUri, state, extraScopes);
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
