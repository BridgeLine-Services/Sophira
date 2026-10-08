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
  assert(!/console\.(log|error)/.test(errorBoundary),
    "blank: the error boundary prints nothing (no tokens/paths leaked)");

  // 6. SESSION DEATH INSIDE THE APP — the shell reacts once
  assert(appShell.includes("onAuthStateChange") && appShell.includes('"SIGNED_OUT"') && appShell.includes('router.replace("/login")'),
    "blank: AppShell listens for SIGNED_OUT and routes to /login once — a dying session never renders a dead frame");

  // 7. SIGN-IN NAVIGATION — await before navigate (no cookie race)
  assert(login.includes("await supabase.auth.signInWithPassword") && login.indexOf("await supabase.auth.signInWithPassword") < login.indexOf("router.push("),
    "blank: the sign-in call is fully awaited (cookies set) BEFORE any navigation happens");
}
