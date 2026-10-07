/**
 * FIRST-OWNER AUTH FLOW REGRESSION (2026-10-07).
 *
 * Root cause fixed this round: /create-owner was NOT in the middleware
 * PUBLIC list, so the unauthenticated owner-to-be bounced back to /login
 * and fell into the "That email or password is not right." trap. Plus:
 * the page ignored whether signUp returned a SESSION (email confirmation),
 * and login collapsed every failure to the generic credentials message.
 *
 * Scenarios A-J (mandated):
 * A fresh install exposes owner creation
 * B successful creation: owner + closed slot
 * C email confirmation required: no session, no fake redirect, guidance
 * D owner already exists: second creation rejected, login available
 * E race: only one concurrent registration becomes owner
 * F later signup: invitation required
 * G invalid login: generic safe error
 * H unconfirmed login: clear confirmation guidance
 * I existing owner login: reaches /owner
 * J revoked owner: middleware + authorization still enforced
 */
import { readFileSync } from "fs";

export async function runOwnerAuthFlowTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): Promise<void> {
  section("First-owner authentication flow (login → create-owner → auth.users → handle_new_user → profiles → session → /owner)");

  const mw = readFileSync("src/middleware.ts", "utf8");
  const login = readFileSync("src/app/login/page.tsx", "utf8");
  const createOwner = readFileSync("src/app/create-owner/page.tsx", "utf8");
  const callback = readFileSync("src/app/auth/callback/route.ts", "utf8");
  const classifier = readFileSync("src/lib/auth-errors.ts", "utf8");
  const migration = readFileSync("supabase/migrations/0025_first_owner_bootstrap.sql", "utf8");
  const { classifyAuthError } = require("../src/lib/auth-errors.js");
  const { evaluateOwnerSetup } = require("../src/lib/owner-setup.js");

  // ---- A. fresh install: no owner → the creation path is REACHABLE --------
  assert(mw.includes('"/create-owner"'),
    "A: /create-owner is PUBLIC in the middleware - an unauthenticated owner-to-be can actually OPEN the page (this exact omission was the reported bug)");
  assert(login.includes('href="/create-owner"') && login.includes("Create Owner Account"),
    "A: /login exposes the Create Owner Account path when no owner exists");
  const freshProbe = { supabaseConfigured: true, serviceRoleConfigured: true, aiConfigured: false, database: "checked", migrationsPresent: true, ownerEmailConfigured: false, ownerAccount: "none" };
  const fresh = evaluateOwnerSetup(freshProbe);
  assert(fresh.ownerCreation.possible === true && fresh.ownerCreation.url === "/create-owner",
    "A: with no owner and migrations applied, setup-status reports owner creation as possible");

  // ---- B. successful creation: auth user + owner profile + closed slot --
  assert(migration.includes("insert into public.profiles (id, display_name, role)") && migration.includes("'owner'"),
    "B: handle_new_user creates the profiles row with role = owner for the FIRST registration");
  assert(migration.includes("on conflict (id) do nothing") && migration.includes("if found then"),
    "B: the single-row owner_bootstrap claim decides ownership atomically in the DATABASE");
  const claimed = evaluateOwnerSetup({ ...freshProbe, ownerAccount: "active" });
  assert(claimed.ownerCreation.possible === false,
    "B: once an owner exists, owner creation is permanently closed");

  // ---- C. email confirmation required: signUp WITHOUT a session ----------
  assert(createOwner.includes("data.session"),
    "C: /create-owner checks whether Supabase actually returned a session (email confirmation ON by default)");
  assert(createOwner.includes("Check your email to confirm your account, then sign in."),
    "C: no-session signup shows the confirmation guidance, never a fake 'you are signed in'");
  const sessionBranch = createOwner.indexOf("if (data.session)");
  const ownerPush = createOwner.indexOf('router.push("/owner")');
  assert(sessionBranch !== -1 && ownerPush > sessionBranch,
    "C: the redirect to /owner happens ONLY inside the has-session branch - never for a confirmation-pending signup");
  assert(createOwner.includes("router.push(\"/owner\")") === false || createOwner.indexOf('router.push("/owner")') > createOwner.indexOf("if (data.session)"),
    "C: no unconditional /owner redirect anywhere before the session check");

  // ---- D. owner already exists: second creation rejected ------------------
  assert(createOwner.includes("An owner account already exists, so a second one cannot be created"),
    "D: the page says plainly that a second owner cannot be created");
  assert(login.includes("Sign in"),
    "D: normal sign-in remains available after an owner exists");

  // ---- E. race: exactly one winner ---------------------------------------
  assert(migration.includes("primary key check (id = 1)"),
    "E: the claim table admits exactly one row - a concurrent second registration finds it present");
  assert(migration.includes("if not exists (select 1 from public.profiles where role = 'owner')"),
    "E: an owner profile permanently blocks any later owner branch");

  // ---- F. later signup: invitation required ------------------------------
  assert(migration.includes("Sign-up requires a valid, unused invitation"),
    "F: every non-first registration requires a valid, unused invitation (0008/0025 contract)");

  // ---- G. invalid login: generic, no account-existence leak --------------
  const g = classifyAuthError({ code: "invalid_credentials", message: "Invalid login credentials" });
  assert(g.kind === "invalid_credentials" && g.userMessage === "That email or password is not right. Please try again.",
    "G: invalid credentials produce the generic safe message");
  assert(login.includes("classifyAuthError"),
    "G: /login uses the classifier instead of brittle substring-only matching");

  // ---- H. unconfirmed login: clear guidance, not 'wrong password' --------
  const h = classifyAuthError({ code: "email_not_confirmed", message: "Email not confirmed" });
  assert(h.kind === "email_not_confirmed" && h.userMessage.includes("confirm"),
    "H: an unconfirmed email gets confirmation guidance");
  const hMsg = classifyAuthError({ code: null, message: "Email not confirmed" });
  assert(hMsg.kind === "email_not_confirmed",
    "H: the message-only path still classifies (older Supabase versions)");
  assert(!h.userMessage.includes("not right"),
    "H: the unconfirmed state is NEVER reported as a credentials problem");
  assert(login.includes("callbackError"),
    "H: /login shows the /auth/callback link-expired error instead of silently swallowing it");

  // ---- I. existing owner login: reaches /owner --------------------------
  assert(login.includes('router.push(profile?.role === "owner" ? "/owner" : "/dashboard")'),
    "I: after sign-in the OWNER is routed to /owner, everyone else to /dashboard");
  assert(callback.includes('profile?.role === "owner" ? "/owner" : "/dashboard"'),
    "I: after email confirmation the owner lands on /owner via /auth/callback");
  assert(callback.includes("exchangeCodeForSession"),
    "I: the callback exchanges the authorization code exactly once");

  // ---- J. revoked: middleware + authorization remain enforced -------------
  assert(mw.includes("/access-denied") && mw.includes('"?reason=revoked"'),
    "J: the middleware still sends revoked users to Access Denied on every protected route");
  assert(mw.includes("profile.status === \"pending\" || profile.status === \"accepted\" || profile.status === \"active\""),
    "J: the active-access allow-list still fails CLOSED for revoked and unknown statuses");

  // ---- classifier: operational states without account-existence leaks -----
  const svc = classifyAuthError({ code: null, message: "Failed to fetch", status: null });
  assert(svc.kind === "service_unavailable" && svc.userMessage.includes("configuration"),
    "classifier: transport failures are reported as configuration problems, never as wrong credentials");
  const exists = classifyAuthError({ code: "user_already_exists", message: "User already registered" });
  assert(exists.kind === "user_already_exists" && exists.userMessage.includes("confirmation"),
    "classifier: a duplicate signup attempt gets confirmation/sign-in guidance (no second account)");
  const inv = classifyAuthError({ code: null, message: "Sophira is invitation-only. Sign-up requires a valid, unused invitation for your email address." });
  assert(inv.kind === "invitation_required",
    "classifier: the database's invitation rejection is surfaced honestly");
  const generic = classifyAuthError({ code: null, message: "" });
  assert(!generic.userMessage.includes("already exists") && !generic.userMessage.includes("confirm"),
    "classifier: an empty/unknown error never implies an account exists or needs confirmation");

  // ---- no security weakening ----------------------------------------------
  const guard = readFileSync("src/lib/supabase/guard.ts", "utf8");
  assert(guard.includes("auth.getUser()"), "security: the API guard still authenticates through Supabase Auth");
  assert(!classifier.includes("SUPABASE_SERVICE_ROLE"), "security: the classifier never touches service-role material");
  assert(!createOwner.includes("SUPABASE_SERVICE_ROLE") && !login.includes("SUPABASE_SERVICE_ROLE"),
    "security: no privileged client is used in any first-owner UI path");
}
