/**
 * CRASH-GUARD REGRESSIONS (2026-10-07 audit): missing or broken Supabase
 * configuration must NEVER produce an unhandled 500 — not on pages (the
 * middleware), not on the 37 guarded API routes (requireUser), not on the
 * first-owner bootstrap routes (/api/complete-owner, /auth/callback).
 * Degraded behavior is always honest (redirect / friendly 503) and always
 * fail-CLOSED: the degraded state can only deny access, never grant it.
 */
import { NextResponse } from "next/server";
import { requireUser, requireOwner } from "../src/lib/supabase/guard";

type Assert = (c: boolean, n: string) => void;
type Section = (t: string) => void;

export async function runCrashGuardTests(assert: Assert, section: Section): Promise<void> {
  section("Crash-guard: broken Supabase config never 500s");

  // ---- 1. requireUser converts ANY supabase failure into an honest 503 ----
  {
    const boom = {
      auth: { getUser: () => Promise.reject(new Error("Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.")) },
    };
    const r = await requireUser(boom as never);
    assert(r.ok === false && r.response.status === 503,
      "crash-guard: requireUser degrades an unreachable/misconfigured Supabase to 503 (was an unhandled 500 on every guarded route)");
    const body = await (r as { response: NextResponse }).response.json();
    assert(typeof body.error === "string" && body.error.includes("database"),
      "crash-guard: the 503 message is plain English, never a stack trace");

    const boomSync = { auth: { getUser: () => { throw new Error("supabaseUrl is required"); } } };
    const r2 = await requireUser(boomSync as never);
    assert(r2.ok === false && r2.response.status === 503,
      "crash-guard: requireUser survives a SYNCHRONOUS throw from the lazy client (sync throw → rejected promise → 503)");
  }

  // ---- 2. requireOwner inherits the same degradation ----
  {
    const boom = { auth: { getUser: () => Promise.reject(new Error("fetch failed")) } };
    const r = await requireOwner(boom as never);
    assert(r.ok === false && r.response.status === 503,
      "crash-guard: requireOwner degrades identically (owner routes never 500)");
  }

  // ---- 3. middleware: a SET-but-MALFORMED URL is degraded, not a crash ----
  {
    const { middleware } = await import("../src/middleware");
    const { NextRequest } = await import("next/server");
    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const savedKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-anon";
    try {
      let threw = false;
      let pub: { status?: number } | null = null;
      try { pub = await middleware(new NextRequest("http://localhost/login")); } catch { threw = true; }
      assert(!threw && pub !== null && pub.status !== undefined && pub.status < 400,
        "crash-guard: a malformed Supabase URL still renders PUBLIC pages (supabase-js throws synchronously on invalid URLs — previously a 500 on every page)");

      let protThrew = false;
      let prot: { status?: number; headers?: { get(k: string): string | null } } | null = null;
      try { prot = await middleware(new NextRequest("http://localhost/dashboard")); } catch { protThrew = true; }
      assert(!protThrew && prot !== null && prot.status === 307 && (prot.headers?.get("location") ?? "").includes("/login"),
        "crash-guard: a malformed Supabase URL redirects PROTECTED pages to /login (never a 500)");
    } finally {
      if (savedUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
      else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (savedKey !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedKey;
      else delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    }
  }

  // ---- 4. middleware: an UNREACHABLE (but valid) URL degrades too ----
  {
    const { middleware } = await import("../src/middleware");
    const { NextRequest } = await import("next/server");
    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const savedKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    // Port 1 is reserved/unroutable: the request fails fast with ECONNREFUSED
    // — no external network access in the test.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-anon";
    try {
      let threw = false;
      let prot: { status?: number; headers?: { get(k: string): string | null } } | null = null;
      try { prot = await middleware(new NextRequest("http://localhost/dashboard")); } catch { threw = true; }
      assert(!threw && prot !== null && prot.status === 307 && (prot.headers?.get("location") ?? "").includes("/login"),
        "crash-guard: an unreachable Supabase redirects protected pages to /login (getUser() rejection previously 500-crashed the middleware)");
    } finally {
      if (savedUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
      else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (savedKey !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedKey;
      else delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    }
  }

  // ---- 5. first-owner bootstrap routes never 500 in a degraded deployment ----
  {
    const { NextRequest } = await import("next/server");
    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const savedKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    try {
      const { GET: completeOwnerGet, POST: completeOwnerPost } = await import("../src/app/api/complete-owner/route");
      let getResult: { status?: number } | null = null;
      let threw = false;
      try { getResult = await completeOwnerGet(); } catch { threw = true; }
      assert(!threw && getResult !== null && getResult.status !== undefined && getResult.status < 500,
        "crash-guard: /api/complete-owner GET never 500s without Supabase env (first-owner check degrades honestly)");
      const body = await (getResult as unknown as { json(): Promise<{ unavailable?: boolean }> }).json();
      assert(body.unavailable === true,
        "crash-guard: /api/complete-owner GET says 'unavailable' instead of pretending the user is signed out");

      let postThrew = false;
      let postResult: { status?: number } | null = null;
      try { postResult = await completeOwnerPost(new NextRequest("http://localhost/api/complete-owner", { method: "POST" })); } catch { postThrew = true; }
      assert(!postThrew && postResult !== null && postResult.status === 503,
        "crash-guard: /api/complete-owner POST returns 503 (never a 500) when the database cannot be reached");

      const { GET: callbackGet } = await import("../src/app/auth/callback/route");
      let cbThrew = false;
      let cb: { status?: number; headers?: { get(k: string): string | null } } | null = null;
      try { cb = await callbackGet(new NextRequest("http://localhost/auth/callback?code=abc&next=/reset-password")); } catch { cbThrew = true; }
      assert(!cbThrew && cb !== null && cb.status === 307 && (cb.headers?.get("location") ?? "").includes("/reset-password"),
        "crash-guard: /auth/callback degrades to the friendly reset-password redirect (never a 500)");
    } finally {
      if (savedUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
      if (savedKey !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedKey;
    }
  }
}
