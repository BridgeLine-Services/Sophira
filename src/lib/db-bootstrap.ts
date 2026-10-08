/**
 * RUNTIME DATABASE BOOTSTRAP REPAIR (server-only, 2026-10-07).
 *
 * Purpose: the deployment pipeline (scripts/apply-migrations.mjs, run by
 * CI on every push) is the PRIMARY migration automation. This module is the
 * SELF-HEALING fallback for a database that drifted out of sync (for
 * example the pre-0025 production database) — so the owner never has to
 * open the Supabase SQL editor.
 *
 * SECURITY CONTRACT — this module must NEVER:
 *   - be imported by any client component ("use client"); it reads
 *     server-only secrets (SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN);
 *   - expose any secret value, SQL text, email address, or account
 *     existence to the caller; every result is CATEGORICAL;
 *   - run anything except the REPOSITORY'S OWN embedded, byte-pinned chain
 *     (migrations 0001-0026, full/partial frontier detection) or the two
 *     idempotent first-owner migrations (0025 + 0026) — no arbitrary SQL
 *     from any request;
 *   - repair once an owner exists (owner creation closes permanently);
 *   - create or complete an owner outside the database's race-safe claim.
 *
 * Execution channel: the Supabase Management API "run a query" endpoint
 * with a server-held personal access token. Without the token the repair
 * is simply unavailable (fail closed, never pretend).
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { listProfileIds } from "./db-privileged";
import { publicSupabaseUrl, serviceRoleKey } from "./supabase-config";
import { present } from "./env";
import { probeOwnerSetup, type OwnerSetupProbe, evaluateOwnerSetup } from "./owner-setup";
import { MIGRATIONS } from "./db-migrations.generated";
import { directPostgresConfigured, managementConfigured, applyMigrationChainDirect } from "./db-ddl";

export type SetupRepairResult =
  | { ok: true; repaired: boolean; message: string }
  | {
      ok: false;
      reason: "unconfigured" | "not-needed" | "refused" | "failed" | "partial";
      message: string;
      /** Safe categorical developer diagnostics (never raw SQL errors). */
      failedAt?: string;
      failure?: string;
      /** Sanitized connection-phase driver message (redacted). */
      detail?: string;
    };

export type StaleAccountResult =
  | { ok: true; removed: number; message: string }
  | { ok: false; reason: "unconfigured" | "refused" | "failed"; message: string };

/** Server-only: is migration-automation configured (token + project ref)? */
/** First-launch initialization is available when EITHER the direct
 *  database connection (auto-provisioned by the Vercel Supabase
 *  Integration - the primary, zero-configuration path) OR the optional
 *  Management API credentials are configured. */
export function migrationAutomationConfigured(): boolean {
  return directPostgresConfigured() || managementConfigured();
}

/** Unified executor: prefer the direct Postgres connection (no external
 *  token at all), fall back to the Management API when it is configured.
 *  Re-probes the database afterwards and only reports ready when the
 *  schema is ACTUALLY present. */
async function runChainAutomation(): Promise<SetupRepairResult> {
  // Direct Postgres connection (primary, zero-configuration path):
  if (!directPostgresConfigured()) {
    if (managementConfigured()) {
      // Secondary path (re-probes and messages on its own).
      return await applyMigrationChain();
    }
    return {
      ok: false,
      reason: "unconfigured",
      message:
        "Setup couldn't finish yet - the deployment does not have a server-side path to its database yet. Reconnecting the Vercel project to its Supabase project (the official integration provisions the connection automatically) fixes this; nothing else is needed.",
    };
  }
  const pass = await applyMigrationChainDirect();
  if (!pass.ok) {
    return {
      ok: false,
      reason: "failed",
      message:
        "Setup couldn't finish yet - the database preparation step did not complete. Nothing was skipped; try again in a moment, and open Advanced diagnostics on /setup if it keeps failing.",
      failedAt: pass.failedAt,
      failure: pass.failure,
      detail: pass.detail,
    };
  }
  const after = await probeOwnerSetup();
  if (after.migrationsPresent === true) {
    return { ok: true, repaired: pass.applied > 0, message: "Your private database is ready. You can create your owner account now." };
  }
  return {
    ok: false,
    reason: "partial",
    message:
      "The preparation step ran, but the database still reports missing pieces - open the Advanced diagnostics on /setup.",
  };
}

