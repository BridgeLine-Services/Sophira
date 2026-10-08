/**
 * THE AUTHORITATIVE SUPABASE CONFIGURATION LAYER (2026-10-07 env audit).
 *
 * Exactly one place in the entire application reads Supabase environment
 * variables. Every other module - server, route, probe, bootstrap - asks
 * this layer. Compatibility aliases (the Supabase Vercel integration has
 * used BOTH the classic names and the new-style key names) are resolved
 * HERE and nowhere else, so a re-provisioned integration can never leave
 * the application reading a rotated-away legacy name.
 *
 * Which variables the application uses:
 *   browser/client  : NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 *                     (inlined at build time - the browser can see nothing else)
 *   server access   : the same public URL/key, read through this layer
 *   admin/service   : SUPABASE_SERVICE_ROLE_KEY (legacy name) with the
 *                     new-style SUPABASE_SECRET_KEY as a compatibility alias.
 *                     SERVER ONLY - never returned, never logged, never
 *                     bundled into client code.
 *
 * Values NEVER leave this layer; only categorical names do.
 */

function present(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.length > 0;
}

/** The project URL (both conventions; NEXT_PUBLIC_ wins so build-time
 *  client code and the server agree on ONE project). */
export function publicSupabaseUrl(): string | null {
  return (
    (present("NEXT_PUBLIC_SUPABASE_URL") && process.env.NEXT_PUBLIC_SUPABASE_URL) ||
    (present("SUPABASE_URL") && process.env.SUPABASE_URL) ||
    null
  );
}

/** The publishable (anon) key: new-style SUPABASE_PUBLISHABLE_KEY and
 *  legacy SUPABASE_ANON_KEY are accepted as aliases. */
export function publicAnonKey(): string | null {
  return (
    (present("NEXT_PUBLIC_SUPABASE_ANON_KEY") && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
    (present("SUPABASE_PUBLISHABLE_KEY") && process.env.SUPABASE_PUBLISHABLE_KEY) ||
    (present("SUPABASE_ANON_KEY") && process.env.SUPABASE_ANON_KEY) ||
    null
  );
}

/** SERVER ONLY. The administrative key: legacy service-role name with the
 *  new-style secret-key name as a compatibility alias. */
export function serviceRoleKey(): string | null {
  return (
    (present("SUPABASE_SERVICE_ROLE_KEY") && process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    (present("SUPABASE_SECRET_KEY") && process.env.SUPABASE_SECRET_KEY) ||
    null
  );
}

/** Categorical configuration status (names only - never values, never
 *  key material). Used by the probe, /setup, /api/setup-status and
 *  diagnostics to say EXACTLY which capability is missing. */
export function supabaseConfigStatus(): {
  publicUrl: boolean;
  anonKey: boolean;
  serviceRole: boolean;
  /** Which named variable provided the admin key ("SUPABASE_SERVICE_ROLE_KEY"
   *  | "SUPABASE_SECRET_KEY" | null) - a NAME, never the key itself. */
  serviceRoleSource: string | null;
} {
  return {
    publicUrl: publicSupabaseUrl() !== null,
    anonKey: publicAnonKey() !== null,
    serviceRole: serviceRoleKey() !== null,
    serviceRoleSource: present("SUPABASE_SERVICE_ROLE_KEY")
      ? "SUPABASE_SERVICE_ROLE_KEY"
      : present("SUPABASE_SECRET_KEY")
        ? "SUPABASE_SECRET_KEY"
        : null,
  };
}
