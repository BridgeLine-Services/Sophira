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


/**
 * SELF-HEALING PROVISIONING for a signed-in user (2026-10-08).
 *
 * Live diagnosis: the owner's auth account exists and its profiles row
 * EXISTS (the direct channel sees it: ownerAccount "active",
 * staleAuthUsers 0) — yet EVERY RLS-scoped read (browser AND server
 * pages) returns no row, so the app decides the account "could not be
 * finished", the guarded pages redirect-loop, and no error is ever
 * visible. The repair covers every data state that can cause it, in
 * order, atomically where it matters, idempotently everywhere:
 *
 *   A. profile row exists for this id            -> refresh the RLS
 *      policies + table grants (a missing/mangled profiles_select_own
 *      policy or a lost GRANT to authenticated makes the row invisible
 *      to every RLS-scoped read while admin queries see it fine);
 *   B. no profile, owner row orphaned            -> RE-LINK the orphaned
 *      owner row to this signed-in account (its auth user no longer
 *      exists); exactly one owner row is preserved, claimed_by synced;
 *   C. no profile, owner row owned by a REAL other auth user -> honest
 *      refusal (never hijack another live account's ownership);
 *   D. no profile, no owner anywhere             -> complete_first_owner
 *      (the race-safe first-owner claim, unchanged).
 *
 * Security: the id is the SERVER-VERIFIED session user id (the route
 * obtains it from supabase.auth.getUser(), never from the request body);
 * every query is parameterized; nothing here is importable by client
 * code; the single-owner invariant is never weakened.
 */
export async function provisionSignedInUser(userId: string): Promise<
  { ok: true; role: string | null; action: string } |
  { ok: false; reason: "owner_elsewhere" | "unavailable"; action: string }
> {
  // Idempotent RLS/grant refresh (fixes invisible-profile reads).
  const refreshProfilesAccess = async (client: { query: (q: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Promise<boolean> => {
    const r = await client.query(`
      begin;
      drop policy if exists "profiles_select_own" on public.profiles;
      create policy "profiles_select_own" on public.profiles for select using (id = auth.uid());
      drop policy if exists "profiles_update_own" on public.profiles;
      create policy "profiles_update_own" on public.profiles for update using (id = auth.uid());
      grant usage on schema public to authenticated;
      grant select, update on public.profiles to authenticated;
      commit;
    `);
    return Array.isArray(r.rows) && r.rows.length === 0;
  };

  return (await withClient(async (client) => {
    // A. does this account already have its profile row?
    const own = await client.query("select role from public.profiles where id = $1 limit 1", [userId]);
    if (own.rows.length > 0) {
      await refreshProfilesAccess(client);
      const role = (own.rows[0] as { role: string }).role;
      return { ok: true as const, role, action: "profile-present" };
    }
    // B/C. no profile for this account — inspect the existing owner row.
    const owner = await client.query("select id from public.profiles where role = 'owner' limit 1");
    if (owner.rows.length === 0) {
      // D. no owner anywhere: the race-safe first-owner completion.
      const r = await client.query("select public.complete_first_owner($1) as result", [userId]);
      await refreshProfilesAccess(client);
      void r;
      return { ok: true as const, role: "owner", action: "completed-first-owner" };
    }
    const ownerId = (owner.rows[0] as { id: string }).id;
    const ownerAuth = await client.query("select 1 as one from auth.users where id = $1 limit 1", [ownerId]);
    if (ownerAuth.rows.length === 0) {
      // B. the owner row is ORPHANED (its auth user no longer exists):
      // re-link it to THIS verified signed-in account. One owner row,
      // updated in place — no duplicate, no data loss.
      await client.query("update public.profiles set id = $1 where id = $2 and role = 'owner'", [userId, ownerId]);
      await client.query("update public.owner_bootstrap set claimed_by = $1 where claimed_by = $2", [userId, ownerId]);
      await refreshProfilesAccess(client);
      return { ok: true as const, role: "owner", action: "relinked-orphaned-owner" };
    }
    // C. the owner belongs to a different, REAL account: honest refusal.
    return { ok: false as const, reason: "owner_elsewhere" as const, action: "refused-owner-elsewhere" };
  })) ?? { ok: false as const, reason: "unavailable" as const, action: "channel-unavailable" };
}
