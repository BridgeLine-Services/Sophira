/**
 * FORGOT-PASSWORD / RESET-PASSWORD hardening regression (2026-10-06).
 *
 * The flow is Supabase Auth end-to-end (existing architecture — NOT
 * replaced, no second reset system). These tests pin the security and
 * privacy properties so they cannot regress:
 *   - visible forgot-password link on /login
 *   - /reset-password is a PUBLIC route (unauthenticated reset request)
 *   - the request never reveals whether an email has an account
 *   - recovery requires connectivity (offline = honest, no fake "sent")
 *   - expired/invalid/tampered links fail SAFELY and visibly
 *   - password validation (min length, mismatch) errors
 *   - sign-out after a successful password change
 *   - the page never writes profile status/role (auth change ONLY)
 *   - no logging of emails, tokens, or passwords
 */
import { readFileSync } from "fs";

export function runResetPasswordTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("Reset-password flow (Supabase Auth — hardened, architecture unchanged)");
  const page = readFileSync("src/app/reset-password/page.tsx", "utf8");
  const login = readFileSync("src/app/login/page.tsx", "utf8");
  const middleware = readFileSync("src/middleware.ts", "utf8");

  // 1. LOGIN UI
  assert(login.includes("Forgot your password?") && login.includes('href="/reset-password"'),
    "reset: /login shows a clearly visible Forgot your password? link pointing at /reset-password");

  // 2. REQUEST RESET
  assert(middleware.includes('"/reset-password"'),
    "reset: /reset-password is in the middleware PUBLIC list (unauthenticated users may request a reset)");
  assert(page.includes("resetPasswordForEmail"),
    "reset: the request uses Supabase Auth's resetPasswordForEmail (no custom reset mechanism)");
  assert(page.includes("redirectTo: window.location.origin + \"/auth/callback?next=/reset-password\""),
    "reset: the recovery link goes through /auth/callback (server-side PKCE code exchange) and returns to /reset-password");
  const callback = readFileSync("src/app/auth/callback/route.ts", "utf8");
  assert(callback.includes("exchangeCodeForSession"),
    "reset: the callback exchanges the recovery code server-side (the PKCE verifier lives in the shared cookie store) — no assumption that getSession() creates the session");
  assert(callback.includes("next === \"/reset-password\"") && callback.includes("otp_expired_or_invalid"),
    "reset: a failed exchange for a recovery link redirects BACK to /reset-password with safe generic error params (expired/malformed/used/tampered links fail safely in the recovery context)");
  assert(!callback.includes("console."),
    "reset: the callback never logs codes, tokens, or authorization headers");
  assert(page.includes("const { data } = await supabase.auth.getSession();"),
    "reset: the code branch CONFIRMS with getSession() before declaring success or failure — a code already consumed by client init is never mistaken for an invalid link, and the password UI is never shown without a session");
  assert(page.includes("exchangeCodeForSession(code)"),
    "reset: the page also performs the explicit client-side exchange when a code arrives directly (no reliance on implicit session creation)");
  assert(page.includes("If that email has a Sophira account, a reset link is on its way"),
    "reset: the success message is GENERIC and does not reveal whether the email exists");
  const reqHandler = page.slice(page.indexOf("async function onRequest"), page.indexOf("async function onSet"));
  assert(reqHandler.includes("setSent(true)"),
    "reset: a failed lookup produces the SAME generic response as success (no existence oracle)");
  assert(!reqHandler.includes("setError(error.message)"),
    "reset: raw Supabase error messages are NEVER shown on the request path (could leak account existence)");

  // 2b. HONEST PROVIDER FAILURES (2026-10-07 fix): a genuinely broken email
  // configuration (SMTP provider failure, auth disabled, redirect rejected)
  // must NEVER be masked as the fake "check your inbox" success — that
  // masking made reset failures undiagnosable. The honest message is a
  // CONSTANT (no dependence on the entered email), so it creates no
  // existence oracle; only the user-not-found shape keeps the generic
  // success form.
  assert(reqHandler.includes("user_not_found") && reqHandler.includes('code === "user_not_found"'),
    "reset: the user-not-found shape alone keeps the generic success form (enumeration-safe)");
  assert(reqHandler.includes("could not send a reset link right now") && reqHandler.includes("nothing was sent"),
    "reset: provider/configuration failures get an HONEST constant error — never a fake sent state");
  assert(reqHandler.includes("change your password from Settings"),
    "reset: the honest failure points at the signed-in Settings change-password alternative");
  const honestBranch = reqHandler.slice(reqHandler.indexOf("ANY OTHER failure"), reqHandler.indexOf("return;", reqHandler.indexOf("ANY OTHER failure")) + 8);
  assert(!honestBranch.includes("setSent("),
    "reset: the honest-failure branch can never set the fake inbox state");

  // 2c. SIGNED-IN CHANGE PASSWORD (settings) — the no-email path that works
  // for the owner and every member identically.
  const settings = readFileSync("src/app/settings/page.tsx", "utf8");
  assert(settings.includes("async function changePassword") && settings.includes("updateUser({ password: pw })"),
    "reset: /settings offers a signed-in password change via Supabase Auth updateUser (credential only)");
  const changeHandler = settings.slice(settings.indexOf("async function changePassword"), settings.indexOf("async function deleteAccount"));
  assert(changeHandler.includes("pw.length < 8") && changeHandler.includes("pw !== pwConfirm"),
    "reset: the settings change enforces minimum length and confirmation match");
  assert(changeHandler.includes("await supabase.auth.signOut()") && changeHandler.includes('router.replace("/login")'),
    "reset: after a settings password change the session is signed out and the user signs in with the new password");
  assert(!changeHandler.includes('from("profiles")') && !changeHandler.includes("from('profiles')") && !changeHandler.includes('"owner"') && !changeHandler.includes("updateUserWithEmailAndPassword"),
    "reset: the settings password change never touches profiles/roles — owner privileges and membership are untouched");

  // 3. RECOVERY LINK — authorization model NOT bypassed
  assert(page.includes("if (data.session) setMode(\"set\")"),
    "reset: the page switches to password-change mode ONLY when Supabase established a recovery session");
  assert(/status === "pending" \|\| profile.status === "accepted" \|\| profile.status === "active"/.test(middleware),
    "reset: the middleware's active-access allow-list still applies to every authenticated request — a recovery session cannot bypass invitation/active-access checks");
  assert(!page.includes("from(\"profiles\")") && !page.includes("from('profiles')"),
    "reset: the reset page never touches profiles — it cannot activate a pending invitation, reactivate a revoked user, or change a role");

  // 4. NEW PASSWORD
  assert(page.includes("password.length < 8"),
    "reset: minimum password requirement is enforced with a clear error");
  assert(page.includes("The two passwords don't match."),
    "reset: a mismatch produces a clear validation error");
  assert(page.includes("updateUser({ password })"),
    "reset: the update goes to Supabase Auth's updateUser — ONLY the authentication password changes");
  assert(page.includes("await supabase.auth.signOut()"),
    "reset: the recovery session is securely signed out after changing the password");
  assert(page.includes('router.replace("/login")'),
    "reset: after the change the user is sent to /login to authenticate with the new password");
  assert(page.includes("Back to sign in"),
    "reset: the user is returned to /login");

  // 5. INVALID/EXPIRED/TAMPERED RECOVERY LINKS
  assert(page.includes("error_code") && page.includes("invalid, expired, or was already used"),
    "reset: expired/invalid/tampered/used recovery links fail SAFELY with a visible explanation and a fresh-link action (no silent dead end)");

  // 7. PRIVACY — nothing sensitive logged or persisted
  assert(!/console\.(log|error|warn|info)/.test(page),
    "reset: the reset page logs NOTHING (no emails, tokens, or passwords in logs)");
  assert(!/localStorage|sessionStorage/.test(page),
    "reset: reset URLs/tokens/passwords are never persisted in client storage");

  // 8. PASSWORD SECURITY
  assert(!/bcrypt|createhash|sha-?256|md5|pbkdf2|scrypt/.test(page.toLowerCase()),
    "reset: no custom password cryptography or second password hash exists — Supabase Auth only");

  // 9. OFFLINE BEHAVIOR
  assert(page.includes("!navigator.onLine"),
    "reset: offline is detected BEFORE calling Supabase");
  assert(page.includes("requires an internet connection") && page.includes("Nothing was sent"),
    "reset: the offline message is HONEST — recovery is an online operation and no fake email-sent is shown");
  const offlineBranch = page.slice(page.indexOf("!navigator.onLine"), page.indexOf("resetPasswordForEmail"));
  assert(offlineBranch.includes("setError(") && !offlineBranch.includes("setSent("),
    "reset: the offline branch shows an honest error and NEVER a fake success state");
}
