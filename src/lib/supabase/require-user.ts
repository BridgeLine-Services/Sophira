import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * SINGLE shared server-side session validation for protected pages
 * (redirect-loop fix 2026-10-08).
 *
 * Every guarded server page (dashboard, owner, ...) MUST get its user
 * through this function — never a bare `getUser()` + `redirect("/login")`.
 * The old per-page pattern was the redirect war: the middleware bounced an
 * authenticated user from /login to /dashboard while the page bounced the
 * SAME request to /login because ITS getUser() failed on a stale, expired,
 * or corrupt auth cookie — producing ERR_TOO_MANY_REDIRECTS, with deleting
 * the site's cookies as the only escape.
 *
 * Self-heal: when the session is missing/invalid/unparseable, the stale
 * Supabase auth cookies are CLEARED (same names, same path the ssr client
 * set them with) BEFORE the single redirect to /login — so the browser
 * arrives at /login with no session at all and the middleware can never
 * bounce it back. One hop, loop impossible by construction.
 */
export async function requireUser(supabase: SupabaseClient): Promise<User> {
  let user: User | null = null;
  try {
    ({ data: { user } } = await supabase.auth.getUser());
  } catch {
    user = null; // unreachable/misbehaving auth server: treated as not signed in
  }
  if (user) return user;
  try {
    const store = cookies();
    for (const { name } of store.getAll()) {
      if (name.startsWith("sb-") && name.includes("auth-token")) {
        // Same name/path supabase-ssr used when setting — guarantees deletion.
        store.set(name, "", { path: "/", maxAge: 0 });
      }
    }
  } catch {
    // Read-only cookie context: middleware handles propagation.
  }
  redirect("/login");
}

export interface ProfileRow {
  id: string;
  role: string;
  status?: string | null;
  onboarded?: boolean | null;
  display_name?: string | null;
  [key: string]: unknown;
}
/**
 * SELF-HEALING PROFILE READ (2026-10-08): the guarded pages read the
 * profile directly; a failed read (permission denied from the missing
 * grants contract, or a genuinely absent row) previously dead-ended the
 * user on an error card. Per the recovery contract: read once, REPAIR
 * once (grants + idempotent row backfill over the verified direct
 * channel), read again — and only then report failure WITH the actual
 * reason. Never asks the user to sign out and back in.
 */
export async function readProfileWithRepair(
  supabase: SupabaseClient,
  userId: string
): Promise<{ profile: ProfileRow | null; reason: string | null }> {
  const first = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (first.data) return { profile: first.data as ProfileRow, reason: null };
  const failure = first.error ? first.error.message : "profile row not found";
  try {
    const { provisionSignedInUser } = await import("@/lib/db-privileged");
    const repair = await provisionSignedInUser(userId);
    if (repair.ok) {
      const retry = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (retry.data) return { profile: retry.data as ProfileRow, reason: null };
      return { profile: null, reason: retry.error?.message ?? failure };
    }
  } catch {
    // direct channel unavailable: report the original failing reason
  }
  return { profile: null, reason: failure };
}

