import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { present } from "./env";

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
}

export interface OwnerSetupStep {
  done: boolean | null; // true / false / null (cannot check)
  label: string; // what the operator sees
  detail: string; // honest explanation
}

export interface OwnerSetupStatus {
  probe: OwnerSetupProbe;
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
  return present("NEXT_PUBLIC_SUPABASE_URL") && present("SUPABASE_SERVICE_ROLE_KEY");
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
    supabaseConfigured:
      present("NEXT_PUBLIC_SUPABASE_URL") &&
      present("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
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
  };
  if (!probe.serviceRoleConfigured) return probe;

  try {
    const admin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ---- migration 0008: app_config exists (and owner_email configured?) ----
    const { error: configErr } = await admin
      .from("app_config")
      .select("key")
      .eq("key", "owner_email")
      .limit(1);
    if (configErr && isMissingRelation(configErr)) return { ...probe, database: "checked", migrationsPresent: false };
    if (configErr) return { ...probe, database: "unreachable" };
    probe.database = "checked";
    probe.migrationsPresent = true;
    probe.ownerEmailConfigured = true; // row exists for key='owner_email'

    // ---- migration 0019: profiles.access_revoked_at column ----
    const { error: colErr } = await admin
      .from("profiles")
      .select("access_revoked_at")
      .limit(1);
    if (colErr && (isMissingRelation(colErr) || isMissingColumn(colErr))) {
      probe.migrationsPresent = false;
      return probe;
    }
    if (colErr) {
      probe.database = "unreachable";
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
      probe.migrationsPresent = false;
      return probe;
    }
    if (memErr) {
      probe.migrationsPresent = null;
      return probe;
    }

    // ---- migration 0025: owner_bootstrap (first-owner claim table) ----
    const { error: bootErr } = await admin
      .from("owner_bootstrap")
      .select("id")
      .limit(1);
    if (bootErr && isMissingRelation(bootErr)) {
      probe.migrationsPresent = false;
      return probe;
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
      label: "Database migrations applied (0001-0025)",
      detail:
        probe.migrationsPresent === null
          ? cannotCheck
          : probe.migrationsPresent
            ? "All required tables and columns are present, through migration 0025."
            : "Some migrations are missing - run the migration chain in the Supabase SQL editor (see docs/RELEASE_PROCESS.md).",
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
      guidance.push("Apply the Sophira database setup: for a FRESH database, run the single combined file supabase/bootstrap-all.sql (migrations 0001-0025, in order). For a database set up before October 2026, apply the missing migrations in the Supabase SQL editor - at minimum 0025_first_owner_bootstrap.sql (the first-owner bootstrap), or owner creation will be rejected as invitation-only.");
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

  return { probe, steps, ready, headline, guidance, ownerCreation };
}
