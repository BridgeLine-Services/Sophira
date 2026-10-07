/**
 * FIRST-OWNER BOOTSTRAP (migration 0025) — product-contract tests.
 * The owner must create their account from the app with NO manual
 * database configuration, while the database enforces: exactly one
 * owner, ever; race-safe; permanently closed afterwards; invitation-only
 * for everyone else; no client access to the claim; no self-promotion.
 */
import { readFileSync } from "fs";

type Assert = (c: boolean, n: string) => void;
type Section = (t: string) => void;

export function runOwnerBootstrapTests(assert: Assert, section: Section): void {
  section("First-owner bootstrap (0025): in-app owner creation, single-owner, race-safe");

  const migrations = readFileSync("supabase/migrations/0025_first_owner_bootstrap.sql", "utf8");
  const createOwner = readFileSync("src/app/create-owner/page.tsx", "utf8");
  const setupPage = readFileSync("src/app/setup/page.tsx", "utf8");
  const route = readFileSync("src/app/api/setup-status/route.ts", "utf8");
  const setupLib = readFileSync("src/lib/owner-setup.ts", "utf8");

  // ---- single-owner enforcement at the DATABASE level ----
  assert(migrations.includes("primary key check (id = 1)"),
    "bootstrap: owner_bootstrap is a SINGLE-ROW table (PK check id=1) - the database enforces exactly one owner");
  assert(migrations.includes("on conflict (id) do nothing"),
    "bootstrap: the claim is INSERT ... ON CONFLICT DO NOTHING - atomic, so two simultaneous first registrations cannot both become owner");
  assert(migrations.includes("if not exists (select 1 from public.profiles where role = 'owner')"),
    "bootstrap: the claim window only opens while no owner exists");
  assert(migrations.includes("security definer"),
    "bootstrap: handle_new_user remains security definer - ownership is decided server-side, never by browser data");
  assert(migrations.includes("for update skip locked") && migrations.includes("Sign-up requires a valid, unused invitation"),
    "bootstrap: after the claim, every other signup still requires a valid invitation (race-safe claim, unchanged path)");

  // ---- the claim is invisible and immutable to every client ----
  assert(migrations.includes("revoke all on public.owner_bootstrap from anon, authenticated"),
    "bootstrap: no client can read or write the owner claim");
  assert(migrations.includes("alter table public.owner_bootstrap enable row level security"),
    "bootstrap: owner_bootstrap has RLS enabled with no client policies");

  // ---- legacy operator intent preserved ----
  assert(migrations.includes("lower(v_owner_email) = lower(new.email)"),
    "bootstrap: a CONFIGURED owner_email still restricts the claim to that exact email");
  assert(migrations.includes("insert into public.owner_bootstrap (id, claimed_by)\nselect 1, p.id"),
    "bootstrap: existing 0008-flow deployments get their window closed by the seed insert (no second owner)");

  // ---- the owner UI is honest and non-technical ----
  assert(createOwner.includes("signUp") && createOwner.includes("createClient"),
    "bootstrap: /create-owner uses the normal signup flow - the owner picks their own password");
  assert(createOwner.includes("An owner account already exists, so a second one cannot be created"),
    "bootstrap: /create-owner honestly refuses a second owner instead of offering one");
  assert(!/SUPABASE_SERVICE_ROLE_KEY|GEMINI_API_KEY|OPENAI_API_KEY|app_config/.test(createOwner),
    "bootstrap: /create-owner never shows technical variable names or database requirements");
  assert(createOwner.includes("no predefined or default") === false && createOwner.includes("you pick your own password"),
    "bootstrap: /create-owner explains the owner chooses their own password");
  assert(createOwner.includes('router.push("/owner")'),
    "bootstrap: a successful owner registration goes straight to the owner dashboard");
  assert(createOwner.includes("never fake success") || createOwner.includes("never claiming success"),
    "bootstrap: a lost race surfaces the honest invitation message, never a fake success");

  // ---- /setup separates owner creation from diagnostics ----
  assert(setupPage.includes("Create Owner Account") && setupPage.includes("/create-owner"),
    "setup: the owner-creation CTA is the prominent action");
  const diag = readFileSync("src/app/setup/SetupDiagnostics.tsx", "utf8");
  assert(setupPage.includes("Advanced diagnostics") && diag.includes("useState"),
    "setup: technical diagnostics are a SEPARATE optional section, not a blocker for owner creation");
  assert(!setupPage.includes('"use client"') || setupPage.startsWith('"use client"') === false,
    "setup: /setup is a server component - the database probe (server-only env names) never reaches the browser bundle");
  assert(!/SUPABASE_SERVICE_ROLE_KEY|GEMINI_API_KEY|OPENAI_API_KEY/.test(diag),
    "setup: the diagnostics client component never references secret env names");
  assert(setupPage.includes("no paid AI is ever used unless you explicitly turn it on"),
    "setup: the AI status is explained in plain language (local AI needs no key, paid AI is off)");
  assert(route.includes("ownerCreation"),
    "setup: /api/setup-status exposes ownerCreation so the UI and API can never diverge");

  // ---- owner creation never depends on AI ----
  assert(setupLib.includes("AI configuration is deliberately NOT consulted"),
    "setup: the ownerCreation evaluator deliberately ignores AI configuration");
}
