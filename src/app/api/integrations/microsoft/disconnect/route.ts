import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { deleteConnection } from "@/lib/integrations/connections";

/**
 * POST /api/integrations/microsoft/disconnect — removes the stored tokens
 * for the signed-in user immediately. (Revoking at the provider is the
 * user's account action; the setup guide documents the exact links.)
 */
export async function POST() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  try {
    await deleteConnection(guard.data.user.id, "microsoft");
    return NextResponse.json({ ok: true, disconnected: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Could not disconnect." }, { status: 500 });
  }
}