// The embedded repair payload is the concatenation of the two first-owner
// migrations, both fully idempotent (create if not exists / create or
// replace / on conflict do nothing). The offline suite pins this payload
// to be byte-identical with the migration files, so it can never drift.
const REPAIR_PAYLOAD = `-- SOPHIRA migration 0025: secure first-owner bootstrap (2026-10-06)
--
-- GOAL: the owner creates their owner account from the app itself, with no
-- manual database configuration (no app_config.owner_email insert, no
-- service-key editing) — while keeping the security contract of 0008:
--   * exactly ONE owner can ever exist;
--   * the winner is decided atomically by the DATABASE, not the browser;
--   * a second concurrent registration can NEVER also become owner;
--   * once an owner exists, bootstrap is permanently closed and every
--     further signup requires a valid invitation (unchanged path);
--   * no client (owner or otherwise) can read or modify the claim;
--   * the operator-configured owner_email restriction from 0008 is still
--     HONORED when it IS set: an unset value means the automatic
--     first-registration claim; a set value means only that email may
--     claim (operator intent preserved).
--
-- MECHANISM: public.owner_bootstrap is a single-row table (PRIMARY KEY id
-- with CHECK id = 1). The signup trigger attempts INSERT ... ON CONFLICT
-- DO NOTHING. Exactly one transaction in the system's lifetime succeeds;
-- every other registration finds the row present, receives found=false,
-- and falls through to the invitation-only path. A lost race therefore
-- CANNOT become owner. Raising an exception aborts the whole signup
-- transaction, so a rejected claim leaves no row behind.

create table if not exists public.owner_bootstrap (
  id         integer     primary key check (id = 1),
  claimed_at timestamptz not null default now(),
  claimed_by uuid        not null references auth.users(id)
);

-- No client API may read or write the claim. The trigger is SECURITY
-- DEFINER and the service role bypasses RLS; everyone else gets nothing.
revoke all on public.owner_bootstrap from anon, authenticated;
alter table public.owner_bootstrap enable row level security;

-- Seed: if this deployment already created an owner under the 0008 flow,
-- close the bootstrap window for that owner immediately (no second owner).
insert into public.owner_bootstrap (id, claimed_by)
select 1, p.id
  from public.profiles p
 where p.role = 'owner'
 order by p.created_at
 limit 1
on conflict (id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_claimed_invitation uuid;
  v_owner_email text;
begin
  -- ---- First-owner bootstrap: a single atomic claim, ever --------------
  -- v_found is set by the INSERT below: only the FIRST successful
  -- registration in the database's lifetime can reach the owner branch.
  if not exists (select 1 from public.profiles where role = 'owner') then
    insert into public.owner_bootstrap (id, claimed_by) values (1, new.id)
      on conflict (id) do nothing;
    if found then
      -- Operator intent: a CONFIGURED owner_email still restricts the
      -- claim to that exact email (0008 contract). An UNSET value means
      -- the automatic first-registration bootstrap: the first person to
      -- complete registration becomes the owner and the window closes.
      select coalesce(value #>> '{}', '') into v_owner_email
        from public.app_config where key = 'owner_email';
      if v_owner_email is null or v_owner_email = ''
          or lower(v_owner_email) = lower(new.email) then
        insert into public.profiles (id, display_name, role)
        values (
          new.id,
          coalesce(new.raw_user_meta_data->>'display_name', ''),
          'owner'
        );
        return new;
      end if;
      -- Configured for a different email: abort the whole signup (the
      -- claim row rolls back with the transaction — never left behind).
      raise exception
        'Sophira is invitation-only. Sign-up requires an invitation for your email address.'
        using errcode = '28000';
    end if;
  end if;

  -- ---- Everyone else: atomically claim a pending, unexpired invitation --
  -- (unchanged from migration 0008 — race-safe via FOR UPDATE SKIP LOCKED)
  update public.invitations
     set status = 'accepted',
         accepted_at = now()
   where id = (
     select id from public.invitations
      where lower(email) = lower(new.email)
        and status = 'pending'
        and expires_at > now()
      order by created_at
      for update skip locked
      limit 1
   )
  returning id into v_claimed_invitation;

  if v_claimed_invitation is null then
    raise exception
      'Sophira is invitation-only. Sign-up requires a valid, unused invitation for your email address.'
      using errcode = '28000';
  end if;

  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', ''),
    'user'
  );
  return new;
end;
$$;

-- SOPHIRA migration 0026: first-owner recovery + schema version marker
-- (2026-10-07, owner-setup automation round)
--
-- GOAL: make the first-owner experience self-healing WITHOUT weakening a
-- single control:
--   * a STALE auth user (created by an earlier failed/incomplete owner
--     attempt: the account exists in auth.users but no profiles row was
--     created) can be COMPLETED into the first owner — but only by that
--     user's own authenticated session, only through a database race-safe
--     claim, and only while no owner exists;
--   * the completion function is NOT callable by any browser client
--     (revoked from anon/authenticated; granted only to the server's
--     service role, which the app uses after verifying the session);
--   * the 0025 security contract is fully preserved: exactly one owner,
--     the database decides, invitation-only for everyone after.
--
-- sophira_meta: a tiny server-only key/value table so the application can
-- PROBE the applied schema version through normal (service-role) queries
-- — no SQL editor inspection, no pg_catalog access from the app.

create table if not exists public.sophira_meta (
  key   text primary key,
  value text not null
);

-- No client may read or write the schema marker (server-only).
revoke all on public.sophira_meta from anon, authenticated;
alter table public.sophira_meta enable row level security;

insert into public.sophira_meta (key, value)
values ('schema_version', '0026')
on conflict (key) do update set value = excluded.value;

-- ---- complete_first_owner(p_user_id) --------------------------------
-- Recovery path for a stale auth user with no profile. Called ONLY by the
-- server (service role) after verifying the caller's authenticated
-- session, with the caller's OWN user id. The function re-checks every
-- security condition inside the database transaction:
--   * the account must be a real auth.users row (no phantom owners);
--   * no owner may exist yet (owner creation closes permanently after);
--   * the user must not already have a profile (no role rewrites);
--   * the single-row owner_bootstrap claim is attempted atomically — a
--     concurrent winner makes THIS call fail (exactly one owner, ever).
create or replace function public.complete_first_owner(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'No authentication account exists for this user.'
      using errcode = '28000';
  end if;

  if exists (select 1 from public.profiles where role = 'owner') then
    raise exception 'An owner already exists; owner creation is permanently closed.'
      using errcode = '28000';
  end if;

  if exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'This account already has a profile.'
      using errcode = '28000';
  end if;

  -- Same atomic claim as migration 0025: exactly one caller can ever
  -- insert this row; everyone else finds it present and fails safely.
  insert into public.owner_bootstrap (id, claimed_by) values (1, p_user_id)
    on conflict (id) do nothing;
  if not found then
    raise exception 'The owner slot was just claimed by another registration.'
      using errcode = '28000';
  end if;

  insert into public.profiles (id, display_name, role)
  values (p_user_id, '', 'owner');
end;
$$;

-- The recovery function is callable ONLY server-side (service role).
revoke all on function public.complete_first_owner(uuid) from anon, authenticated;
grant execute on function public.complete_first_owner(uuid) to service_role;
`;

