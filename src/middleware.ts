import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/signup", "/reset-password", "/auth/callback", "/install", "/downloads"];

// Degraded-mode guard (found by the local production-serve smoke test, §24):
// without Supabase env config, PUBLIC pages must still render (install
// instructions and downloads are static public content); PROTECTED routes
// keep failing fast exactly as before. No auth behavior changes when the
// environment IS configured.
function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + "/"));
  if (isPublic && !hasSupabaseEnv()) return NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // Revoked membership: explicit Access Denied on every protected route —
  // not just hidden nav links (workflow §3, §23). Defense in depth: pages
  // and API routes also check status independently.
  if (user && !isPublic && path !== "/access-denied") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", user.id)
      .single();
    if (profile && profile.status === "revoked") {
      const url = request.nextUrl.clone();
      url.pathname = "/access-denied";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  if (user && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: [
      // Static assets never invoke the auth middleware: no Supabase session
      // check per icon request, and no 500 when a browser guesses a missing
      // path like /favicon.png (production debugging 2026-09-27: the old
      // matcher excluded the non-existent icons/manifest.webmanifest but
      // NOT the real /icons/ directory, so every app icon crashed the
      // middleware in deployments without Supabase env).
      "/((?!_next/static|_next/image|api/|icons/|manifest.webmanifest|sw.js|robots.txt|favicon.ico|favicon.png|apple-touch-icon.png).*)",
    ],
};
