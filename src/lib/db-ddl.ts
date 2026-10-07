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

/** Which database connection the deployment can reach (presence only -
 *  values are never exposed, logged, or echoed). */
export function directPostgresConfigured(): boolean {
  return connectionString() !== null;
}

function connectionString(): string | null {
  // Preferred order: the integration-provisioned direct URLs first.
  for (const name of ["POSTGRES_URL_NON_POOLING", "POSTGRES_URL", "POSTGRES_POOLER_URL_NON_POOLING", "POSTGRES_POOLER_URL"]) {
    if (present(name)) return process.env[name]!;
  }
  // Fallback: the integration-provisioned database password + the public
  // project URL (the ref is its subdomain) -> the project's direct
  // endpoint. Still fully automatic: zero operator configuration.
  if (present("SUPABASE_DB_PASSWORD") && present("NEXT_PUBLIC_SUPABASE_URL")) {
    try {
      const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host.split(".")[0];
      return `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Apply the migration chain over the direct Postgres connection.
 * Returns categorically: how many migrations were applied, and whether
 * the pass completed without error. The CALLER re-probes the database and
 * only reports ready when the schema is actually present.
 */
export async function applyMigrationChainDirect(): Promise<{ ok: boolean; applied: number }> {
  const url = connectionString();
  if (!url) return { ok: false, applied: 0 };
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    // 1. PROBE: which migrations are already applied (marker objects).
    const appliedMarkers = new Set<string>();
    for (const entry of MIGRATIONS) {
      if (!entry.marker) continue;
      const r = await client.query(`select (${entry.marker}) as present;`);
      if (r.rows[0]?.present) appliedMarkers.add(entry.name);
    }
    // 2. FRONTIER: everything from the first missing marker onward.
    const missing: typeof MIGRATIONS = [];
    let gap = false;
    for (const entry of MIGRATIONS) {
      if (entry.marker && appliedMarkers.has(entry.name)) continue;
      if (entry.marker && !appliedMarkers.has(entry.name)) gap = true;
      if (gap) missing.push(entry);
    }
    // 3. APPLY: each missing migration in its own transaction; a failure
    //    rolls that migration back and stops the pass (fail-loud, never
    //    silent).
    let applied = 0;
    for (const entry of missing) {
      await client.query("BEGIN;");
      try {
        await client.query(entry.sql);
        await client.query("COMMIT;");
        applied += 1;
      } catch {
        await client.query("ROLLBACK;");
        await client.end();
        return { ok: false, applied };
      }
    }
    await client.end();
    return { ok: true, applied };
  } catch {
    // Categorical only: never leak connection details or driver errors.
    try {
      await client.end();
    } catch {
      /* already closed */
    }
    return { ok: false, applied: 0 };
  }
}
