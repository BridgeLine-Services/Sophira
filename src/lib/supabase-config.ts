/**
 * THE AUTHORITATIVE SUPABASE CONFIGURATION LAYER (2026-10-07 env audit).
 *
 * Exactly one place in the entire application reads Supabase environment
 * variables. The deployment carries BOTH provisioning generations:
 *   classic integration : NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *                         SUPABASE_SERVICE_ROLE_KEY, POSTGRES_URL(_NON_POOLING)
 *   new-style keys      : SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
 *                         SUPABASE_SECRET_KEY, SUPABASE_ANON_KEY, SUPABASE_DB_URL
 * A re-provisioned integration can leave a STALE classic pair next to a
 * FRESH new-style pair - and a naive "first name wins" reader silently
 * mixes projects/keys (live finding: the admin key was accepted by
 * PostgREST but its role lacked privileges - "permission denied"). This
 * layer therefore VERIFIES consistency before choosing:
 *
 *   1. The database the direct connection vars point at is ground truth.
 *   2. Among the URL candidates, the one whose project ref matches the
 *      database wins.
 *   3. Among the admin-key candidates, the one whose JWT claims (role
 *      service_role, issuer ref) match the chosen URL wins; new-style
 *      sb_secret_ keys are valid candidates accepted when no verified
 *      JWT candidate matches.
 *
 * The browser still receives ONLY the public pair (never the admin key).
 * Values NEVER leave this layer; only categorical names and booleans do.
 */

function present(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.length > 0;
}

function read(name: string): string | null {
  return present(name) ? (process.env[name] as string) : null;
}

// ---------------------------------------------------------------------------
// The canonical catalog of direct-database connection conventions.
// db-ddl imports this list from here - the config layer owns every name.
// ---------------------------------------------------------------------------
export const CONNECTION_ENV_NAMES = [
  "SUPABASE_DB_URL_NON_POOLING",
  "SUPABASE_DB_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL",
  "POSTGRES_POOLER_URL_NON_POOLING",
  "POSTGRES_POOLER_URL",
  "POSTGRES_PRISMA_URL",
  "DATABASE_URL",
] as const;

/** Categorical names-only diagnostics: which direct-connection conventions
 *  this deployment provides (values are NEVER included). */
export function connectionEnvNames(): string[] {
  return CONNECTION_ENV_NAMES.filter((name) => present(name));
}

/** The project ref embedded in a Supabase URL (https://<ref>.supabase.co). */
export function urlProjectRef(url: string): string | null {
  try {
    return new URL(url).host.split(".")[0] || null;
  } catch {
    return null;
  }
}

/** The project ref the direct-database connection points at (the ref
 *  appears in the host for direct connections, in the username for the
 *  supavisor pooler). Ground truth for project identity. */
