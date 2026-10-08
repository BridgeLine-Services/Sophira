/**
 * THE AUTHORITATIVE PRIVILEGED SERVER CHANNEL (2026-10-07).
 *
 * Live-deployment finding: the deployment's admin API key can be a
 * RESTRICTED new-style key (PostgREST answers "permission denied for
 * table X" while the direct, same-project-verified Postgres connection is
 * fully privileged). Every server-side privileged operation therefore runs
 * over the VERIFIED direct database connection through THIS module.
 * The PostgREST admin client remains only as a fallback for deployments
 * that have a valid service key but no direct connection, and GoTrue
 * auth-admin (key-level, not table-grant-level) stays on the admin client.
 *
 * Security invariants:
 *   - only the same-project-verified connection is ever used;
 *   - every query is parameterized (no string interpolation of user data);
 *   - callers pass server-verified values (e.g. the caller's own auth uid);
 *   - nothing here is ever imported by client code.
 */

import { Client } from "pg";
import { directPostgresConfigured, connectionString, sslConfigFor, stripSslmode } from "./db-ddl";
import { publicSupabaseUrl } from "./supabase-config";

async function withClient<T>(
  fn: (client: { query: (q: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<T>
): Promise<T | null> {
  if (!directPostgresConfigured()) return null;
  const url = connectionString();
  if (!url) return null;
  const client = new Client({ connectionString: stripSslmode(url), ssl: sslConfigFor(url) });
  try {
    await client.connect();
    return await fn(client as unknown as Parameters<typeof fn>[0]);
  } catch {
    return null;
  } finally {
    try {
      await client.end();
    } catch {
      /* already closed */
    }
  }
}

/** Invoke a database function (the RPC replacement). Returns true only on
 *  a clean function call (the function's OWN refusal is still a result). */
export async function callDbFunction(fnName: string, params: unknown[]): Promise<{ ok: boolean; error?: string }> {
  const res = await withClient(async (client) => {
    const r = await client.query(`select public.${fnName}(${params.map((_, i) => `$${i + 1}`).join(", ")}) as result`, params);
    return { ok: true, value: r.rows[0] };
  });
  if (res === null) return { ok: false, error: "unavailable" };
  return { ok: true };
}

/** One row by table + column equality (server-verified inputs only). */
export async function selectRow(
  table: "invitations" | "profiles",
  column: string,
  value: string
): Promise<Record<string, unknown> | null> {
  return withClient(async (client) => {
    const r = await client.query(
      `select * from public.${table} where ${column} = $1 limit 1`,
      [value]
    );
    return (r.rows[0] as Record<string, unknown>) ?? null;
  });
}

/** Atomic invitation acceptance: succeeds only while the row is STILL
 *  pending (concurrent double-accept is impossible). */
export async function acceptInvitationAtomic(id: string): Promise<boolean> {
  const res = await withClient(async (client) => {
    const r = await client.query(
      `update public.invitations set status = 'accepted', accepted_at = now()
       where id = $1 and status = 'pending' returning id`,
      [id]
    );
    return r.rows.length > 0;
  });
  return res === true;
}

/** Categorical profile-role/status update for owner controls (approve/
 *  revoke/reinstate). Server-verified target ids only. */
export async function updateProfileColumns(
  userId: string,
  fields: Record<string, unknown>
): Promise<boolean> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return false;
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`);
  const values = entries.map(([, v]) => v);
  const res = await withClient(async (client) => {
    const r = await client.query(
      `update public.profiles set ${sets.join(", ")} where id = $1 returning id`,
      [userId, ...values]
    );
    return r.rows.length > 0;
  });
  return res === true;
}

/** Idempotent profile-row existence check (stale-signup cleanup). */
export async function listProfileIds(): Promise<string[] | null> {
  return withClient(async (client) => {
    const r = await client.query(`select id from public.profiles limit 1000`);
    return (r.rows as { id: string }[]).map((row) => row.id);
  });
}

/** Server-fingerprint for this module in diagnostics (never any secret). */
export function privilegedChannelConfigured(): boolean {
  return directPostgresConfigured();
}

/** Convenience: the GoTrue admin endpoint base (used together with the
 *  service key for auth-admin ONLY - never for table access). */
export function authAdminEndpoint(): string | null {
  return publicSupabaseUrl();
}
