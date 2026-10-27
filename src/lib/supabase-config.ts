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
  const choice = chooseUrlFromCandidates({
    classic: read("NEXT_PUBLIC_SUPABASE_URL"),
    newStyle: read("SUPABASE_URL"),
    dbRef: databaseProjectRef(),
  });
  return { source: choice.source, url: choice.url };
}


/** Validates and reduces a Supabase base URL to its bare origin. Clients
 *  append /rest/v1/... themselves; a URL that already contains a path
 *  (e.g. .../rest/v1) fails every request with "Invalid path specified in
 *  request URL" - which broke the service-role probe and first-owner
 *  creation on Vercel (2026-10-27). Local dev may use a loopback origin. */
export function normalizeSupabaseUrl(raw: string | null | undefined): { url: string | null; reason: string | null } {
  const value = (raw ?? "").trim();
  if (value === "") return { url: null, reason: "missing" };
  let parsed: URL;
  try { parsed = new URL(value); } catch { return { url: null, reason: "not a URL" }; }
  const host = parsed.hostname;
  // Loopback development hosts (Supabase CLI). Production is https-only:
  // the same policy the environment validator applies.
  const loopback = host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  const allowHttp = loopback && process.env.NODE_ENV !== "production";
  if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) return { url: null, reason: "must start with https://" };
  if (!loopback && !host.endsWith(".supabase.co")) return { url: null, reason: "not a *.supabase.co project URL" };
  const hadPath = parsed.pathname !== "/" && parsed.pathname !== "";
  return { url: `${parsed.protocol}//${parsed.host}`, reason: hadPath ? "path removed (use the bare project URL)" : null };
}

export interface UrlCandidateChoice {
  source: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | null;
  url: string | null;
  /** NAMES + reasons only - never values. */
  issues: string[];
}

/** Pure chooser (tested): validate both candidates, then apply the existing
 *  project-ref arbitration. A malformed value is SKIPPED, never passed on. */
export function chooseUrlFromCandidates(input: { classic: string | null; newStyle: string | null; dbRef: string | null }): UrlCandidateChoice {
  const issues: string[] = [];
  const classic = normalizeSupabaseUrl(input.classic);
  const newStyle = normalizeSupabaseUrl(input.newStyle);
  if (input.classic && classic.reason) issues.push(`NEXT_PUBLIC_SUPABASE_URL: ${classic.reason}`);
  if (input.newStyle && newStyle.reason) issues.push(`SUPABASE_URL: ${newStyle.reason}`);
  if (classic.url && newStyle.url && classic.url !== newStyle.url && input.dbRef) {
    if (urlProjectRef(newStyle.url) === input.dbRef) return { source: "SUPABASE_URL", url: newStyle.url, issues };
    if (urlProjectRef(classic.url) === input.dbRef) return { source: "NEXT_PUBLIC_SUPABASE_URL", url: classic.url, issues };
  }
  if (classic.url && newStyle.url && classic.url !== newStyle.url && !input.dbRef) return { source: "SUPABASE_URL", url: newStyle.url, issues };
  if (classic.url) return { source: "NEXT_PUBLIC_SUPABASE_URL", url: classic.url, issues };
  if (newStyle.url) return { source: "SUPABASE_URL", url: newStyle.url, issues };
  return { source: null, url: null, issues };
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
  /** Malformed/ignored URL variables (NAMES + reasons only, never values). */
  urlIssues: string[];
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
    urlIssues: chooseUrlFromCandidates({ classic, newStyle, dbRef: databaseProjectRef() }).issues,
    urlMatchesDatabase: dbRef === null || chosenRef === null ? true : dbRef === chosenRef,
  };
}
