import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Lazy server client (crash-audit 2026-10-07).
 *
 * The real Supabase client is constructed on FIRST PROPERTY ACCESS, not at
 * call time — supabase-js throws synchronously when the env vars are missing
 * or the URL is malformed, and route bodies previously crashed with an
 * unhandled 500 the moment they called createClient() in a degraded
 * deployment. With the lazy proxy the construction never throws; the
 * failure instead surfaces at the first auth call, where requireUser's
 * catch (and every public route's own catch) turns it into an honest 503
 * or a friendly redirect — never a 500.
 */
export function createClient() {
  const build = () => {
    const cookieStore = cookies();
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Server Component render: middleware refreshes sessions.
            }
          },
        },
      }
    );
  };

  type Client = ReturnType<typeof build>;
  let real: Client | null = null;
  const proxy = new Proxy({} as Client, {
    get(_target, prop) {
      if (!real) real = build();
      const value = (real as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
    },
  });
  return proxy;
}