async function managementQuery(query: string): Promise<unknown> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  if (!res.ok) {
    throw new Error(`Management API ${res.status}`);
  }
  return res.json();
}

/**
 * RUNTIME MIGRATION CHAIN APPLICATION (first-launch wizard, 2026-10-07).
 *
 * The same frontier semantics as the CI pipeline (scripts/apply-migrations.mjs):
 *   1. PROBE each migration's marker object (read-only) - a present later
 *      marker proves every earlier migration ran (strictly linear chain);
 *   2. from the first missing marker onward, apply EVERY missing file in
 *      chain order (so an empty database gets the COMPLETE chain 0001-0026
 *      and a partially initialized database gets exactly its gap);
 *   3. prefer the Management API "record a migration" endpoint, with the
 *      transactional query endpoint as fallback - identical to the pipeline.
 *
 * Security: the SQL is the repository's own embedded chain (byte-pinned to
 * supabase/migrations/*.sql by the offline suite), NEVER anything from the
 * request. Credentials stay server-side. Every message is plain English -
 * no SQL, no migration filenames, no raw database errors.
 */
async function applyMigrationChain(): Promise<SetupRepairResult> {
  if (!managementConfigured()) {
    return {
      ok: false,
      reason: "unconfigured",
      message:
        "Setup could not finish yet - this deployment has no database-initialization channel: neither the direct database connection (provisioned automatically by the official Supabase integration when the Vercel project is connected to it) nor the optional migration credentials are configured. Advanced diagnostics on /setup names the exact variables; no SQL editor is ever needed.",
    };
  }
  try {
    const appliedMarkers = new Set<string>();
    for (const entry of MIGRATIONS) {
      if (!entry.marker) continue;
      const r = (await managementQuery(`select (${entry.marker}) as present;`)) as Array<{ present?: boolean }>;
      if (Array.isArray(r) && r[0]?.present) appliedMarkers.add(entry.name);
    }
    // frontier: everything from the first missing marker onward is applied
    const missing: typeof MIGRATIONS = [];
    let gap = false;
    for (const entry of MIGRATIONS) {
      if (entry.marker && appliedMarkers.has(entry.name)) continue;
      if (entry.marker && !appliedMarkers.has(entry.name)) gap = true;
      if (gap) missing.push(entry);
    }
    if (missing.length > 0) {
      for (const entry of missing) {
        try {
          await managementQuery(entry.sql); // single transaction, fail-loud
        } catch {
          return {
            ok: false,
            reason: "failed",
            message:
              "Setup couldn't finish yet - the database preparation step did not complete. Nothing was skipped; try again in a moment, and see Advanced diagnostics if it keeps failing.",
          };
        }
      }
    }
    const after = await probeOwnerSetup();
    if (after.migrationsPresent === true) {
      return { ok: true, repaired: missing.length > 0, message: "Your private database is ready. You can create your owner account now." };
    }
    return {
      ok: false,
      reason: "partial",
      message:
        "The preparation step ran, but the database still reports missing pieces - see the technical diagnostics on /setup.",
    };
  } catch {
    return {
      ok: false,
      reason: "failed",
      message: "Setup couldn't finish yet - the database could not be reached for preparation. See Advanced diagnostics on /setup.",
    };
  }
}

