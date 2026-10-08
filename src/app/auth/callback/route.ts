import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Handles email-confirmation and password-recovery links (code → session). */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Crash-safety contract: a missing/unreachable Supabase must NEVER produce
  // a 500 on a public route. Degrade to /setup (which explains the exact
  // missing piece in plain English) with a categorical message.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const url = new URL("/setup", request.url);
    url.searchParams.set("error", "unconfigured");
    return NextResponse.redirect(url);
  }

  // The PKCE code verifier lives in the shared cookie store, so the
  // server-side exchange is the standards-correct step for this SSR
  // architecture (email confirmation AND password recovery alike).
  // Security: the code is exchanged exactly once, is NEVER logged, and is
  // never echoed into a redirect URL. An expired, malformed, already-used,
  // or tampered code fails here — safely and generically (the error
  // message reveals nothing about which account the link belonged to).
  let supabase;
  try {
    supabase = createClient();
  } catch {
    const url = new URL("/setup", request.url);
    url.searchParams.set("error", "unconfigured");
    return NextResponse.redirect(url);
  }
  let exchange;
  try {
    exchange = await supabase.auth.exchangeCodeForSession(code);
  } catch {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "auth");
    return NextResponse.redirect(url);
  }
  const { error } = exchange;
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
  if (next && next.startsWith("/")) {
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
