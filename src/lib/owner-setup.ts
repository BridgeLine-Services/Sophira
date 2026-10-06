import { createClient as createSupabaseClient } from "@supabase/supabase-js";

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
}

const configured = (v: string | undefined): boolean =>
  typeof v === "string" && v.trim().length > 0;

export function serviceRoleConfigured(): boolean {
  return (
    configured(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    configured(process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
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
      configured(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      configured(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    serviceRoleConfigured: serviceRoleConfigured(),
    // Free-first policy: the Gemini free tier counts as configured; a paid
    // OpenAI key counts ONLY when ALLOW_PAID_AI=true or budget > 0
    // (zero-billing defaults leave it inert — never silently spend money).
    aiConfigured:
      configured(process.env.GEMINI_API_KEY) ||
      (configured(process.env.OPENAI_API_KEY) &&
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

    // ---- migration 0020: student_memories (newest migration) ----
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
      label: "Database migrations applied (0001-0020)",
      detail:
        probe.migrationsPresent === null
          ? cannotCheck
          : probe.migrationsPresent
            ? "All required tables and columns are present, through migration 0020."
            : "Some migrations are missing - run the migration chain in the Supabase SQL editor (see docs/RELEASE_PROCESS.md).",
    },
    {
      done: probe.ownerEmailConfigured,
      label: "Owner bootstrap email configured (app_config.owner_email)",
      detail:
        probe.ownerEmailConfigured === null
          ? cannotCheck
          : probe.ownerEmailConfigured
            ? "The fail-closed bootstrap email is set in the database. Its value is never displayed here."
            : "Not configured. Run in the Supabase SQL editor: insert into public.app_config (key, value) values ('owner_email', to_jsonb('your@email.com')); - BEFORE the first signup.",
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
              ? "No owner account yet. After owner_email is configured, sign up with that exact email at /signup and choose your own password. There is no predefined or default password."
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
  const ready = checkable
    ? probe.migrationsPresent === true &&
      probe.ownerEmailConfigured === true &&
      (probe.ownerAccount === "active")
    : null;

  const guidance: string[] = [];
  if (!probe.supabaseConfigured) {
    guidance.push("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY on the deployment (Vercel → Settings → Environment Variables), then redeploy.");
  }
  if (!probe.serviceRoleConfigured) {
    guidance.push("Set SUPABASE_SERVICE_ROLE_KEY on the server so the setup diagnostic can check the database. Never place it in browser-visible code.");
  }
  if (probe.database === "checked") {
    if (probe.migrationsPresent === false) {
      guidance.push("Apply the Supabase migrations 0001-0020 (Supabase SQL editor) - see docs/RELEASE_PROCESS.md.");
    }
    if (probe.ownerEmailConfigured === false) {
      guidance.push("Run: insert into public.app_config (key, value) values ('owner_email', to_jsonb('your@email.com')); - this is required before the first signup and is fail-closed by design.");
    }
    if (probe.ownerAccount === "none" && probe.ownerEmailConfigured === true) {
      guidance.push("Open /signup with that exact email and create the owner account, choosing your own password during the normal signup flow. Sophira has no predefined or default owner password.");
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

  return { probe, steps, ready, headline, guidance };
}
