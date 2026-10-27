import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { safeNextPath } from "../../../lib/auth-redirect";

/** Handles email-confirmation and password-recovery links (code → session). */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  // 2026-10-27: only a fixed same-origin path may win after the exchange -
  // "//evil.example" previously passed a naive startsWith("/") check.
  const next = safeNextPath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // The PKCE code verifier lives in the shared cookie store, so the
  // server-side exchange is the standards-correct step for this SSR
  // architecture (email confirmation AND password recovery alike).
  // Security: the code is exchanged exactly once, is NEVER logged, and is
  // never echoed into a redirect URL. An expired, malformed, already-used,
  // or tampered code fails here — safely and generically (the error
  // message reveals nothing about which account the link belonged to).
  let supabase: ReturnType<typeof createClient>;
  try {
    supabase = createClient();
  } catch {
    // Unconfigured deployment: the same friendly path as an invalid link.
    return NextResponse.redirect(new URL("/login?error=auth", request.url));
  }
  let error;
  try {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } catch {
    // Degraded deployment (crash-audit 2026-10-07): an unconfigured or
    // unreachable Supabase takes the SAME friendly redirect path as an
    // invalid link — never an unhandled 500.
    error = { message: "supabase unavailable" } as { message: string };
  }
  if (error) {
    const recovery = next === "/reset-password";
    const url = new URL(recovery ? "/reset-password" : "/login", request.url);
    if (recovery) {
      // Keep the user in the recovery context: /reset-password shows the
      // safe "invalid, expired, or already used" message and a fresh-link
      // action (it never silently dead-ends, and never claims success).
      url.searchParams.set("error", "recovery_link");
      url.searchParams.set("error_code", "otp_expired_or_invalid");
    } else {
      url.searchParams.set("error", "auth");
    }
    return NextResponse.redirect(url);
  }

  // Role routing (2026-10-07): an owner confirming their email for the
  // first time lands on /owner; everyone else on /dashboard. An explicit
  // ?next= target always wins (it is validated to be a same-origin path).
  if (next) {
    return NextResponse.redirect(new URL(next, request.url));
  }
  const { data: userData } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user?.id ?? "")
    .single();
  return NextResponse.redirect(new URL(profile?.role === "owner" ? "/owner" : "/dashboard", request.url));
}
