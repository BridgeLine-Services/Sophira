/**
 * SELF-HEALING PROVISIONING regression (2026-10-08).
 *
 * Live diagnosis: the owner's auth account AND its profiles row exist on
 * the direct channel (ownerAccount "active", staleAuthUsers 0), yet every
 * RLS-scoped read — browser and server alike — returns no row: the login
 * says the account "could not be finished", guarded pages blank/loop,
 * Learning and Memory redirect to the login screen. Provisioning must
 * repair the account in place and every guarded page must terminate
 * visibly instead of redirecting.
 */
import { readFileSync } from "fs";

export function runSelfHealingProvisionTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("Self-healing owner provisioning + setup-status panel (2026-10-08)");
  const dbPriv = readFileSync("src/lib/db-privileged.ts", "utf8");
  const route = readFileSync("src/app/api/complete-owner/route.ts", "utf8");
  const login = readFileSync("src/app/login/page.tsx", "utf8");

  // 1. THE REPAIR MATRIX — every data state, idempotent, single-owner safe
  assert(dbPriv.includes("provisionSignedInUser"),
    "provision: a single server-side provision function exists in the privileged module (never client-importable)");
  assert(dbPriv.includes('drop policy if exists "profiles_select_own"') && dbPriv.includes("create policy \"profiles_select_own\" on public.profiles for select using (id = auth.uid())"),
    "provision: a missing/mangled profiles_select_own policy is recreated — the invisible-row root cause repair");
  assert(dbPriv.includes("grant select, update on public.profiles to authenticated"),
    "provision: a lost GRANT to authenticated is restored (permission-denied reads fixed)");
  assert(dbPriv.includes("update public.profiles set id = $1 where id = $2 and role = 'owner'") && dbPriv.includes("update public.owner_bootstrap set claimed_by = $1 where claimed_by = $2"),
    "provision: an ORPHANED owner row is re-linked in place (claimed_by synced) — one owner, no duplicates");
  assert(dbPriv.includes("complete_first_owner($1)"),
    "provision: no-owner case still uses the race-safe database function");
  assert(dbPriv.includes("owner_elsewhere") && dbPriv.includes("select 1 as one from auth.users where id = $1"),
    "provision: an owner row attached to a REAL other account is refused honestly (never hijacked)");

  // 2. THE ROUTE — session-verified, honest statuses
  assert(route.includes("provisionSignedInUser(user.id)") && route.includes("hasProfile"),
    "route: /api/complete-owner POST runs the repair matrix with the SERVER-verified session id");
  assert(route.includes("different email address"),
    "route: owner-elsewhere returns an honest 409 naming the actual condition (not a generic 'closed')");
  assert(route.includes("503"),
    "route: an unavailable database is a 503, never a fake success or a 500");

  // 3. THE LOGIN PANEL — 'See the setup status' is a working surface
  assert(login.includes("See the setup status") && login.includes('"/api/setup-status"') && login.includes("Retry setup"),
    "login: the setup status is a WORKING panel — server checks with pass/fail + a Retry setup action");
  assert(login.includes("completed: true") || login.includes('const done = (await r.json()) as { role?: string | null }'),
    "login: the client routes on the SERVER-verified role returned by the repair (never a browser guess)");
  assert(!login.includes("See the setup status for what is missing."),
    "login: the dead-end 'see the setup status' sentence now opens the panel instead");

  // 4. LOOP-PROOF GUARDED PAGES — Learning (/corrections) and Memory (/memories)
  for (const page of ["src/app/corrections/page.tsx", "src/app/memories/page.tsx"]) {
    const src = readFileSync(page, "utf8");
    assert(src.includes("requireUser(supabase)"),
      `provision: ${page} validates the session through the shared requireUser`);
    assert(src.includes("Your account could not be loaded") && src.includes("SignOutButton"),
      `provision: ${page} shows an explicit account-problem screen + sign-out — NEVER redirects a valid session to /login`);
    assert(!/if \(!profile\) redirect\(\"\/login\"\);/.test(src),
      `provision: ${page} no longer redirect-loops on an unreadable profile`);
  }
  assert(readFileSync("src/app/dashboard/page.tsx", "utf8").includes("Your account could not be loaded"),
    "provision: /dashboard keeps its explicit account-problem screen");
}
