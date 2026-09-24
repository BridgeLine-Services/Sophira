# Task: Authentication pages

You own EXACTLY these files (create all 4). Do not modify anything else. Never run npm install, next build, tsc, or git.

## 1. src/app/login/page.tsx
"use client". Email+password sign-in. Centered card layout (NOT AppShell — this is pre-login): simple centered max-w-sm page with the Sophira logo mark (span classes `flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-white text-xl font-semibold` containing "S"), "Sophira" wordmark, tagline "Your private academic assistant". Form with Label+Input+Button full width; error text under the form from supabase errors, translated: invalid credentials → "That email or password is not right. Please try again."; "Email not confirmed" → "Please check your inbox and confirm your email first." On success `router.push(next || "/dashboard")` where next comes from `useSearchParams().get("next")`, then `router.refresh()`. Links: "Forgot your password?" → /reset-password; "Have an invitation?" → /signup. The component that uses useSearchParams MUST be wrapped in `<Suspense>` (default export = simple wrapper). Include a small "Install the app" link to /install. Loading state (disabled button + "Signing in…") on submit; the form preserves input on error.

## 2. src/app/signup/page.tsx
"use client", invite-only. useSearchParams (?invite=TOKEN) wrapped in Suspense. No token → honest notice "Sophira is invite-only" + explanation that the owner must send a personal invitation link + link to /login. With token: `supabase.rpc("get_invitation_by_token", { p_token: token })` to fetch the pending invitation; show "You were invited as {email}". Form: that email (prefilled, read-only), full name Input, password (min 8). Submit: `supabase.auth.signUp({ email, password, options: { data: { display_name } } })`. Handle "already registered" honestly. After success: POST /api/invitations/accept with `{ token }` (ignore result); if a session exists `router.push("/onboarding")`, otherwise show "Check your inbox to confirm your email, then sign in" + link to /login.

## 3. src/app/reset-password/page.tsx
"use client", two states: (a) request: email Input → `supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/reset-password" })` → success "Check your inbox for the reset link."; (b) if a session exists (`supabase.auth.getSession()` in useEffect — a recovery link creates one) show "Choose a new password" + password + confirm → `supabase.auth.updateUser({ password })` → success + sign out. Link back to /login.

## 4. src/app/auth/callback/route.ts
Server route handler: `export async function GET(request: NextRequest)`. Read searchParams "code"; if present call `supabase.auth.exchangeCodeForSession(code)` (client from @/lib/supabase/server). Then redirect to searchParams "next" || "/dashboard"; no code → redirect /login. Use `NextResponse.redirect(new URL(..., request.url))`.

Tone: plain language, friendly, calm; min 44px touch targets; mobile-first; lucide-react icons sparingly.
