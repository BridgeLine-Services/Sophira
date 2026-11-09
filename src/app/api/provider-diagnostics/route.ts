import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/supabase/guard";
import { readAiEnv } from "@/lib/ai/provider";
import { startupDiagnostics } from "@/lib/ai/capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * STARTUP DIAGNOSTIC (2026-10-06). Owner-guarded. Returns ONLY:
 *   configured_provider, configured_model, local_model_availability,
 *   free_tier_mode, paid_ai_allowed
 * Never API keys, never secret values, never extra fields.
 */
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Missing configuration NEVER 500s (crash-safety contract): a public
    // route must degrade to an honest, categorical 503 with a plain-English
    // message, not a server error (regression test: tests, middleware §).
    return Response.json(
      { ok: false, reason: "unavailable", message: "Sophira isn't connected to its database yet. The setup page (/setup) explains exactly what is missing." },
      { status: 503 },
    );
  }
  const supabase = await createClient();
  const guard = await requireOwner(supabase);
  if (!guard.ok) return guard.response;
  return NextResponse.json(startupDiagnostics(readAiEnv()));
}