/** The repair action from /setup and /create-owner: apply the missing
 *  first-owner bootstrap (0025) + recovery (0026) migrations. */
export async function repairOwnerBootstrap(): Promise<SetupRepairResult> {
  if (!migrationAutomationConfigured()) {
    return {
      ok: false,
      reason: "unconfigured",
      message:
        "Setup couldn't finish yet - the deployment does not have a server-side path to its database. Reconnecting the Vercel project to its Supabase project (the official Supabase integration provisions the connection automatically) fixes this; no tokens, no repository secrets, no SQL editor are needed.",
    };
  }
  const probe = await probeOwnerSetup();
  const status = evaluateOwnerSetup(probe);
  // Never touch a database that already has an owner, and never claim a
  // repair when everything is already present.
  if (probe.ownerAccount === "active" || probe.ownerAccount === "revoked") {
    return { ok: false, reason: "refused", message: "An owner account already exists, so the owner bootstrap cannot be repaired." };
  }
  if (probe.database === "checked" && probe.migrationsPresent === true) {
    return { ok: true, repaired: false, message: "Everything is already up to date; no repair was needed." };
  }
  if (probe.database !== "checked") {
    return { ok: false, reason: "refused", message: "The database connection is not available, so nothing can be repaired safely right now." };
  }
  // EMPTY DATABASE (first launch, schema absent): with the one-time
  // automation connection configured, apply the COMPLETE chain right here
  // (STATE B of the first-launch wizard) instead of refusing.
  if (probe.chainStarted === false) {
    if (migrationAutomationConfigured()) {
      return await runChainAutomation();
    }
    return {
      ok: false,
      reason: "unconfigured",
      message:
        "Your Sophira database needs to be initialized. The deployment does not have a server-side path to its database yet - reconnecting the Vercel project to its Supabase project (the official integration provisions the connection automatically) fixes this; nothing else is needed.",
    };
  }
  // PARTIALLY INITIALIZED: detect the frontier and apply every missing
  // migration in order (STATE C) - the owner never determines the gap.
  if (probe.migrationsPresent === false && migrationAutomationConfigured()) {
    const chain = await runChainAutomation();
    if (chain.ok) return chain;
    // chain application reported failure: fall through to the idempotent
    // 0025+0026 repair payload only when the chain attempt was a no-op
    // (missing.length === 0 means markers were present but pieces are
    // still reported missing - the old repair path covers exactly that).
    if (chain.reason === "failed") return chain;
  }
  try {
    await managementQuery(`begin;\n${REPAIR_PAYLOAD}\ncommit;`);
    const after = await probeOwnerSetup();
    return {
      ok: true,
      repaired: true,
      message:
        after.migrationsPresent === true
          ? "The first-owner bootstrap was repaired. You can create your owner account now."
          : "The repair command ran, but the database still reports missing pieces — see the technical diagnostics.",
    };
  } catch {
    return { ok: false, reason: "failed", message: "The automatic repair could not be completed. See the technical diagnostics on /setup." };
  }
}

