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
 * THE GRANTS CONTRACT (migration 0027, pinned byte-identical to the
 * >>> grants:begin/end <<< block in supabase/migrations/0027_grants_backfill.sql —
 * the offline suite fails if they drift).
 *
 * Root cause of the 2026-10-08 owner-account failures: tables created by
 * the first-launch wizard over the direct channel had NO grants for the
 * anon/authenticated roles (modern Supabase projects do not add the
 * classic default privileges), so EVERY authenticated PostgREST query
 * failed with "permission denied for table X" — surfaced as
 * "profile could not be read", "Could not save: permission denied for
 * table writing_samples", and "No baseline yet". RLS policies were never
 * even reached.
 */
export const GRANTS_SQL = `grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

do $$
declare r text;
begin
  foreach r in array array['postgres', 'supabase_admin', 'supabase_auth_admin'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      begin
        execute format('alter default privileges for role %I in schema public grant select on tables to anon, authenticated', r);
        execute format('alter default privileges for role %I in schema public grant select, insert, update, delete on tables to authenticated', r);
        execute format('alter default privileges for role %I in schema public grant usage, select on sequences to anon, authenticated', r);
      exception when insufficient_privilege then null;
      end;
    end if;
  end loop;
end $$;`;

/** Categorical grant diagnostic for the setup-status endpoint (never
 *  returns data — only whether the grants contract is in place). */
export async function checkAuthenticatedGrants(): Promise<{ profiles: boolean | null; writingSamples: boolean | null }> {
  const r = await withClient(async (client) => {
    const res = await client.query(`
      select
        exists(select 1 from information_schema.role_table_grants
               where table_schema='public' and table_name='profiles' and grantee='authenticated' and privilege_type='SELECT') as profiles,
        exists(select 1 from information_schema.role_table_grants
               where table_schema='public' and table_name='writing_samples' and grantee='authenticated' and privilege_type='SELECT') as writing_samples
    `);
    return res.rows[0] as { profiles: boolean; writing_samples: boolean };
  });
  return r !== null ? { profiles: r.profiles, writingSamples: r.writing_samples } : { profiles: null, writingSamples: null };
}

/**
 * OWNER STATS FUNCTION REPAIR (2026-10-08): the live owner dashboard fails
 * with "structure of query does not match function result type" — the
 * deployed network_stats() is structurally broken at runtime. Migration
 * 0028 recreates it collision-proof; the wizard chain applies it to new
 * databases, and THIS idempotent check applies it to the LIVE database at
 * the owner's next authenticated page load (only the owner can trigger
 * provisioning here, and the function is owner-only anyway). The SQL is
 * pinned to the migration file by the offline suite.
 */
const OWNER_STATS_SQL = `drop function if exists public.network_stats();

create or replace function public.network_stats()
returns table (
  o_user_id uuid,
  o_display_name text,
  o_email text,
  o_role text,
  o_status text,
  o_access_revoked_at timestamptz,
  o_onboarded boolean,
  o_can_request_invites boolean,
  o_created_at timestamptz,
  o_last_active_at timestamptz,
  o_assignment_count bigint,
  o_response_count bigint,
  o_subject_usage jsonb
)
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'owner') then
    raise exception 'network_stats is owner-only' using errcode = '42501';
  end if;

  return query
  select
    p.id                                   ::uuid,
    p.display_name                         ::text,
    au.email                               ::text,
    p.role                                 ::text,
    p.status                               ::text,
    p.access_revoked_at                    ::timestamptz,
    p.onboarded                            ::boolean,
    p.can_request_invites                  ::boolean,
    p.created_at                           ::timestamptz,
    p.last_active_at                       ::timestamptz,
    (select count(*) from public.assignments a
      where a.user_id = p.id)              ::bigint,
    (select count(*) from public.responses r
      where r.user_id = p.id)              ::bigint,
    coalesce((
      select jsonb_agg(jsonb_build_object('subject', s.subject, 'count', s.c))
      from (
        select a.subject, count(*) as c
        from public.assignments a
        where a.user_id = p.id and a.subject is not null
        group by a.subject
        order by c desc
      ) s
    ), '[]'::jsonb)                        ::jsonb
  from public.profiles p
  join auth.users au on au.id = p.id;
end;
$$;

revoke all on function public.network_stats() from anon, authenticated;
grant execute on function public.network_stats() to authenticated;
`;

