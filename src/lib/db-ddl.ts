/**
 * RUNTIME DATABASE INITIALIZATION OVER A DIRECT POSTGRES CONNECTION
 * (server-only, 2026-10-07).
 *
 * PURPOSE: the owner's first launch must be COMPLETELY hands-off - no
 * Supabase personal access token, no GitHub secrets, no SQL editor. The
 * Vercel Supabase Integration already provisions a direct database
 * connection (POSTGRES_URL / POSTGRES_URL_NON_POOLING / the database
 * password) to the deployment, and that connection can run DDL. This
 * module uses it to apply the repository's own migration chain from the
 * running application itself.
 *
 * SECURITY CONTRACT - this module NEVER:
 *   - is imported by a client component ("use client") - it reads
 *     server-only credentials;
 *   - returns, logs, or embeds the connection string, the database
 *     password, or any raw database error (every result is categorical
 *     with a plain-English message);
 *   - executes anything except the repository's own embedded, test-pinned
 *     migration chain (src/lib/db-migrations.generated.ts) - no SQL from
 *     any request;
 *   - runs once an owner exists (gated by the caller in db-bootstrap.ts,
 *     which closes all repair paths permanently after the first owner).
 *
 * Frontier semantics are IDENTICAL to the CI pipeline: probe each
 * migration's marker, then apply everything from the first gap onward,
 * each migration in its own transaction (fail-loud, nothing skipped).
 */
import { Client } from "pg";
import { MIGRATIONS } from "./db-migrations.generated";
import { present } from "./env";
import { publicSupabaseUrl, CONNECTION_ENV_NAMES, connectionEnvNames } from "./supabase-config";

export { connectionEnvNames };

/** Which database connection the deployment can reach (presence only -
 *  values are never exposed, logged, or echoed). */
export function directPostgresConfigured(): boolean {
  return connectionString() !== null;
}

/**
 * SAFETY GUARD (2026-10-07, live-deployment finding): a deployment can carry
 * direct-connection variables that point at a DIFFERENT database than
 * Sophira's own Supabase project (e.g. a leftover Vercel Postgres/Neon
 * instance provisioned alongside it). Applying the migration chain there
 * would corrupt an unrelated database. Every candidate connection is
 * therefore verified to point at THIS project before it is used: the
 * Supabase project ref (derived from the public project URL) must appear
 * in the connection's hostname.
 */
export function connectionTarget(): "same-project" | "foreign" | "none" {
  const url = rawConnectionString();
  if (!url) return "none";
  const ref = supabaseProjectRef();
  if (!ref) return "foreign";
  try {
    const parsed = new URL(url);
    // Supabase direct hosts embed the ref (db.<ref>.supabase.co); the
    // supavisor POOLED connections carry it in the username instead
    // (postgres.<ref>:...@aws-....pooler.supabase.com) - both are this
    // project; anything else is a different database and is refused.
    const same =
      parsed.host.includes(ref) ||
      decodeURIComponent(parsed.username).includes(ref);
    return same ? "same-project" : "foreign";
  } catch {
    return "foreign";
  }
}

function supabaseProjectRef(): string | null {
  try {
    return new URL(publicSupabaseUrl()!).host.split(".")[0] || null;
  } catch {
    return null;
  }
}

/** Categorical failure codes for developer diagnostics (never raw SQL
 *  errors, never identifiers, never connection details). */
export type MigrationFailure =
  | "relation-missing"
  | "permission"
  | "unsupported-feature"
  | "connection"
  | "syntax"
  | "unknown";

/** OPTIONAL secondary channel: Supabase Management API credentials
 *  (server-only). A personal access token is NOT required for first-launch
 *  setup - the direct connection above is the primary path. */
export function managementConfigured(): boolean {
  return present("SUPABASE_ACCESS_TOKEN") && present("SUPABASE_PROJECT_REF");
}

/** The precise, categorical answer to "which automatic initialization
 *  channel does this deployment have?" - exposed to the operator UI so the
 *  setup page can diagnose the exact missing infrastructure capability
 *  instead of a vague "one-time administrator connection" (requirement K/L).
 *  Never includes any credential VALUE. */