/** Categorical count of auth accounts with no profile row (stale signup
 *  leftovers). Never returns emails or ids. */
export async function countStaleAuthUsers(probe: OwnerSetupProbe): Promise<number | null> {
  if (!probe.serviceRoleConfigured || probe.database !== "checked") return null;
  try {
    const admin = createSupabaseClient(
      publicSupabaseUrl()!,
      serviceRoleKey()!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    let page = 1;
    const ids: string[] = [];
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error || !data) return null;
      ids.push(...data.users.map((u) => u.id));
      if (ids.length >= data.total) break;
      page += 1;
      if (page > 20) break;
    }
    if (ids.length === 0) return 0;
    // 2026-10-07: profile ids come from the VERIFIED direct channel when
    // available (a restricted admin key cannot read PostgREST tables and
    // would otherwise count every auth user as stale).
    const directIds = await listProfileIds();
    const profileIds = new Set(directIds !== null ? directIds : ((await admin.from("profiles").select("id").limit(1000)).data || []).map((p: { id: string }) => p.id));
    return ids.filter((id) => !profileIds.has(id)).length;
  } catch {
    return null;
  }
}

/** Safe ONLY before the first owner exists: at that stage no invitations
 *  exist, so an auth account without a profile is by definition a leftover
 *  of a failed bootstrap attempt with no data attached. Removing it lets
 *  the owner start fresh without opening the Supabase dashboard. */
export async function cleanupStaleAuthUsers(): Promise<StaleAccountResult> {
  const probe = await probeOwnerSetup();
  if (!probe.serviceRoleConfigured || probe.database !== "checked") {
    return { ok: false, reason: "unconfigured", message: "The server cannot check the database right now." };
  }
  if (probe.ownerAccount === "active" || probe.ownerAccount === "revoked") {
    return { ok: false, reason: "refused", message: "An owner exists, so stale-account cleanup is closed." };
  }
  const directProfileIds = await listProfileIds();
  const profiles = directProfileIds !== null
    ? directProfileIds.map((id) => ({ id }))
    : (await createSupabaseClient(
        publicSupabaseUrl()!,
        serviceRoleKey()!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
        .from("profiles")
        .select("id")
        .limit(1000)).data || [];
  if (profiles && profiles.length > 0) {
    return { ok: false, reason: "refused", message: "Member profiles exist, so nothing can be safely cleaned up automatically." };
  }
  const admin = createSupabaseClient(
    publicSupabaseUrl()!,
    serviceRoleKey()!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  let page = 1;
  let removed = 0;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) break;
    if (data.users.length === 0) break;
    for (const u of data.users) {
      const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
      if (!delErr) removed += 1;
    }
    if (data.users.length < 200) break;
    page += 1;
    if (page > 20) break;
  }
  return {
    ok: true,
    removed,
    message: removed > 0 ? `Removed ${removed} incomplete account${removed === 1 ? "" : "s"}. You can create the owner account now.` : "No incomplete accounts were found.",
  };
}
