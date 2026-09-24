import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Permanent account deletion: removes the auth user (all academic data
 * cascades with it — profiles, courses, teachers, assignments, files, responses).
 * The client signs the user out afterwards.
 */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return NextResponse.json({ error: `Could not delete the account: ${error.message}` }, { status: 500 });

  return NextResponse.json({ data: { ok: true } });
}
