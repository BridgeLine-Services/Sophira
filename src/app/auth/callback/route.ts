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

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "auth");
    return NextResponse.redirect(url);
  }

  const url = new URL(next && next.startsWith("/") ? next : "/dashboard", request.url);
  return NextResponse.redirect(url);
}
