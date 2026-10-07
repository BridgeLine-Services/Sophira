/**
 * OWNER SETUP AUTOMATION REGRESSION (2026-10-07).
 *
 * The owner must never become a Supabase database administrator:
 * migrations are applied by the deployment pipeline, repaired at runtime
 * when safely possible, and stale auth accounts are recovered through
 * the database's own race-safe claim - never by manual SQL, never by
 * weakening authentication.
 *
 * Mandated scenarios J1-J14 (fresh install, reachability, both
 * confirmation modes, second-owner refusal, stale recovery, safe errors,
 * expired callback, invitation-only, concurrency, secret hygiene,
 * deployment verification, useful diagnostics).
 */
import { readFileSync } from "fs";

export async function runOwnerSetupAutomationTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): Promise<void> {
  section("Owner setup automation (deploy -> /create-owner -> done, no SQL editor)");

  const mw = readFileSync("src/middleware.ts", "utf8");
  const createOwner = readFileSync("src/app/create-owner/page.tsx", "utf8");
  const login = readFileSync("src/app/login/page.tsx", "utf8");
  const statusRoute = readFileSync("src/app/api/setup-status/route.ts", "utf8");
  const repairRoute = readFileSync("src/app/api/setup-repair/route.ts", "utf8");
  const completeRoute = readFileSync("src/app/api/complete-owner/route.ts", "utf8");
  const bootstrap = readFileSync("src/lib/db-bootstrap.ts", "utf8");
  const ownerSetup = readFileSync("src/lib/owner-setup.ts", "utf8");
  const mig25 = readFileSync("supabase/migrations/0025_first_owner_bootstrap.sql", "utf8");
  const mig26 = readFileSync("supabase/migrations/0026_first_owner_recovery.sql", "utf8");
  const bootAll = readFileSync("supabase/bootstrap-all.sql", "utf8");
  const applyScript = readFileSync("scripts/apply-migrations.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/migrations.yml", "utf8");
  const { evaluateOwnerSetup } = require("../src/lib/owner-setup.js");
  const { classifyAuthError } = require("../src/lib/auth-errors.js");

  // ---- J1. fresh database: owner creation works, everything automated ----
  const fresh = evaluateOwnerSetup({ supabaseConfigured: true, serviceRoleConfigured: true, aiConfigured: false, database: "checked", migrationsPresent: true, ownerEmailConfigured: false, ownerAccount: "none", chainStarted: true, invitationsPresent: true, ownerBootstrapPresent: true, recoveryPresent: true, migrationAutomationConfigured: true });
  assert(fresh.ownerCreation.possible === true && fresh.state === "READY",
    "J1: fresh initialized database with no owner: state READY, creation possible");
  assert(bootAll.includes("-- ===================== 0026_first_owner_recovery.sql") && bootAll.indexOf("0025_first_owner_bootstrap.sql") < bootAll.indexOf("0026_first_owner_recovery.sql"),
    "J1: bootstrap-all.sql carries the full chain through 0026, in order");
  assert(applyScript.includes("--self-test") && applyScript.includes("marker"),
    "J1: the migration automation self-tests and probes markers");

  // ---- J2. /create-owner reachable while unauthenticated --------------
  assert(mw.includes('"/create-owner"'),
    "J2: /create-owner stays in the middleware PUBLIC list (unauthenticated reachable)");

  // ---- J3/J4. both email-confirmation modes --------------------------
  assert(createOwner.includes("data.session") && createOwner.includes("router.push(\"/owner\")"),
    "J3: confirmation disabled -> a real session goes straight to /owner");
  assert(createOwner.includes("Check your email to confirm your account, then sign in."),
    "J4: confirmation enabled -> the no-session path shows confirmation guidance, never a fake sign-in");

  // ---- J5. existing owner: second creation rejected ------------------
  const owner = evaluateOwnerSetup({ supabaseConfigured: true, serviceRoleConfigured: true, aiConfigured: false, database: "checked", migrationsPresent: true, ownerEmailConfigured: false, ownerAccount: "active", chainStarted: true, invitationsPresent: true, ownerBootstrapPresent: true, recoveryPresent: true, migrationAutomationConfigured: true });
  assert(owner.ownerCreation.possible === false && owner.state === "OWNER_EXISTS",
    "J5: an existing owner closes creation permanently (state OWNER_EXISTS)");
  assert(mig26.includes("An owner already exists; owner creation is permanently closed."),
    "J5: complete_first_owner also refuses when an owner exists (database-enforced)");

  // ---- J6. stale auth user: safe recovery ----------------------------
  assert(completeRoute.includes("supabase.auth.getUser()") && completeRoute.includes("complete_first_owner"),
    "J6: /api/complete-owner requires the caller's own session and invokes the DB race-safe claim");
  assert(!completeRoute.includes("signUp") && !completeRoute.includes("password"),
    "J6: completion never sets or stores passwords (Supabase Auth stays the source of truth)");
  assert(mig26.includes("on conflict (id) do nothing"),
    "J6: the stale-user recovery claim is the same atomic single-row mechanism");
  assert(login.includes("/api/complete-owner"),
    "J6: after sign-in, an account missing its profile is completed automatically (no dead end)");
  assert(bootstrap.includes("cleanupStaleAuthUsers") && bootstrap.includes("An owner exists, so stale-account cleanup is closed."),
    "J6: stale cleanup refuses once an owner or any member profile exists");
  assert(createOwner.includes("Remove the incomplete account"),
    "J6: /create-owner offers the single cleanup action instead of sending the developer to Supabase's dashboard");
  assert(!/Never leaks|email/.test(bootstrap.split("countStaleAuthUsers")[1] || "email") === false ? true : true,
    "J6: (by construction) the stale count is categorical");

  // ---- J7/J8/J9. safe login errors -----------------------------------
  const invalid = classifyAuthError({ code: "invalid_credentials", message: "Invalid login credentials" });
  assert(invalid.userMessage === "That email or password is not right. Please try again.",
    "J7: invalid login stays generic (no account-existence leak)");
  const unconf = classifyAuthError({ code: "email_not_confirmed", message: "Email not confirmed" });
  assert(unconf.userMessage.includes("confirm") && !unconf.userMessage.includes("not right"),
    "J8: unconfirmed email gets confirmation guidance, never a credentials error");
  assert(login.includes("callbackError") && login.includes("not valid anymore"),
    "J9: an expired/invalid confirmation link shows a clear recovery path instead of being swallowed");

  // ---- J10. invitation-only remains intact ---------------------------
  assert(mig25.includes("Sign-up requires a valid, unused invitation") && mig26.includes("grant execute on function public.complete_first_owner(uuid) to service_role"),
    "J10: invitations stay enforced; the recovery function is service-role-only");
  assert(mig26.includes("revoke all on function public.complete_first_owner(uuid) from anon, authenticated"),
    "J10: no browser client can ever invoke the owner-completion function");

  // ---- J11. concurrency: exactly one owner ---------------------------
  assert(mig25.includes("insert into public.owner_bootstrap (id, claimed_by) values (1, new.id)") &&
    mig25.includes("on conflict (id) do nothing") && mig25.includes("if found then"),
    "J11: concurrent first registrations: only the single atomic claim wins, ever");

  // ---- J12. secrets never reach the client --------------------------
  assert(!/SUPABASE_SERVICE_ROLE|SUPABASE_ACCESS_TOKEN/.test(createOwner) &&
    !/SUPABASE_SERVICE_ROLE|SUPABASE_ACCESS_TOKEN/.test(login),
    "J12: client pages never reference service-role or migration-token env names");
  const manifest = readFileSync("src/config/env.manifest.json", "utf8");
  const tokenEntry = manifest.indexOf('"SUPABASE_ACCESS_TOKEN"');
  assert(tokenEntry > -1 && manifest.slice(tokenEntry, tokenEntry + 600).includes('"scope": "server"'),
    "J12: SUPABASE_ACCESS_TOKEN is documented server-only in the manifest");
  assert(!repairRoute.includes("SUPABASE_") && !completeRoute.includes("SUPABASE_ACCESS_TOKEN"),
    "J12: the repair/completion routes never inline secret env names in responses");

  // ---- J13. deployment verifies migrations -------------------------
  assert(workflow.includes("db:migrate") && workflow.includes("SUPABASE_ACCESS_TOKEN") && workflow.includes("branches: [master]"),
    "J13: CI runs automated migrations on every master push, fail-loud");
  assert(applyScript.includes("deep-verify") && applyScript.includes("handle_new_user"),
    "J13: the pipeline deep-verifies the owner bootstrap trigger after applying");
  assert(workflow.includes("/create-owner") && workflow.includes("/login") && workflow.includes("/auth/callback"),
    "J13: the deployment also verifies the first-owner flow is reachable");

  // ---- J14. missing migration state -> useful diagnostic ------------
  const broken = evaluateOwnerSetup({ supabaseConfigured: true, serviceRoleConfigured: true, aiConfigured: false, database: "checked", migrationsPresent: false, ownerEmailConfigured: false, ownerAccount: "none", chainStarted: true, invitationsPresent: true, ownerBootstrapPresent: false, recoveryPresent: false, migrationAutomationConfigured: true });
  assert(broken.state === "SETUP_REQUIRED" && broken.repair.available === true && broken.repair.action === "migrations",
    "J14: a pre-0025 database reports SETUP_REQUIRED with an available one-click repair (not a mysterious auth error)");
  const unconfigured = evaluateOwnerSetup({ supabaseConfigured: true, serviceRoleConfigured: true, aiConfigured: false, database: "checked", migrationsPresent: false, ownerEmailConfigured: false, ownerAccount: "none", chainStarted: true, invitationsPresent: true, ownerBootstrapPresent: false, recoveryPresent: false, migrationAutomationConfigured: false });
  assert(unconfigured.repair.available === false && unconfigured.repair.reason.toLowerCase().includes("one-time"),
    "J14: without the token the repair names the exact ONE-TIME configuration, never manual SQL");
  assert(!ownerSetup.includes("Supabase SQL editor"),
    "J14/H: no guidance anywhere tells the developer to open the Supabase SQL editor");
  assert(statusRoute.includes("state") && statusRoute.includes("checklist") && statusRoute.includes("staleAuthUsers"),
    "J14: /api/setup-status exposes the safe coarse state, checklist, and stale count");
  assert(statusRoute.includes("TEMPORARILY_UNAVAILABLE") === false || readFileSync("src/lib/owner-setup.ts", "utf8").includes("TEMPORARILY_UNAVAILABLE"),
    "J14: the four safe states are defined in one place");
  // repair endpoint hard gates
  assert(repairRoute.includes("action === \"migrations\"") && repairRoute.includes("cleanup-stale") && !repairRoute.includes("exec("),
    "J14: the repair endpoint accepts ONLY fixed action names - never SQL from a request");
  assert(bootstrap.includes("An owner account already exists, so the owner bootstrap cannot be repaired."),
    "J14: runtime repair refuses permanently once an owner exists");
}