export function setupChannel(): "direct-postgres" | "management-api" | "none" {
  if (directPostgresConfigured()) return "direct-postgres";
  if (managementConfigured()) return "management-api";
  return "none";
}

/**
 * The complete catalog of direct-connection variable conventions, in
 * priority order. 2026-10-07 normalization round: the official Supabase
 * Vercel integration provisions SUPABASE_DB_URL / SUPABASE_DB_URL_NON_
 * POOLING, the older Vercel Postgres convention used POSTGRES_* / DATABASE_
 * URL, and the manual fallback uses the database password. The deployment
 * previously recognized only a subset - so a deployment whose credentials
 * WERE provisioned correctly by the integration still reported "no
 * initialization channel" and forced the non-technical owner toward
 * manual repair. One model, every accepted convention, values never
 * exposed anywhere.
 */

/** The raw first matching connection string (unverified - internal only). */
function rawConnectionString(): string | null {
  // Preferred order: the integration-provisioned direct URLs first.
  for (const name of CONNECTION_ENV_NAMES) {
    if (present(name)) return process.env[name]!;
  }
  // Fallback: the integration-provisioned database password + the public
  // project URL (the ref is its subdomain) -> the project's direct
  // endpoint. Still fully automatic: zero operator configuration.
  if (present("SUPABASE_DB_PASSWORD") && publicSupabaseUrl() !== null) {
    try {
      const ref = new URL(publicSupabaseUrl()!).host.split(".")[0];
      return `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
    } catch {
      return null;
    }
  }
  return null;
}

/** The VERIFIED connection string: only a direct connection that points at
 *  THIS project's own Supabase database (see connectionTarget) is used. */
function connectionString(): string | null {
  const raw = rawConnectionString();
  if (raw === null) return null;
  return connectionTarget() === "same-project" ? raw : null;
}

/**
 * TLS for the direct connection (live-deployment finding 2026-10-07):
 * Supabase REQUIRES SSL on its Postgres endpoints, and node-postgres does
 * not enable TLS for a bare connection URL - the repair previously failed
 * at the connection phase ("unknown" category) on the correct database.
 * We mirror supabase-js's documented sslmode=require semantics (encrypt,
 * do not verify the private-CA chain) unless the URL explicitly demands
 * full verification.
 */
/**
 * Strip explicit sslmode= parameters from the URL before handing it to
 * node-postgres (live-deployment root cause 2026-10-07: pg's
 * connection-string parser turns sslmode=require into its OWN ssl setting,
 * overriding the explicit ssl option and enabling strict verification
 * against Supabase's private certificate chain - "self-signed certificate
 * in certificate chain"). The explicit ssl option below is the single
 * source of truth for TLS.
 */
export function stripSslmode(url: string): string {
  return url.replace(/([?&])sslmode=[^&]*/g, "$1").replace(/\?&/, "?").replace(/[?&]$/, "");
}

export function sslConfigFor(url: string): { rejectUnauthorized: boolean } {
  return /sslmode=(verify-full|verify-ca)/.test(url)
    ? { rejectUnauthorized: true }
    : { rejectUnauthorized: false };
}

/**
 * Sanitized connection-phase diagnostics (developer-only). Driver
 * connection errors contain no SQL and no credentials, but may name the
 * host - which is why EVERY hostname, credential pair, and IP is redacted
 * before this string ever leaves the server. Truncated to 200 chars.
 */
function sanitizeConnectionError(err: unknown): string {
  return String((err as { message?: string })?.message ?? "unknown error")
    .replace(/:\/\/[^@\s]+@/g, "://[redacted]@")
    .replace(/[a-zA-Z0-9-]+:[^@\s]+@/g, "[redacted]@")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]")
    .replace(/\b([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/g, "[host]")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

/** Categorize a Postgres error for safe developer diagnostics. */
function categorizeFailure(err: unknown): MigrationFailure {
  const code = (err as { code?: string })?.code ?? "";
  const message = String((err as { message?: string })?.message ?? "");
  if (code === "42P01" || code === "42704" || /relation .* does not exist/i.test(message)) return "relation-missing";
  if (
    code === "42501" ||
    code === "28000" ||
    code === "28P01" ||
    /permission denied|does not have privilege|password authentication failed|authentication failed/i.test(message)
  ) return "permission";
  if (code === "0A000") return "unsupported-feature";
  if (/connect|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|SSL|sslmode|pg_hba|handshake/i.test(message)) return "connection";
  if (code === "42601" || /syntax error/i.test(message)) return "syntax";
  return "unknown";
}

/**
 * Apply the migration chain over the direct Postgres connection.
 * Returns categorically: how many migrations were applied, and whether
 * the pass completed without error. The CALLER re-probes the database and
 * only reports ready when the schema is actually present.
 */
export async function applyMigrationChainDirect(): Promise<{
  ok: boolean;
  applied: number;
  failedAt?: string;
  failure?: MigrationFailure;
  /** Sanitized connection-phase driver message (hostnames/credentials/IPs
   *  redacted; developer diagnostics only, connection failures only -
   *  migration failures stay fully categorical). */
  detail?: string;
}> {
  const url = connectionString();
  if (!url) return { ok: false, applied: 0 };
  const client = new Client({ connectionString: stripSslmode(url), ssl: sslConfigFor(url) });
  try {
    await client.connect();
    // 1. PROBE: which migrations are already applied (marker objects).
    //    Failure-tolerant BY DESIGN (live-deployment finding 2026-10-07):
    //    a marker like `conrelid = 'public.profiles'::regclass` THROWS
    //    42P01 on a completely empty database instead of evaluating to
    //    false - which made the very first launch on an EMPTY database
    //    fail. A marker query that errors simply means "not present"
    //    (migrations are idempotent by construction, so a probe error can
    //    never cause an unsafe re-application).
    const appliedMarkers = new Set<string>();
    for (const entry of MIGRATIONS) {
      if (!entry.marker) continue;
      try {
        const r = await client.query(`select (${entry.marker}) as present;`);
        if (r.rows[0]?.present) appliedMarkers.add(entry.name);
      } catch (err) {
        console.error(`[setup] marker probe for ${entry.name} errored -> treated as absent (${categorizeFailure(err)})`);
      }
    }
    // 2. FRONTIER: everything from the first missing marker onward.
    const missing: typeof MIGRATIONS = [];
    let gap = false;
    for (const entry of MIGRATIONS) {
      if (entry.marker && appliedMarkers.has(entry.name)) continue;
      if (entry.marker && !appliedMarkers.has(entry.name)) gap = true;
      if (gap) missing.push(entry);
    }
    // 3. APPLY: each missing migration in its own transaction. The
    //    transaction is sent as ONE multi-statement query (BEGIN; ...sql...;
    //    COMMIT;) so atomicity also holds behind a transaction-mode pooler
    //    (the integration-provisioned POSTGRES_POOLER_URL), where separate
    //    BEGIN/COMMIT round trips could land on different backends. A
    //    failure rolls the migration back and stops the pass (fail-loud,
    //    never silent).
    let applied = 0;
    for (const entry of missing) {
      try {
        await client.query(`BEGIN;\n${entry.sql}\nCOMMIT;`);
        applied += 1;
      } catch (err) {
        // SERVER-SIDE developer logging: migration name + sanitized
        // category + the raw server message (which never contains the
        // connection string or credentials). Never returned to users.
        console.error(
          `[setup] migration ${entry.name} failed (${categorizeFailure(err)}):`,
          String((err as { message?: string })?.message ?? "unknown error").replace(url, "[connection]")
        );
        try {
          await client.query("ROLLBACK;");
        } catch {
          /* the server already aborted the transaction */
        }
        await client.end();
        return { ok: false, applied, failedAt: entry.name, failure: categorizeFailure(err) };
      }
    }
    await client.end();
    return { ok: true, applied };
  } catch (err) {
    // Categorical only: never leak connection details or driver errors.
    console.error(
      "[setup] migration chain connection phase failed:",
      String((err as { message?: string })?.message ?? "unknown error").replace(url, "[connection]")
    );
    try {
      await client.end();
    } catch {
      /* already closed */
    }
    return { ok: false, applied: 0, failure: categorizeFailure(err), detail: sanitizeConnectionError(err) };
  }
}
