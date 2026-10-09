import { NextResponse, type NextRequest } from "next/server";
import { publicSupabaseUrl, serviceRoleKey } from "../../../lib/supabase-config";
import { createClient } from "../../../lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { callDbFunction, privilegedChannelConfigured, provisionSignedInUser, ensureAuthRedirectConfig } from "../../../lib/db-privileged";

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
/**
 * GET = SERVER-VERIFIED owner/account state for the CURRENT session.
 * The first-owner flow never routes on a browser guess: after signup the
 * client asks the server what actually exists (auth user? profile? role?)
 * and only navigates to /owner when the server confirms role === "owner".
 * Returns only categorical state about the CALLER'S OWN account - never
 * another user's existence, never emails or secret material.
 */
export async function GET() {
  const supabase = createClient();
  let user;
  try {
    ({ data: { user } } = await supabase.auth.getUser());
  } catch {
    // Degraded deployment (crash-audit 2026-10-07): honest "cannot check"
    // instead of a 500 — the client keeps its not-authenticated shape and
    // the POST path reports the unavailability when it matters.
    return NextResponse.json({ authenticated: false, hasProfile: false, role: null, unavailable: true });
  }
  if (!user) {
    return NextResponse.json({ authenticated: false, hasProfile: false, role: null });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return NextResponse.json({
    authenticated: true,
    hasProfile: !!profile,
    role: profile?.role ?? null,
  });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  let user;
  try {
    ({ data: { user } } = await supabase.auth.getUser());
  } catch {
    // Degraded deployment (crash-audit 2026-10-07): honest 503, never a 500.
    return NextResponse.json(
      { error: "Sophira cannot reach its database right now. Please try again later." },
      { status: 503 }
    );
  }
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = publicSupabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) {
    return NextResponse.json(
      { error: "The server is missing its database access configuration." },
      { status: 503 }
    );
  }
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 2026-10-08 SELF-HEALING PROVISIONING (owner's blank/looping account
  // diagnosis): the account exists, its profile row exists on the direct
  // channel, yet every RLS-scoped read returns nothing. The complete-owner
  // call therefore now repairs instead of only claiming:
  //   profile present -> RLS policy/grant refresh (invisible-row fix);
  //   owner row orphaned -> re-linked to this verified account;
  //   no owner anywhere -> the race-safe first-owner claim;
  //   owner belongs to a different REAL account -> honest 409.
  // The user id is the SERVER-verified session id; the repair runs over
  // the verified direct channel, never from browser input.
  if (privilegedChannelConfigured()) {
    // PASSWORD-RESET LINK FIX (fire-and-forget): corrects the Supabase Auth
    // Site URL / redirect allow-list when they point at a dead domain.
    void ensureAuthRedirectConfig();
    const res = await provisionSignedInUser(user.id);
    if (res.ok) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      return NextResponse.json({ completed: true, hasProfile: !!profile, role: profile?.role ?? null, action: res.action });
    }
    // v2 (2026-10-08): the repair matrix now backfills the profile for
    // EVERY legitimate signed-in account, so the only remaining failure is
    // an unavailable database channel — honest 503, never a fake success.
    return NextResponse.json(
      { error: "Sophira cannot reach its database right now. Please try again later." },
      { status: 503 }
    );
  }
  // Fallback for deployments with a valid service key but no direct channel.
  const { error } = await admin.rpc("complete_first_owner", { p_user_id: user.id });
  if (!error) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    return NextResponse.json({ completed: true, hasProfile: !!profile, role: profile?.role ?? null });
  }
  if (error) {
    // Categorical, honest, never leaks other accounts:
    // "owner exists" / "claim lost the race" / "profile already exists".
    return NextResponse.json({ error: "Owner creation is closed or was just claimed by another registration." }, { status: 409 });
  }
  return NextResponse.json({ completed: true });
}