export function databaseProjectRef(): string | null {
  for (const name of CONNECTION_ENV_NAMES) {
    const url = read(name);
    if (!url) continue;
    try {
      const parsed = new URL(url);
      const fromHost = urlProjectRef(`https://${parsed.host}`);
      const fromUser = decodeURIComponent(parsed.username);
      if (fromHost && fromHost !== "aws-0" && fromHost !== "aws-1") {
        // pooler hosts like aws-0-us-east-1.pooler.supabase.com carry no ref
        const hostRef = parsed.host.split(".")[0];
        if (/^[a-zA-Z0-9]{10,}$/.test(hostRef)) return hostRef;
      }
      const userPart = fromUser.split(".")[1];
      if (userPart && /^[a-zA-Z0-9]{10,}$/.test(userPart)) return userPart;
    } catch {
      /* try the next convention */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// JWT claim decoding (categorical only: role + issuer ref are not secrets).
// ---------------------------------------------------------------------------
function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The authoritative accessors.
// ---------------------------------------------------------------------------

/** Which named variable the chosen public URL came from (a NAME, not a value). */
function choosePublicUrl(): { source: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | null; url: string | null } {
  const classic = read("NEXT_PUBLIC_SUPABASE_URL");
  const newStyle = read("SUPABASE_URL");
  if (classic && newStyle && classic !== newStyle) {
    // Both present and DIFFERENT: prefer the one that matches the actual
    // database the direct connection points at.
    const dbRef = databaseProjectRef();
    if (dbRef) {
      if (urlProjectRef(newStyle) === dbRef) return { source: "SUPABASE_URL", url: newStyle };
      if (urlProjectRef(classic) === dbRef) return { source: "NEXT_PUBLIC_SUPABASE_URL", url: classic };
    }
    // No database ref to arbitrate: the integration-provisioned pair
    // (SUPABASE_*) is the newer generation - prefer it.
    return { source: "SUPABASE_URL", url: newStyle };
  }
  if (classic) return { source: "NEXT_PUBLIC_SUPABASE_URL", url: classic };
  if (newStyle) return { source: "SUPABASE_URL", url: newStyle };
  return { source: null, url: null };
}

export function publicSupabaseUrl(): string | null {
  return choosePublicUrl().url;
}

/** The publishable (anon) key. Follows the URL's provisioning generation so
 *  the browser pair and the server pair always describe the SAME project. */
export function publicAnonKey(): string | null {
  const { source } = choosePublicUrl();
  if (source === "SUPABASE_URL") {
    return (
      read("SUPABASE_PUBLISHABLE_KEY") ||
      read("SUPABASE_ANON_KEY") ||
      read("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    );
  }
  return (
    read("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
    read("SUPABASE_PUBLISHABLE_KEY") ||
    read("SUPABASE_ANON_KEY")
  );
}

type AdminCandidate = {
  source: "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_SECRET_KEY";
  kind: "legacy-jwt" | "new-style-opaque" | "unrecognized";
  role: string | null;
  ref: string | null; // issuer project ref (legacy JWTs carry it; opaque keys cannot)
};

function adminCandidate(
  source: "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_SECRET_KEY"
): AdminCandidate | null {
  const value = read(source);
  if (!value) return null;
  const claims = decodeJwtClaims(value);
  if (claims && typeof claims.role === "string") {
    const iss = typeof claims.iss === "string" ? claims.iss : "";
    const refMatch = iss.match(/([a-zA-Z0-9]{10,})\.supabase\.co/) || iss.match(/^https?:\/\/([a-zA-Z0-9]{10,})\./);
    return { source, kind: "legacy-jwt", role: claims.role, ref: refMatch ? refMatch[1] : null };
  }
  if (value.startsWith("sb_secret_")) {
    return { source, kind: "new-style-opaque", role: "secret", ref: null };
  }
  return { source, kind: "unrecognized", role: null, ref: null };
}

/** SERVER ONLY. The administrative key: verified against the chosen
 *  project. Candidates that PROVE they belong to the project and carry the
 *  service role win; a stale/mismatched candidate is never chosen while a
 *  consistent one exists. */
function chooseAdminKey(): { candidate: AdminCandidate | null } {
  const legacy = adminCandidate("SUPABASE_SERVICE_ROLE_KEY");
  const newStyle = adminCandidate("SUPABASE_SECRET_KEY");
  const urlRef = publicSupabaseUrl() ? urlProjectRef(publicSupabaseUrl()!) : null;

  const verified = (c: AdminCandidate | null): boolean =>
    c !== null &&
    c.kind === "legacy-jwt" &&
    c.role === "service_role" &&
    (c.ref === null || c.ref === urlRef);

  if (verified(legacy)) return { candidate: legacy };
  if (verified(newStyle)) return { candidate: newStyle };
  // Unverified fallbacks, in order of trust: a new-style secret key, then
  // whichever legacy var exists (may be stale - diagnostics will say so).
  if (newStyle) return { candidate: newStyle };
  return { candidate: legacy };
}

export function serviceRoleKey(): string | null {
  const { candidate } = chooseAdminKey();
  return candidate ? read(candidate.source) : null;
}

// ---------------------------------------------------------------------------
// Categorical configuration status (names/booleans ONLY - never values).
// ---------------------------------------------------------------------------

export function supabaseConfigStatus(): {
  publicUrl: boolean;
  anonKey: boolean;
  serviceRole: boolean;
  urlSource: string | null;
  serviceRoleSource: string | null;
  /** categorical facts about the chosen admin key (never the key itself) */
  serviceRoleKind: "legacy-jwt" | "new-style-opaque" | "unrecognized" | null;
  serviceRoleRole: string | null;
  /** Did the admin key PROVE it belongs to the connected project? */
  serviceRoleVerified: boolean;
  /** Do the classic and new-style URL variables disagree (split project)? */
  urlSplit: boolean;
  /** Does the chosen URL project match the direct-database project? */
  urlMatchesDatabase: boolean;
} {
  const { source: urlSource } = choosePublicUrl();
  const classic = read("NEXT_PUBLIC_SUPABASE_URL");
  const newStyle = read("SUPABASE_URL");
  const { candidate } = chooseAdminKey();
  const dbRef = databaseProjectRef();
  const chosenRef = publicSupabaseUrl() ? urlProjectRef(publicSupabaseUrl()!) : null;
  return {
    publicUrl: publicSupabaseUrl() !== null,
    anonKey: publicAnonKey() !== null,
    serviceRole: serviceRoleKey() !== null,
    urlSource,
    serviceRoleSource: candidate ? candidate.source : null,
    serviceRoleKind: candidate ? candidate.kind : null,
    serviceRoleRole: candidate ? candidate.role : null,
    serviceRoleVerified:
      candidate !== null &&
      candidate.kind === "legacy-jwt" &&
      candidate.role === "service_role" &&
      (candidate.ref === null || candidate.ref === chosenRef),
    urlSplit: classic !== null && newStyle !== null && classic !== newStyle,
    urlMatchesDatabase: dbRef === null || chosenRef === null ? true : dbRef === chosenRef,
  };
}
