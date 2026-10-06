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
  const supabase = createClient();
  const guard = await requireOwner(supabase);
  if (!guard.ok) return guard.response;
  return NextResponse.json(startupDiagnostics(readAiEnv()));
}
