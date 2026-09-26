"use client";
import { createBrowserClient } from "@supabase/ssr";

function buildClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

type BrowserClient = ReturnType<typeof buildClient>;

let real: BrowserClient | null = null;
let proxy: BrowserClient | null = null;

/**
 * Lazy, memoized browser client.
 *
 * The real Supabase client is constructed on FIRST USE, not at render time, so
 * the app's client pages can be prerendered without Supabase env vars present
 * (the prerendered shell is inert; the real client is created in the browser,
 * where the env is inlined). If the env vars are genuinely missing at runtime,
 * the error surfaces the moment the client is actually used — never silently.
 */
export function createClient(): BrowserClient {
  if (proxy) return proxy;
  proxy = new Proxy({} as BrowserClient, {
    get(_target, prop) {
      if (!real) real = buildClient();
      const value = (real as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
    },
  });
  return proxy;
}
