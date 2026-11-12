import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";

/**
 * Owner page gate (2026-11-03, phase 1).
 *
 * Every dedicated /owner/* page uses this same gate, so authorization cannot drift page by
 * page. It reuses the existing primitives and adds no new rule: an unauthenticated visitor is
 * handled by requireUser, a revoked profile goes to /access-denied, a signed-in non-owner is
 * sent to their own dashboard, and a profile that cannot be read is sent to /owner, which
 * already shows the account-recovery message rather than a redirect loop.
 */
export async function requireOwnerPage() {
  const supabase = createClient();
  const user = await requireUser(supabase);
  const { profile } = await readProfileWithRepair(supabase, user.id);
  if (!profile) redirect("/owner");
  if (profile.status === "revoked") redirect("/access-denied");
  if (profile.role !== "owner") redirect("/dashboard");
  return { supabase, user, profile };
}

/**
 * Member-management page gate (2026-11-12).
 *
 * The four-role model gives a Co-Owner the member directory and nothing else. This gate
 * mirrors requireOwnerPage exactly — same session handling, same revocation redirect, same
 * recovery behaviour — and only widens WHICH role may enter. The pages that use it are the
 * ones a Co-Owner is authorised for; every Owner-only page keeps requireOwnerPage above.
 */
export async function requireStaffPage() {
  const supabase = createClient();
  const user = await requireUser(supabase);
  const { profile } = await readProfileWithRepair(supabase, user.id);
  if (!profile) redirect("/owner");
  if (profile.status === "revoked") redirect("/access-denied");
  if (profile.role !== "owner" && profile.role !== "co_owner") redirect("/dashboard");
  return { supabase, user, profile };
}
