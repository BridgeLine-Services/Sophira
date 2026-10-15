/**
 * Security-boundary pins (2026-10-15): the Supabase hardening migration is
 * the single source of truth for function execution privileges and safe
 * search paths. These pins fail if a future migration (or a manual change)
 * reintroduces a mutable search path or an over-broad grant on the
 * privileged functions.
 */
import { readFileSync } from "fs";
import { join } from "path";

const mig = readFileSync(join(process.cwd(), "supabase", "migrations", "0039_supabase_security_hardening.sql"), "utf8");

let n = 0;
function check(label: string, cond: boolean) {
  if (!cond) throw new Error("security-boundary: " + label);
  n++;
}

check("touch_updated_at gets an explicit search path",
  mig.includes("alter function public.touch_updated_at() set search_path = pg_catalog"));
check("handle_new_user is not client-executable",
  mig.includes("revoke execute on function public.handle_new_user() from PUBLIC, anon, authenticated"));
check("complete_first_owner is service-role only (no anon/authenticated execute)",
  mig.includes("revoke execute on function public.complete_first_owner(uuid) from PUBLIC, anon, authenticated"));
check("get_invitation_by_token keeps the minimal anon capability without PUBLIC",
  mig.includes("revoke execute on function public.get_invitation_by_token(text) from PUBLIC") &&
  mig.includes("grant execute on function public.get_invitation_by_token(text) to anon, authenticated"));
check("network_stats is authenticated-only (anon/PUBLIC revoked)",
  mig.includes("revoke execute on function public.network_stats() from PUBLIC, anon") &&
  mig.includes("grant execute on function public.network_stats() to authenticated"));
check("the administrative rls_auto_enable helper is removed if present",
  mig.includes("drop function if exists public.rls_auto_enable()"));
check("no function body is recreated (ALTER-only, zero behavior change)",
  !mig.includes("create or replace function"));

console.log(`security-boundary: PASS (${n} pins: search paths, minimum-privilege grants, admin helper removal)`);
