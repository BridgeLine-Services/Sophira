import { MIGRATIONS } from "@/lib/db-migrations.generated";
import { applyMigrationChainDirect, directPostgresConfigured, managementConfigured } from "@/lib/db-ddl";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";

/**
 * DATABASE UPDATES (2026-11-11) — the owner-facing half of the migration chain.
 *
 * Why this exists: the chain automation already lived in db-bootstrap, but its
 * entry point only ran while the database was EMPTY or while no owner existed
 * (it refuses to touch a database that already has an owner). So once a live
 * deployment had drifted — nine tables behind, exactly what happened on
 * 2026-11-11 — there was no button anywhere for the owner to press. /install is
 * the PWA install page, and the Owner Dashboard had nothing.
 *
 * Rules this module keeps:
 *  - The SQL is ALWAYS the repository's embedded chain (db-migrations.generated),
 *    never anything from a request.
 *  - Only migrations whose probe says they are missing are applied, in order.
 *  - A migration with no probe cannot be silently skipped: it is reported as
 *    "unverifiable" and the whole run is marked incomplete (see
 *    scripts/migration-markers.mjs and the marker-coverage test).
 *  - Every message is plain English: no SQL, no raw database errors.
 */
export interface MigrationStep {
  name: string;
  /** Human label from the file name, e.g. "member notifications". */
  label: string;
  state: "applied" | "pending" | "unverifiable";
}

export interface MigrationReport {
  total: number;
  applied: number;
  pending: MigrationStep[];
  unverifiable: string[];
  channel: "direct-postgres" | "management" | "none";
  upToDate: boolean;
  /** True when pending work cannot be applied from the app until the channel exists. */
  blocked: boolean;
  message: string;
}

const labelFor = (name: string): string => {
  const base = name.replace(/^\d+_/, "").replace(/\.sql$/, "").replace(/_/g, " ");
  return base.charAt(0).toUpperCase() + base.slice(1);
};

function channel(): MigrationReport["channel"] {
  if (directPostgresConfigured()) return "direct-postgres";
  if (managementConfigured()) return "management";
  return "none";
}

/**
 * Ask the database which migrations it already has.
 *
 * Uses the probes in scripts/migration-markers.mjs, embedded at build time in
 * db-migrations.generated (each entry carries its own marker). A marker is a
 * question with a yes/no answer; no marker means we cannot know, and "cannot
 * know" is reported as unverifiable rather than assumed applied.
 */
export async function migrationReport(): Promise<MigrationReport> {
  const supabase = createClient();
  const pending: MigrationStep[] = [];
  const unverifiable: string[] = [];
  let applied = 0;
  let reachable = true;

  for (const entry of MIGRATIONS) {
    const step: MigrationStep = { name: entry.name, label: labelFor(entry.name), state: "pending" };
    if (!entry.marker) {
      unverifiable.push(entry.name);
      continue;
    }
    try {
      // Ask the database directly through the reader we already trust (the
      // service-role client this app uses for owner diagnostics). A probe is a
      // single read-only expression; it never changes anything.
      const { data, error } = await supabase.rpc("sophira_marker_present", { probe: entry.marker });
      if (error) throw error;
      if (data === true) {
        applied++;
        step.state = "applied";
      } else {
        pending.push(step);
      }
    } catch {
      // The probe RPC may not exist yet on an older database. Fall back to the
      // chain applier's own knowledge: if we cannot read, we cannot claim.
      reachable = false;
      pending.push(step);
    }
  }

  const ch = channel();
  const upToDate = pending.length === 0 && unverifiable.length === 0;
  return {
    total: MIGRATIONS.length,
    applied,
    pending,
    unverifiable,
    channel: ch,
    upToDate,
    blocked: !upToDate && ch === "none",
    message: upToDate
      ? "Your database is up to date."
      : !reachable
        ? "Sophira could not read the database's version list, so it cannot say what is missing. Nothing was changed."
        : ch === "none"
          ? "This deployment has no server-side path to its database, so updates cannot be applied from here. Reconnecting the Vercel project to its Supabase project fixes this."
          : `${pending.length} update${pending.length === 1 ? "" : "s"} waiting to be applied.`,
  };
}

export interface ApplyResult {
  ok: boolean;
  appliedNow: number;
  message: string;
  report: MigrationReport;
}

/** Owner identity check used by the route: authenticated, active, role owner. */
export async function ownerGate(): Promise<{ ok: true; userId: string } | { ok: false; status: number }> {
  const supabase = createClient();
  try {
    const user = await requireUser(supabase);
    const { profile } = await readProfileWithRepair(supabase, user.id);
    if (!profile || profile.role !== "owner") return { ok: false, status: 403 };
    return { ok: true, userId: user.id };
  } catch {
    return { ok: false, status: 401 };
  }
}

/**
 * Apply every migration the database is missing, in chain order.
 *
 * Deliberately ONE function for "apply what is missing" rather than a per-file
 * endpoint: the chain depends on order, and letting a browser choose a file
 * would let it pick a migration whose prerequisites are absent.
 */
export async function applyPendingMigrations(): Promise<ApplyResult> {
  const before = await migrationReport();
  if (before.upToDate) {
    return { ok: true, appliedNow: 0, message: "Your database is already up to date. Nothing to do.", report: before };
  }
  if (before.blocked) {
    return { ok: false, appliedNow: 0, message: before.message, report: before };
  }
  if (before.unverifiable.length > 0) {
    return {
      ok: false,
      appliedNow: 0,
      message:
        "Sophira cannot confirm which updates are missing, because a migration has no check it can ask the database. Nothing was changed. This is a bug to fix, not something to retry.",
      report: before,
    };
  }
  try {
    const pass = await applyMigrationChainDirect();
    const after = await migrationReport();
    if (!pass.ok) {
      return {
        ok: false,
        appliedNow: pass.applied ?? 0,
        message:
          "The update stopped partway. Nothing after the failure was applied, and everything before it is already saved. Try again in a moment.",
        report: after,
      };
    }
    return {
      ok: after.upToDate,
      appliedNow: pass.applied ?? 0,
      message: after.upToDate
        ? "Your database is now up to date."
        : `${pass.applied ?? 0} update${(pass.applied ?? 0) === 1 ? "" : "s"} applied, but the database still reports missing pieces. Try again, and if it repeats, open System Health.`,
      report: after,
    };
  } catch {
    return {
      ok: false,
      appliedNow: 0,
      message: "The database could not be reached to apply updates. Nothing was changed. Try again in a moment.",
      report: before,
    };
  }
}
