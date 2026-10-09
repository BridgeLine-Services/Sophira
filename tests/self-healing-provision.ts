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

  // 1. THE GRANTS CONTRACT — root cause of permission-denied reads
  const mig27 = readFileSync("supabase/migrations/0027_grants_backfill.sql", "utf8");
  const generated = readFileSync("src/lib/db-migrations.generated.ts", "utf8");
  const grantsBlock = mig27.slice(mig27.indexOf("grant usage on schema public"), mig27.indexOf("-- ---------------------------------------------------------------------", mig27.indexOf("grant usage on schema public")));
  assert(grantsBlock.includes("grant select, insert, update, delete on all tables in schema public to authenticated"),
    "grants: 0027 grants full table privileges to authenticated (the permission-denied root cause)");
  assert(grantsBlock.includes("grant usage, select on all sequences in schema public to anon, authenticated"),
    "grants: sequence usage granted (serial inserts work)");
  assert(mig27.includes("alter default privileges") && mig27.includes("insufficient_privilege then null"),
    "grants: default privileges set for future objects, best-effort per role");
  assert(generated.includes("0027_grants_backfill.sql"),
    "grants: 0027 is embedded in the runtime migration chain (fresh installs get it automatically)");
  assert(dbPriv.includes("export const GRANTS_SQL") && dbPriv.includes("grant select, insert, update, delete on all tables in schema public to authenticated"),
    "grants: the runtime provision applies the SAME grants contract on existing databases");
  const grantsSqlSection = dbPriv.slice(dbPriv.indexOf("export const GRANTS_SQL"), dbPriv.indexOf("/** Categorical grant diagnostic"));
  assert(grantsSqlSection.includes("alter default privileges for role %I in schema public grant select, insert, update, delete on tables to authenticated"),
    "grants: the runtime grants SQL matches the migration's default-privileges block");
  assert(mig27.includes("insert into public.profiles (id, display_name, role)") && mig27.includes("from auth.users u"),
    "backfill: 0027 creates the missing profiles rows for every real auth user (idempotent)");
  assert(mig27.includes("set role = 'owner'") && mig27.includes("not exists (select 1 from public.profiles where role = 'owner')"),
    "backfill: owner role made explicit when no owner exists (earliest profile promoted)");
  assert(mig27.includes("on conflict (id) do nothing"),
    "backfill: the owner_bootstrap claim stays consistent and idempotent");

  // 2. THE REPAIR MATRIX v2 — grants first, backfill, race-safe owner claim
  assert(dbPriv.includes("provisionSignedInUser") && dbPriv.includes("GRANTS_SQL"),
    "provision: grants contract applied on every repair attempt");
  assert(dbPriv.includes("on conflict (id) do nothing"),
    "provision: the profile backfill is an idempotent upsert — no duplicates");
  assert(dbPriv.includes("complete_first_owner($1)"),
    "provision: no-owner case still uses the race-safe database function");
  assert(!dbPriv.includes("sign out and sign back in"),
    "provision: no dead-end 'sign out and back in' paths remain in the privileged module");
  assert(dbPriv.includes("checkAuthenticatedGrants"),
    "provision: a categorical grants diagnostic exists for the setup-status endpoint");

  // 2b. REPAIR-THEN-RETRY on pages and API routes
  const guard = readFileSync("src/lib/supabase/guard.ts", "utf8");
  const requireUserLib = readFileSync("src/lib/supabase/require-user.ts", "utf8");
  assert(guard.includes("provisionSignedInUser(user.id)") && guard.includes("retry") && !guard.includes("Please sign out and sign back in."),
    "guard: /math, /essay, /writing API failures now repair once, retry, and report the ACTUAL reason — no 'sign out and sign back in'");
  assert(requireUserLib.includes("readProfileWithRepair") && requireUserLib.includes("provisionSignedInUser(userId)"),
    "guard: guarded pages read the profile with repair-then-retry before showing any error");
  for (const page of ["src/app/dashboard/page.tsx", "src/app/owner/page.tsx", "src/app/corrections/page.tsx", "src/app/memories/page.tsx"]) {
    const src = readFileSync(page, "utf8");
    assert(src.includes("readProfileWithRepair(supabase, user.id)") && src.includes("Reason: {profileReason}"),
      `repair: ${page} attempts the repair, retries, and shows the failing reason`);
  }

  // 2c. AUTH REDIRECT FIX — reset links point at the live domain
  assert(dbPriv.includes("ensureAuthRedirectConfig") && dbPriv.includes("site_url") && dbPriv.includes("redirect_urls"),
    "auth-redirect: the Supabase Auth Site URL + redirect allow-list are corrected automatically when misconfigured");

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
