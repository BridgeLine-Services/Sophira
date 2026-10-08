import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { present } from "./env";
import { setupChannel, connectionTarget } from "./db-ddl";
import { publicSupabaseUrl, publicAnonKey, serviceRoleKey, connectionEnvNames, supabaseConfigStatus } from "./supabase-config";

/**
 * Owner setup / status diagnostic (operator round 2026-10-06).
 *
 * Purpose: give the OPERATOR (the person deploying Sophira) one honest page
 * and one scriptable endpoint that answers "is owner bootstrap ready?"
 * without exposing any secret material and without weakening any control.
 *
 * SECURITY CONTRACT - this module must NEVER:
 *   - return, log, or embed Supabase service-role keys, API keys, passwords,
 *     tokens, or the configured owner_email VALUE;
 *   - imply that Sophira has a predefined/default owner password (it never
 *     did - the owner chooses their own password through the normal signup
 *     flow);
 *   - change the fail-closed bootstrap: no configured owner_email = no first
 *     account; arbitrary first users cannot become owner; users cannot
 *     modify their own role or restore revoked access.
 *
 * It reports CATEGORICAL status only (booleans and small enums). The one
 * place a value could leak is `owner_email` - the probe deliberately keeps
 * only `row exists` and never reads the value into anything returned.
 */

export type OwnerAccountStatus = "unknown" | "none" | "active" | "revoked";
export type DatabaseProbe =
  | "unconfigured" // no service-role key on the server - cannot check
  | "unreachable" // connection failed - cannot check
  | "checked"; // probe ran

export interface OwnerSetupProbe {
  supabaseConfigured: boolean; // NEXT_PUBLIC_SUPABASE_URL + anon key present
  serviceRoleConfigured: boolean; // SUPABASE_SERVICE_ROLE_KEY present (server only)
  aiConfigured: boolean; // a usable remote provider: GEMINI_API_KEY (free tier), or a paid key with paid use explicitly allowed
  database: DatabaseProbe;
  migrationsPresent: boolean | null; // null = could not check
  ownerEmailConfigured: boolean | null; // null = could not check (never the value)
  ownerAccount: OwnerAccountStatus; // categorical only, never email/id
  /** 2026-10-07 automation round: fine-grained readiness probes so the app
   *  can SELF-HEAL instead of telling the operator to run SQL by hand. */
  chainStarted: boolean | null; // app_config exists (0008) - the chain began
  invitationsPresent: boolean | null; // the invitations table exists (0002/0006)
  ownerBootstrapPresent: boolean | null; // the single-row claim table exists (0025)
  recoveryPresent: boolean | null; // sophira_meta.schema_version row exists (0026)
  migrationAutomationConfigured: boolean; // direct Postgres connection OR Management API credentials
  /** Categorical names-only diagnostics: which direct-connection env
   *  conventions this deployment provides (values are NEVER included). */
  connectionEnvNames: string[];
  /** Whether the deployment's direct connection points at THIS project's
   *  own Supabase database ("same-project"), a different database
   *  ("foreign" - never used for migrations), or is absent ("none"). */
  connectionTarget: "same-project" | "foreign" | "none";
  /**
   * PRECISE database-failure diagnostics (requirement A-F separation,
   * 2026-10-07): when the service-role client initializes but the database
   * query fails (state C - NOT the same as A "config missing" or D/E
   * "migration failure"), this carries the exact category and a sanitized
   * driver message. Secrets, keys, and long tokens are always redacted.
   */
  databaseError:
    | { category: "auth-rejected" | "network" | "server-error"; message: string }
    | null;
  /** 2026-10-07 second automation round: the PRECISE channel (or "none") so
   *  the setup UI can diagnose the exact missing infrastructure capability
   *  instead of a vague "administrator connection". Categorical only. */
  setupChannel: "direct-postgres" | "management-api" | "none";
}

