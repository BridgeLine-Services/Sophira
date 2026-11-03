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
