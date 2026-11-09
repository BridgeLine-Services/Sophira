import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Permanent account deletion: removes the auth user (all academic data
 * cascades with it — profiles, courses, teachers, assignments, files, responses).
 * The client signs the user out afterwards.
 */
export async function POST() {
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
  // Full authorization chain: authenticated -> ACTIVE access -> own resource.
  // A revoked user must not be able to call account deletion directly.
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const user = guard.data.user;

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return NextResponse.json({ error: `Could not delete the account: ${error.message}` }, { status: 500 });

  return NextResponse.json({ data: { ok: true } });
}