export interface OwnerSetupStep {
  done: boolean | null; // true / false / null (cannot check)
  label: string; // what the operator sees
  detail: string; // honest explanation
}

export type OwnerSetupState =
  | "OWNER_EXISTS" // the single owner exists - creation closed
  | "READY" // no owner yet, database ready - create it now
  | "SETUP_REQUIRED" // something is missing (repairable or not)
  | "TEMPORARILY_UNAVAILABLE"; // cannot determine (missing config / unreachable)

export interface OwnerSetupRepair {
  available: boolean; // can Sophira repair it itself right now?
  action: "migrations" | null; // what the single repair action does
  reason: string; // plain language, never secret material
}

export interface OwnerSetupStatus {
  state: OwnerSetupState; // safe coarse state for normal users (D)
  repair: OwnerSetupRepair;
  staleAuthUsers: number | null; // accounts without profiles (categorical count only)
  probe: OwnerSetupProbe;
  /** The exact missing infrastructure capability, or null (requirement K/L).
   *  Categorical only - never a credential, never a connection string. */
  capability:
    | "supabase-credentials"
    | "service-role"
    | "initialization-channel"
    | "foreign-database"
    | null;
  steps: OwnerSetupStep[];
  ready: boolean | null; // null = cannot determine (missing config)
  headline: string;
  guidance: string[]; // exact operator actions, in order
  /** 2026-10-06 first-owner bootstrap: can the owner create their account
   *  from the app right now, with no manual database configuration? This is
   *  INDEPENDENT of AI configuration and of app_config.owner_email. */
  ownerCreation: {
    possible: boolean | null; // null = cannot determine yet
    reason: string; // plain language, never secret material
    url: string; // where to go ("/create-owner") or "" when not possible
  };
}

export function serviceRoleConfigured(): boolean {
  // The authoritative layer resolves BOTH key conventions (legacy
  // service-role name and the new-style secret-key alias).
  return publicSupabaseUrl() !== null && serviceRoleKey() !== null;
}

/**
 * Probe the live database with the SERVER-ONLY service-role client.
 * Every failure mode degrades to "cannot check" - never a crash, never a
 * false "ok". Runs a handful of tiny queries:
 *   - public.app_config (migration 0008) - and whether owner_email is set
 *   - public.profiles.role / .status / .access_revoked_at (0001/0005/0019)
 *   - public.student_memories (migration 0020 - the newest chain end)
 */
