import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/supabase/guard";
import type { Invitation, NetworkMemberStats } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only, privacy-safe network analytics (workflow §22).
 *
 * Returns membership metadata ONLY: names, roles, status, created/last-active
 * timestamps, aggregate assignment/response counts, and subject usage counts.
 * It never returns another user's academic content — that stays protected by
 * the per-user RLS policies on every content table.
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
  const supabase = createClient();
  const guard = await requireOwner(supabase);
  if (!guard.ok) return guard.response;

  const { data: members, error } = await supabase.rpc("network_stats");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: invitations } = await supabase
    .from("invitations")
    .select("*")
    .order("created_at", { ascending: false });

  return NextResponse.json({
    data: {
      members: (members || []) as NetworkMemberStats[],
      invitations: (invitations || []) as Invitation[],
    },
  });
}