async function ensureOwnerStatsFunction(client: { query: (q: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Promise<void> {
  const r = await client.query(
    "select 1 as one from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'network_stats' and n.nspname = 'public' and p.proargnames is not null and p.proargnames[1] = 'o_user_id' limit 1"
  );
  if (r.rows.length === 0) {
    await client.query(OWNER_STATS_SQL);
  }
}

/**
 * SELF-HEALING PROVISIONING v2 for a signed-in user (2026-10-08).
 *
 * Runs on first authenticated load whenever a profile read fails, and at
 * sign-in when the browser sees no profile. Idempotent, in priority order:
 *
 *   A. ensure the 0027 grants contract (fixes "permission denied" for
 *      EVERY table, not just profiles);
 *   B. ensure this account has a profiles row (a real auth user can only
 *      exist if its signup was trigger-approved — an uninvited account
 *      is impossible, so backfilling the row is contract-safe);
 *   C. keep the owner unambiguous: the existing owner row wins; if the
 *      signed-in user IS the owner (id match) nothing changes; if no
 *      owner exists anywhere, the signed-in account claims it via the
 *      race-safe complete_first_owner function.
 *
 * Security: the id is the SERVER-VERIFIED session user id (obtained via
 * supabase.auth.getUser(), never from request input); every query is
 * parameterized; nothing here is importable by client code; the
 * single-owner invariant is enforced by owner_bootstrap, unchanged.
 */
export async function provisionSignedInUser(userId: string): Promise<
  { ok: true; role: string | null; action: string } |
  { ok: false; reason: "unavailable"; action: string }
> {
  const r = await withClient(async (client) => {
    // A. THE GRANTS CONTRACT — fixes permission-denied reads on every table.
    await client.query(GRANTS_SQL);

    // A2. Owner statistics service repair (idempotent; applies 0028's
    // function when the deployed one is structurally broken).
    await ensureOwnerStatsFunction(client);

    // B. Does this account already have its profile row?
    const own = await client.query("select role from public.profiles where id = $1 limit 1", [userId]);
    if (own.rows.length > 0) {
      const role = (own.rows[0] as { role: string }).role;
      return { ok: true as const, role, action: role === "owner" ? "grants-ensured-owner" : "grants-ensured" };
    }

    // No profile for this account. An auth user can only exist if its
    // signup was trigger-approved (invitation accepted / first-owner), so
    // the row is backfilled — never a dead-end 403 again.
    await client.query(
      "insert into public.profiles (id, display_name, role) select $1, coalesce(u.raw_user_meta_data->>'display_name',''), 'user' from auth.users u where u.id = $1 on conflict (id) do nothing",
      [userId]
    );

    // C. Owner explicitness: if this account IS the existing owner row's
    // owner it already returned above. If NO owner exists anywhere, this
    // account claims ownership through the race-safe database function.
    const owner = await client.query("select 1 as one from public.profiles where role = 'owner' limit 1");
    let role = "user";
    if (owner.rows.length === 0) {
      await client.query("select public.complete_first_owner($1) as result", [userId]);
      role = "owner";
    }
    return { ok: true as const, role, action: role === "owner" ? "provisioned-first-owner" : "provisioned-profile" };
  });
  return r ?? { ok: false as const, reason: "unavailable" as const, action: "channel-unavailable" };
}

/**
 * PASSWORD-RESET LINK FIX (2026-10-08): the Supabase Auth Site URL and
 * redirect allow-list can point at a stale/dead deployment domain (the
 * emailed reset links 404'd with DEPLOYMENT_NOT_FOUND). When the Supabase
 * management token is configured, the production origin is verified and
 * — when wrong — corrected, so future emails link to the live app.
 * Never logs or returns tokens; returns a categorical result only.
 */
export async function ensureAuthRedirectConfig(): Promise<"applied" | "already-correct" | "unavailable"> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) return "unavailable";
  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://sophira.vercel.app";
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) return "unavailable";
    const config = (await res.json()) as { site_url?: string; redirect_urls?: string[] };
    const urls = config.redirect_urls ?? [];
    const needsFix = config.site_url !== site || !urls.some((u) => u.startsWith(site));
    if (!needsFix) return "already-correct";
    const merged = Array.from(new Set([site, `${site}/auth/callback`, `${site}/**`, ...urls])).slice(0, 100);
    const patch = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ site_url: site, redirect_urls: merged }),
    });
    return patch.ok ? "applied" : "unavailable";
  } catch {
    return "unavailable";
  }
}