export async function probeOwnerSetup(): Promise<OwnerSetupProbe> {
  const probe: OwnerSetupProbe = {
    supabaseConfigured: publicSupabaseUrl() !== null && publicAnonKey() !== null,
    serviceRoleConfigured: serviceRoleConfigured(),
    // Free-first policy: the Gemini free tier counts as configured; a paid
    // OpenAI key counts ONLY when ALLOW_PAID_AI=true or budget > 0
    // (zero-billing defaults leave it inert — never silently spend money).
    aiConfigured:
      present("GEMINI_API_KEY") ||
      (present("OPENAI_API_KEY") &&
        (process.env.ALLOW_PAID_AI === "true" ||
          (parseFloat(process.env.MONTHLY_AI_BUDGET_USD || "0") || 0) > 0)),
    database: "unconfigured",
    migrationsPresent: null,
    ownerEmailConfigured: null,
    ownerAccount: "unknown",
    chainStarted: null,
    invitationsPresent: null,
    ownerBootstrapPresent: null,
    recoveryPresent: null,
    migrationAutomationConfigured: setupChannel() !== "none",
    connectionEnvNames: connectionEnvNames(),
    connectionTarget: connectionTarget(),
    setupChannel: setupChannel(),
    databaseError: null,
  };
  if (!probe.serviceRoleConfigured) return probe;

  try {
    const admin = createSupabaseClient(
      publicSupabaseUrl()!,
      serviceRoleKey()!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ---- migration 0008: app_config exists (and owner_email configured?) ----
    const { data: configRows, error: configErr } = await admin
      .from("app_config")
      .select("key")
      .eq("key", "owner_email")
      .limit(1);
    if (configErr && isMissingRelation(configErr)) {
      return { ...probe, database: "checked", chainStarted: false, migrationsPresent: false };
    }
    if (configErr)
      return { ...probe, database: "unreachable", databaseError: categorizeDbError(configErr) };
    probe.database = "checked";
    probe.chainStarted = true;
    probe.migrationsPresent = true;
    probe.ownerEmailConfigured = Array.isArray(configRows) && configRows.length > 0; // row for key='owner_email' actually present

    // ---- migration 0019: profiles.access_revoked_at column ----
    const { error: colErr } = await admin
      .from("profiles")
      .select("access_revoked_at")
      .limit(1);
    if (colErr && (isMissingRelation(colErr) || isMissingColumn(colErr))) {
      // 0019 missing on an older database: record it and KEEP PROBING - the
      // repair UX below needs the owner-account status, and profiles (0001)
      // is still trustworthy. Never return early on a missing marker.
      probe.migrationsPresent = false;
    } else if (colErr) {
      probe.database = "unreachable";
      probe.databaseError = categorizeDbError(colErr);
      probe.migrationsPresent = null;
      probe.ownerEmailConfigured = null;
      probe.ownerAccount = "unknown";
      return probe;
    }

    // ---- migration 0020: student_memories ----
    const { error: memErr } = await admin
      .from("student_memories")
      .select("id")
      .limit(1);
    if (memErr && isMissingRelation(memErr)) {
      // 0020 missing: same fall-through as 0019 - keep probing so the
      // owner-account status and repair guidance stay honest.
      probe.migrationsPresent = false;
    } else if (memErr) {
      probe.database = "unreachable";
      probe.databaseError = categorizeDbError(memErr);
      probe.migrationsPresent = null;
      return probe;
    }

    // ---- migration 0025: owner_bootstrap (first-owner claim table) ----
    const { error: bootErr } = await admin
      .from("owner_bootstrap")
      .select("id")
      .limit(1);
    if (bootErr && isMissingRelation(bootErr)) {
      probe.ownerBootstrapPresent = false;
      probe.recoveryPresent = false;
      probe.migrationsPresent = false;
      // Do NOT return early: the owner-account check below must still run
      // (profiles is from 0001, so it is trustworthy) - the repair UX needs
      // to know whether an owner exists before offering any repair.
    } else {
      probe.ownerBootstrapPresent = true;
    }

    // ---- invitations table (0002/0006): the invitation system ----
    const { error: invErr } = await admin.from("invitations").select("id").limit(1);
    probe.invitationsPresent = invErr && isMissingRelation(invErr) ? false : !invErr;

    // ---- migration 0026: recovery marker (sophira_meta.schema_version) ----
    if (probe.migrationsPresent !== false) {
      const { error: metaErr } = await admin
        .from("sophira_meta")
        .select("key")
        .eq("key", "schema_version")
        .limit(1);
      probe.recoveryPresent = !metaErr;
      if (metaErr && isMissingRelation(metaErr)) probe.migrationsPresent = false;
    }

    // ---- owner account: categorical status only (never email/id) ----
    const { data: owners, error: ownerErr } = await admin
      .from("profiles")
      .select("role, status")
      .eq("role", "owner")
      .limit(2);
    if (ownerErr) {
      probe.ownerAccount = "unknown";
      return probe;
    }
    if (!owners || owners.length === 0) {
      probe.ownerAccount = "none";
      return probe;
    }
    probe.ownerAccount = owners.some((o) => o.status === "active") ? "active" : "revoked";
    return probe;
  } catch {
    return { ...probe, database: "unreachable" };
  }
}

function sanitizeDbMessage(message: string): string {
  return String(message)
    .replace(/[A-Za-z0-9_\-]{20,}/g, "[redacted]") // any JWT/key-shaped token
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

function categorizeDbError(err: {
  message: string;
  code?: string;
  status?: number;
}): { category: "auth-rejected" | "network" | "server-error"; message: string } {
  const message = String(err.message ?? "unknown error");
  const status = typeof err.status === "number" ? err.status : 0;
  const auth =
    status === 401 ||
    status === 403 ||
    /invalid api key|jwt|apikey|unauthorized|not allowed/i.test(message);
  if (auth) return { category: "auth-rejected", message: sanitizeDbMessage(message) };
  if (/fetch|network|econn|timeout|socket|dns/i.test(message))
    return { category: "network", message: sanitizeDbMessage(message) };
  return { category: "server-error", message: sanitizeDbMessage(message) };
}

function isMissingRelation(err: { message: string; code?: string }): boolean {
  return err.code === "42P01" || /does not exist|could not find/i.test(err.message);
}
function isMissingColumn(err: { message: string; code?: string }): boolean {
  return err.code === "42703" || /column .* (does not exist|not found)/i.test(err.message);
}

/**
 * Pure evaluator: probe -> human-honest status. Unit-tested; never touches
 * the network or env. This is the single source of truth for the /setup page
 * and /api/setup-status so they can never diverge.
 */
export function evaluateOwnerSetup(probe: OwnerSetupProbe): OwnerSetupStatus {
  const cannotCheck = "Cannot check yet - set SUPABASE_SERVICE_ROLE_KEY on the server (never in the browser).";

  const steps: OwnerSetupStep[] = [
    {
      done: probe.supabaseConfigured,
      label: "Supabase connection configured",
      detail: probe.supabaseConfigured
        ? "The Supabase project URL and anon key are set."
        : "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing on the deployment.",
    },
    {
      done: probe.serviceRoleConfigured,
      label: "Server database access configured",
      detail: probe.serviceRoleConfigured
        ? "The service-role key is present on the server (it never reaches the browser)."
        : cannotCheck,
    },
    {
      done: probe.migrationsPresent,
      label: "Database migrations applied (0001-0026)",
      detail:
        probe.migrationsPresent === null
          ? cannotCheck
          : probe.migrationsPresent
            ? "All required tables and columns are present, through migration 0026."
            : "Some migrations are missing - Set Up Sophira on /setup repairs them automatically from the app itself. If that action is unavailable, reconnecting the Vercel project to its Supabase project (the official Supabase integration) restores the automatic path; no tokens and no SQL editor are ever needed.",
    },
    {
      done: probe.invitationsPresent === null ? null : probe.invitationsPresent,
      label: "Invitation system ready",
      detail:
        probe.invitationsPresent === null
          ? cannotCheck
          : probe.invitationsPresent
            ? "Invitations work: after the owner exists, new people join by valid, unused email invitations only."
            : "The invitations table is missing - the deployment pipeline repairs this automatically (see above).",
    },
    {
      // Informational since migration 0025: the automatic first-owner
      // bootstrap needs NO configured email. A configured email simply
      // restricts the claim to that exact address (operator intent).
      done: probe.ownerEmailConfigured === null ? null : true,
      label: "Owner email restriction (optional)",
      detail:
        probe.ownerEmailConfigured === null
          ? cannotCheck
          : probe.ownerEmailConfigured
            ? "Optional restriction: only the configured email can create the owner account. Its value is never displayed here."
            : "Not configured - not needed. The first person to complete owner registration becomes the owner automatically, and owner creation then closes permanently.",
    },
    {
      done: probe.ownerAccount !== "unknown" && probe.ownerAccount !== "none" ? probe.ownerAccount === "active" : probe.ownerAccount === "none" ? false : null,
      label: "Owner account initialized",
      detail:
        probe.ownerAccount === "active"
          ? "The owner account exists and is active. It was created through the normal signup flow with a password only the owner knows."
          : probe.ownerAccount === "revoked"
            ? "An owner account exists but is marked revoked - restore it from the database (profiles.status) before continuing."
            : probe.ownerAccount === "none"
              ? "No owner account yet. Open /create-owner and register with your email and a password you choose. There is no predefined or default password."
              : cannotCheck,
    },
    {
      done: probe.aiConfigured,
      label: "AI provider configured",
      detail: probe.aiConfigured
        ? "A remote AI provider is configured (free tier, or paid use explicitly allowed). Academic AI features will run."
        : "No AI provider key is set - the app works, and AI features report honestly that they are not configured. The preferred no-billing path is Gemini free tier (GEMINI_API_KEY) or Offline/local AI; the optional paid OpenAI fallback is disabled by default (ALLOW_PAID_AI=false, MONTHLY_AI_BUDGET_USD=0).",
    },
  ];

  const checkable = probe.database === "checked";
  // Deployment readiness = migrations applied + an active owner. Since
  // migration 0025 the owner_email restriction is OPTIONAL (informational
  // only) — it never blocks owner creation.
  const ready = checkable
    ? probe.migrationsPresent === true &&
      (probe.ownerAccount === "active")
    : null;

  // ---- First-owner bootstrap availability (plain language) --------------
  // AI configuration is deliberately NOT consulted: owner creation must
  // never require any AI key or paid account.
  const ownerCreation =
    probe.ownerAccount === "active"
      ? { possible: false, reason: "An owner account already exists. Owner creation is permanently closed.", url: "" }
      : probe.ownerAccount === "revoked"
        ? { possible: false, reason: "The owner account exists but is revoked - restore it to continue.", url: "" }
        : probe.database === "checked" && probe.migrationsPresent === false
        ? { possible: null, reason: "The database is connected but not initialized yet - the Sophira tables are missing. An administrator needs to run the database setup once (see /setup).", url: "" }
        : probe.database === "checked" && probe.migrationsPresent === true && probe.ownerAccount === "none"
          ? { possible: true, reason: "No owner yet - the first registration creates the owner, then owner creation closes permanently.", url: "/create-owner" }
          : { possible: null, reason: "Cannot check yet - the database connection is not available to the server.", url: "" };

  const guidance: string[] = [];
  if (!probe.supabaseConfigured) {
    guidance.push("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY on the deployment (Vercel → Settings → Environment Variables), then redeploy.");
  }
  if (!probe.serviceRoleConfigured) {
    guidance.push("Set SUPABASE_SERVICE_ROLE_KEY on the server so the setup diagnostic can check the database. Never place it in browser-visible code.");
  }
  if (probe.database === "checked") {
    if (probe.migrationsPresent === false) {
      if (probe.migrationAutomationConfigured) {
        guidance.push("Open /setup and use Set Up Sophira - it prepares the database automatically, entirely from the app. No manual SQL, no tokens, no database editing.");
      } else {
        guidance.push("Open /setup and use Set Up Sophira - it prepares the database automatically, entirely from the app. If the action is unavailable, reconnect the Vercel project to its Supabase project (the official Supabase integration provisions the connection automatically); no tokens, no repository secrets, no manual SQL are ever needed.");
      }
    }
    if (probe.ownerAccount === "none") {
      guidance.push("Open /create-owner and register with your email and a password you choose. The first registration becomes the owner; owner creation then closes permanently. Sophira has no predefined or default owner password.");
    }
  }
  if (probe.ownerAccount === "active") {
    guidance.push("Owner account initialized. Sign in at /login; use 'Forgot your password?' (/reset-password) if you ever need to recover it.");
  }
  if (!probe.aiConfigured) {
    guidance.push("Optional but required for remote AI features: preferred no-billing path is Gemini free tier (set GEMINI_API_KEY, model gemini-2.5-flash) or Offline/local AI (no key needed). The paid OpenAI fallback (OPENAI_API_KEY + SOPHIRA_MODEL) is optional and DISABLED by default - enable only by setting ALLOW_PAID_AI=true or MONTHLY_AI_BUDGET_USD>0.");
  }

  const headline =
    ready === null
      ? "Setup status cannot be fully checked yet - see the steps below."
      : ready
        ? "Sophira is initialized: the owner account exists and is active."
        : "Sophira is not fully initialized - follow the steps below in order.";

  // ---- SAFE COARSE STATE (D): what a normal user may learn -----------
  const state: OwnerSetupState =
    probe.ownerAccount === "active"
      ? "OWNER_EXISTS"
      : probe.ownerAccount === "revoked"
        ? "SETUP_REQUIRED" // an owner exists but is revoked: needs an operator action
        : probe.database !== "checked"
          ? "TEMPORARILY_UNAVAILABLE"
          : probe.ownerAccount === "none" && probe.migrationsPresent === true
            ? "READY"
            : "SETUP_REQUIRED";

  // ---- single safe repair action (E/F) --------------------------------
  const repairable =
    state === "SETUP_REQUIRED" &&
    probe.ownerAccount !== "active" &&
    probe.ownerAccount !== "revoked" && // no owner known to exist
    probe.database === "checked" &&
    probe.chainStarted === true &&
    probe.migrationsPresent === false;
  // NEVER-INITIALIZED database (the chain has not started: app_config
  // itself is missing). This is exactly the drifted-production case: the
  // runtime repair intentionally refuses an empty database (applying the
  // FULL chain from a web request is the deployment pipeline's job), so
  // the guidance must name the one-time configuration that arms the
  // pipeline - never a dead-end "nothing to repair".
  const neverInitialized =
    state === "SETUP_REQUIRED" &&
    probe.database === "checked" &&
    probe.chainStarted === false;
  const repair: OwnerSetupRepair = repairable
    ? probe.migrationAutomationConfigured
      ? {
          available: true,
          action: "migrations",
          reason: "The first-owner database setup is missing pieces, but Sophira can repair them automatically - one click, no SQL.",
        }
      : {
          available: false,
          action: null,
          reason:
            "The first-owner database setup is missing pieces and can be repaired automatically from the app. The deployment has no server-side path to its database yet - reconnecting the Vercel project to its Supabase project (the official Supabase integration provisions the connection automatically) fixes this; no tokens, no repository configuration, no SQL editor.",
        }
    : neverInitialized
      ? probe.migrationAutomationConfigured
        ? {
            // First launch with the one-time connection configured: the
            // wizard initializes the COMPLETE chain in one click.
            available: true,
            action: "migrations",
            reason: "Your Sophira database needs to be initialized. Sophira can prepare it automatically - one click, no technical steps.",
          }
        : {
            available: false,
            action: null,
            reason:
              "This database has never been initialized (the Sophira schema is absent), and the deployment has no server-side path to its database yet. Reconnect the Vercel project to its Supabase project - the official Supabase integration provisions the database connection automatically, and first-launch setup then initializes the full schema from the app itself. No tokens, no repository configuration, no SQL editor. Until then, sign-up cannot work because the database has no tables.",
          }
      : { available: false, action: null, reason: "No automatic repair is needed or possible for the current state." };

  // ---- PRECISE capability diagnostic (requirement K/L): the exact
  // missing infrastructure capability, or null. Categorical only - never
  // a credential, never a connection string.
  const capability:
    | "supabase-credentials"
    | "service-role"
    | "initialization-channel"
    | "foreign-database"
    | null =
    !probe.supabaseConfigured
      ? "supabase-credentials"
      : !probe.serviceRoleConfigured
        ? "service-role"
        : probe.database === "checked" && probe.migrationsPresent === false
        ? probe.connectionTarget === "foreign"
          ? "foreign-database"
          : !probe.migrationAutomationConfigured
            ? "initialization-channel"
            : null
        : null;

  return { state, repair, staleAuthUsers: null, probe, capability, steps, ready, headline, guidance, ownerCreation };
}
