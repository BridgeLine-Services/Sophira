/**
 * REDIRECT-LOOP / BLANK-DASHBOARD regression (2026-10-08).
 *
 * Symptoms pinned: (1) blank /dashboard after sign-in, (2) ERR_TOO_MANY_
 * REDIRECTS on refresh — fixed only by deleting cookies, (3) reset email
 * link opening a dead hostname (404 DEPLOYMENT_NOT_FOUND).
 *
 * The redirect war was possible because every guarded page ran its OWN
 * getUser()+redirect("/login") while the middleware bounced authenticated
 * users off /login. Any stale, expired, or corrupt auth cookie made the two
 * sides disagree and ping-pong forever. These tests pin the fixes:
 *   - a SINGLE shared requireUser() used by every guarded server page
 *   - the shared validator CLEARS stale auth cookies before redirecting
 *   - the middleware clears stale auth cookies on the guarded-page bounce
 *   - /login never accepts a next param pointing back at /login
 *   - the dashboard shows a loading state and has an error boundary
 *   - the app shell reacts to a dying session instead of rendering nothing
 */
import { readFileSync } from "fs";

export function runAuthRedirectLoopTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("Auth redirect loop, blank dashboard, reset-link origin (2026-10-08 fixes)");
  const requireUserSrc = readFileSync("src/lib/supabase/require-user.ts", "utf8");
  const middleware = readFileSync("src/middleware.ts", "utf8");
  const login = readFileSync("src/app/login/page.tsx", "utf8");
  const dashboard = readFileSync("src/app/dashboard/page.tsx", "utf8");
  const owner = readFileSync("src/app/owner/page.tsx", "utf8");
  const appShell = readFileSync("src/components/app/AppShell.tsx", "utf8");

  // 1. SHARED VALIDATION — one function, both guarded pages use it
  assert(requireUserSrc.includes("export async function requireUser"),
    "loop: a single shared server-side session validator exists (src/lib/supabase/require-user.ts)");
  assert(dashboard.includes("requireUser(supabase)") && !/getUser\(\)\s*;\s*\n\s*if \(!user\)/.test(dashboard),
    "loop: /dashboard gets its user through the shared requireUser — no private getUser+redirect guard");
  assert(owner.includes("requireUser(supabase)"),
    "loop: /owner gets its user through the shared requireUser too");
  assert(requireUserSrc.includes('redirect("/login")') && requireUserSrc.includes("auth-token"),
    "loop: the shared validator redirects to /login ONLY after clearing the Supabase auth cookies (poison-cookie self-heal)");
  assert(requireUserSrc.includes("maxAge: 0") && requireUserSrc.includes('path: "/"'),
    "loop: deletion uses the same name AND path the ssr client set — stale cookies are guaranteed deletable");

  // 2. MIDDLEWARE SELF-HEAL — the guarded bounce carries cookie clearing
  const bounceBranch = middleware.slice(middleware.indexOf("if (!user && !isPublic)"), middleware.indexOf("Revoked membership"));
  assert(bounceBranch.includes("bounce.cookies.delete(name)") && bounceBranch.includes("name.startsWith(\"sb-\")"),
    "loop: the middleware !user bounce DELETES stale Supabase auth cookies on the redirect response");
  assert(!middleware.includes("return NextResponse.redirect(url);\n  }\n\n  // Revoked"),
    "loop: the old bare redirect (which let poison cookies survive) is gone from the bounce branch");

  // 3. LOGIN LOOP BREAKER — next=/login is dropped
  assert(login.includes('next !== "/login"'),
    "loop: /login drops a next param that points back at /login (cycle by definition)");

  // 4. PUBLIC/EXCLUDED ROUTES — the guard never traps public auth routes
  for (const pub of ["/login", "/reset-password", "/auth/callback"]) {
    assert(middleware.includes(`"${pub}"`),
      `loop: ${pub} stays in the middleware PUBLIC list (no guard trap on the auth surfaces)`);
  }

  // 5. BLANK DASHBOARD — explicit loading and error states
  const dashLoading = readFileSync("src/app/dashboard/loading.tsx", "utf8");
  assert(dashLoading.includes("Spinner") && dashLoading.includes("Loading your dashboard"),
    "blank: /dashboard renders an explicit loading state while the session/data resolve");
  const errorBoundary = readFileSync("src/app/error.tsx", "utf8");
  assert(errorBoundary.includes("Something went wrong") && errorBoundary.includes("onClick={() => reset()}"),
    "blank: a route error boundary exists — render/data failures show a message with a retry, never a blank page");
  assert(!/console\.(log|warn|info)/.test(errorBoundary),
    "blank: the error boundary never log/warn/info's (no tokens/paths leaked)");
  assert(errorBoundary.includes('console.error("Sophira page error:", error.message'),
    "blank: the error boundary logs the underlying failure to the browser console (message+digest only) for diagnosis");

  // 6. SESSION DEATH INSIDE THE APP — the shell reacts once
  assert(appShell.includes("onAuthStateChange") && appShell.includes('"SIGNED_OUT"') && appShell.includes('router.replace("/login")'),
    "blank: AppShell listens for SIGNED_OUT and routes to /login once — a dying session never renders a dead frame");

  // 8. LOOP-PROOF BOUNCE (fix #2): the middleware /login bounce is the loop
  // engine when a page sends a VALID session back to /login. It must be
  // role-aware AND fail-safe.
  const loginBounce = middleware.slice(middleware.indexOf("user && (path === \"/login\""));
  assert(loginBounce.includes('profile.role === "owner" ? "/owner" : "/dashboard"'),
    "loop: the /login bounce is ROLE-AWARE — the owner lands on /owner (the dashboard bounces owners again)");
  assert(loginBounce.includes("if (!profile)") && /return response;\s*\}\s*const url = request.nextUrl.clone\(\);/.test(loginBounce),
    "loop: the bounce is SKIPPED when the profile cannot be resolved — /login renders instead of a redirect war");
  assert(dashboard.includes("Your account could not be loaded") && dashboard.includes("SignOutButton"),
    "loop: /dashboard with a valid session and unresolvable profile shows an explicit error + sign-out — NEVER redirects to /login");
  assert(owner.includes("Your account could not be loaded") && owner.includes("SignOutButton"),
    "loop: /owner with a valid session and unresolvable profile shows the same explicit error state");
  const signOutBtn = readFileSync("src/components/app/SignOutButton.tsx", "utf8");
  assert(signOutBtn.includes("supabase.auth.signOut()") && signOutBtn.includes('router.replace("/login")'),
    "loop: the SignOutButton destroys the session and routes to /login exactly once");

  // 7. SIGN-IN NAVIGATION — await before navigate (no cookie race)
  const onSubmitBody = login.slice(login.indexOf("async function onSubmit"), login.indexOf("if (setupNeeded)"));
  assert(onSubmitBody.includes("await supabase.auth.signInWithPassword") && onSubmitBody.indexOf("await supabase.auth.signInWithPassword") < onSubmitBody.indexOf("router.push("),
    "blank: the sign-in call is fully awaited (cookies set) BEFORE any navigation happens");
}
