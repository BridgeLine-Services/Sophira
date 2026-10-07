import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * FIRST-OWNER COMPLETION for a STALE auth account (2026-10-07).
 *
 * Scenario: an earlier broken attempt left a REAL Supabase Auth user
 * whose profile row was never created (e.g. the pre-0025 trigger
 * rejected it, or the trigger was missing). Signup then fails with
 * "already registered" - a dead end without this endpoint.
 *
 * SECURITY:
 *   - requires the caller's own authenticated session (Supabase Auth
 *     stays the source of truth for credentials; nothing is created for
 *     an email the caller cannot sign in with);
 *   - the completion itself happens in the DATABASE function
 *     public.complete_first_owner (migration 0026): atomic single-row
 *     claim, refuses when any owner exists, refuses when the account
 *     already has a profile - a race can never create a second owner;
 *   - the service-role client is used ONLY to invoke that function with
 *     the caller's own verified user id, and NEVER reaches the browser.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "The server is missing its database access configuration." },
      { status: 503 }
    );
  }
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await admin.rpc("complete_first_owner", { p_user_id: user.id });
  if (error) {
    // Categorical, honest, never leaks other accounts:
    // "owner exists" / "claim lost the race" / "profile already exists".
    return NextResponse.json({ error: "Owner creation is closed or was just claimed by another registration." }, { status: 409 });
  }
  return NextResponse.json({ completed: true });
}
