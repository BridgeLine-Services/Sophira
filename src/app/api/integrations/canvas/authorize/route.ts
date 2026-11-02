import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { createState, STATE_COOKIE, STATE_MAX_AGE_SECONDS } from "@/lib/integrations/oauth-state";
import { canvasAuthorizeUrl, canvasConfigured, normalizeInstanceUrl } from "@/lib/integrations/canvas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/canvas/authorize — starts Canvas OAuth for the
 * signed-in student only.
 *
 * The Canvas instance comes from the SERVER environment (CANVAS_BASE_URL), never
 * from the request: accepting a client-supplied origin here would let anyone
 * point Sophira's token exchange at a server they control (SSRF + token theft).
 * The student therefore sees one button, not an instance picker.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  if (!canvasConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        missing: "CANVAS_CONFIG",
        error:
          "Canvas is not set up for this school's Sophira yet. An administrator needs to add the Canvas connection details in the hosting settings (see docs/CANVAS_INTEGRATION.md). Nothing is broken — everything else keeps working.",
      },
      { status: 503 }
    );
  }

  const baseUrl = normalizeInstanceUrl(process.env.CANVAS_BASE_URL);
  if (!baseUrl) {
    return NextResponse.json(
      {
        ok: false,
        missing: "CANVAS_BASE_URL",
        error: "The Canvas address saved for this school is not a valid secure https address, so Sophira stopped instead of sending you somewhere unsafe.",
      },
      { status: 503 }
    );
  }

  const state = createState();
  const redirectUri = new URL(request.url).origin + "/api/integrations/canvas/callback";
  const url = canvasAuthorizeUrl(baseUrl, process.env.CANVAS_CLIENT_ID!, redirectUri, state);

  const res = NextResponse.json({ ok: true, url, instance: baseUrl });
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: STATE_MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
