/**
 * LOGIN FIRST-OWNER PATH (2026-10-06): the unauthenticated entry screen
 * must offer "Create Owner Account" ONLY while the SERVER says no owner
 * exists. The same secure status (/api/setup-status ownerCreation) drives
 * /create-owner - never a browser-only flag. Migration 0025 behavior is
 * unchanged and re-verified here.
 */
import { readFileSync } from "fs";

export function runLoginOwnerCtaTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("Login first-owner path: server-driven CTA, no browser-only flag");

  const login = readFileSync("src/app/login/page.tsx", "utf8");
  const createOwner = readFileSync("src/app/create-owner/page.tsx", "utf8");
  const route = readFileSync("src/app/api/setup-status/route.ts", "utf8");
  const migration = readFileSync("supabase/migrations/0025_first_owner_bootstrap.sql", "utf8");

  // The CTA exists and links to /create-owner
  assert(login.includes("Create Owner Account"), "login: the entry screen offers Create Owner Account");
  assert(login.includes('href="/create-owner"'), "login: the CTA links to /create-owner");

  // Visibility is decided by the SERVER status, never a browser-only flag
  assert(login.includes("/api/setup-status") && login.includes("ownerCreation"),
    "login: the CTA visibility comes from the server-side ownerCreation status (same source as /create-owner)");
  assert(login.includes(".catch(() => setOwnerCreationOpen(false))"),
    "login: if the status cannot be checked the CTA stays HIDDEN (fail closed)");
  assert(route.includes("ownerCreation"), "login: /api/setup-status still exposes ownerCreation (single source of truth)");
  assert(createOwner.includes("An owner account already exists, so a second one cannot be created"),
    "login: once an owner exists, /create-owner itself refuses a second owner - the normal sign-in/invitation flow remains");

  // No secrets or authorization internals to the browser
  assert(!/SUPABASE_SERVICE_ROLE_KEY|GEMINI_API_KEY|OPENAI_API_KEY/.test(login),
    "login: the page never references secret env names");
  assert(!/owner_bootstrap|app_config|owner_email/.test(login),
    "login: the page never references the owner claim table or bootstrap config");

  // Migration 0025 security behavior unchanged (re-verified)
  assert(migration.includes("primary key check (id = 1)"), "login: exactly one owner ever (single-row claim unchanged)");
  assert(migration.includes("on conflict (id) do nothing"), "login: the database decides who wins - no race creates two owners");
  assert(migration.includes("Sign-up requires a valid, unused invitation"), "login: later users require valid invitations");
  assert(migration.includes("revoke all on public.owner_bootstrap from anon, authenticated"), "login: the claim stays invisible to browsers; RLS intact");

  // User-facing docs must NOT tell anyone to manually insert owner_email
  const readme = readFileSync("README.md", "utf8");
  const ownerAccess = readFileSync("docs/OWNER_ACCESS.md", "utf8");
  const releaseProcess = readFileSync("docs/RELEASE_PROCESS.md", "utf8");
  for (const [name, doc] of [["README", readme], ["OWNER_ACCESS", ownerAccess], ["RELEASE_PROCESS", releaseProcess]] as const) {
    assert(!doc.includes("insert into public.app_config"), `docs: ${name} no longer instructs a manual owner_email insert`);
    assert(doc.includes("/create-owner"), `docs: ${name} documents the in-app Create Owner Account flow`);
  }
  assert(readme.includes("Create Owner Account"), "docs: README names the Create Owner Account entry point");
  assert(/atomically/i.test(ownerAccess), "docs: OWNER_ACCESS explains the atomic single-owner claim");
}
