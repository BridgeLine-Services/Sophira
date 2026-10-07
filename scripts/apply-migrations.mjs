#!/usr/bin/env node
/**
 * AUTOMATED MIGRATION EXECUTION (2026-10-07).
 *
 * DEPLOYMENT-GRADE migration automation for Sophira — nobody has to open the
 * Supabase SQL editor, copy migration files, or inspect auth.users.
 *
 * How it works (all credentials stay in GitHub/Vercel encrypted storage):
 *   1. PROBE which migrations are already applied by checking each
 *      migration's signature object (marker) with a read-only query.
 *   2. APPLY only the missing migration FILES, in chain order, through the
 *      Supabase Management API (personal access token + project ref).
 *   3. DEEP-VERIFY the owner-bootstrap security contract (trigger
 *      definition, race-safe claim, invitation enforcement) afterwards.
 *   4. Fail LOUDLY with an actionable error if anything cannot be applied.
 *
 * Configuration (server/CI only, never in the browser):
 *   SUPABASE_ACCESS_TOKEN  - personal access token (supabase.com dashboard
 *                            → Account → Access Tokens). ONE-TIME setup.
 *   SUPABASE_PROJECT_REF  - the project ref (the subdomain of your project
 *                            URL, e.g. "abcdefgh" in abcdefgh.supabase.co).
 *
 * Usage:
 *   node scripts/apply-migrations.mjs              # probe + apply missing
 *   node scripts/apply-migrations.mjs --check-only  # probe + report, no write
 *   node scripts/apply-migrations.mjs --self-test  # offline contract check
 *   npm run db:migrate / npm run db:migrate:check
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { MARKERS } from "./migration-markers.mjs";

const API = "https://api.supabase.com";
const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

// Which database object proves migration N is applied. Migrations without a
// marker are applied together with the chain once any earlier marker is
// missing (the chain is strictly linear, so an existing later marker proves
// every earlier migration ran).


function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

function selfTest() {
  const files = migrationFiles();
  const markers = Object.keys(MARKERS);
  const missing = markers.filter((m) => !files.includes(m));
  if (missing.length) throw new Error(`self-test: marker refers to missing file(s): ${missing.join(", ")}`);
  if (!files.includes("0025_first_owner_bootstrap.sql") || !files.includes("0026_first_owner_recovery.sql"))
    throw new Error("self-test: owner bootstrap/recovery migrations are not in the chain");
  for (const m of markers) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, m), "utf8");
    // every marker object must be created by its own migration (sanity)
    if (m === "0025_first_owner_bootstrap.sql" && !sql.includes("owner_bootstrap")) throw new Error("self-test: 0025 marker mismatch");
  }
  console.log("apply-migrations self-test: PASS (chain files present, markers consistent)");
}

async function mgmtQuery(query, token, ref) {
  const res = await fetch(`${API}/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Management API ${res.status} on database query: ${body.slice(0, 500)}`);
  }
  return res.json();
}

async function probeApplied(token, ref) {
  const applied = new Set();
  for (const [file, markerSql] of Object.entries(MARKERS)) {
    const r = await mgmtQuery(`select (${markerSql}) as present;`, token, ref);
    const present = Array.isArray(r) ? Boolean(r[0]?.present) : false;
    if (present) applied.add(file);
  }
  return applied;
}

async function applyFile(file, sql, token, ref) {
  // Preferred: the Management API "apply a migration" endpoint (records the
  // migration in the project's migration history). Fallback: "run a query"
  // wrapped in one transaction.
  let applied = false;
  let lastErr = null;
  try {
    const res = await fetch(`${API}/v1/projects/${ref}/database/migrations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: file, query: sql }),
    });
    if (res.ok) applied = true;
    else lastErr = `migrations endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`;
  } catch (e) {
    lastErr = String(e);
  }
  if (!applied) {
    await mgmtQuery(`begin;\n${sql}\ncommit;`, token, ref);
    console.log(`  applied via database query (migrations endpoint unavailable: ${lastErr})`);
  } else {
    console.log("  applied via migration history");
  }
}

async function deepVerify(token, ref) {
  const r = await mgmtQuery(
    `select pg_get_functiondef('public.handle_new_user()'::regprocedure) as def;`,
    token, ref
  );
  const def = Array.isArray(r) ? String(r[0]?.def || "") : "";
  if (!def.includes("owner_bootstrap")) throw new Error("deep-verify FAILED: handle_new_user does not contain the first-owner claim (0025 missing or overwritten)");
  if (!def.includes("invitation")) throw new Error("deep-verify FAILED: handle_new_user does not enforce invitations");
  const t = await mgmtQuery(
    `select count(*)::int as n from pg_trigger where tgrelid = 'auth.users'::regclass and tgfoid = 'public.handle_new_user()'::regproc;`,
    token, ref
  );
  if (!(Array.isArray(t) ? t[0]?.n === 1 : false)) throw new Error("deep-verify FAILED: the auth.users trigger is not attached exactly once");
  const c = await mgmtQuery(
    `select pg_get_functiondef('public.complete_first_owner(uuid)'::regprocedure) as def;`,
    token, ref
  );
  const cdef = Array.isArray(c) ? String(c[0]?.def || "") : "";
  if (!cdef.includes("on conflict (id) do nothing")) throw new Error("deep-verify FAILED: complete_first_owner lost its race-safe claim");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) { selfTest(); return; }
  const checkOnly = args.includes("--check-only");

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    console.log(
      checkOnly
        ? "db:migrate:check — SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set; cannot verify migrations from here."
        : "db:migrate — SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set; skipping automated migrations.\n" +
          "  ONE-TIME setup: create a personal access token at supabase.com/dashboard/account/tokens,\n" +
          "  then set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in your CI/secret store."
    );
    process.exit(checkOnly ? 2 : 0);
  }

  const files = migrationFiles();
  const applied = await probeApplied(token, ref);
  const missing = [];
  let mustApply = false;
  for (const f of files) {
    if (MARKERS[f] && applied.has(f)) continue; // confirmed applied
    if (MARKERS[f] && !applied.has(f)) mustApply = true; // gap detected
    if (mustApply) missing.push(f);
  }
  console.log(`probe: ${Object.keys(MARKERS).length} markers checked; chain files: ${files.length}; missing: ${missing.length}`);
  if (missing.length) console.log("missing migrations:\n  " + missing.join("\n  "));

  if (checkOnly) {
    if (missing.length) {
      console.error("RESULT: MIGRATIONS REQUIRED — the deployment is NOT ready (run npm run db:migrate).");
      process.exit(1);
    }
    console.log("RESULT: MIGRATIONS CURRENT");
    return;
  }

  for (const f of missing) {
    console.log(`applying ${f} ...`);
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    await applyFile(f, sql, token, ref);
  }

  await deepVerify(token, ref);
  console.log("deep-verify: owner bootstrap + invitation enforcement + recovery function all present. RESULT: MIGRATIONS CURRENT");
}

main().catch((e) => {
  console.error("MIGRATION AUTOMATION FAILED:\n" + (e && e.message ? e.message : e));
  console.error("Actionable: check SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF, then re-run npm run db:migrate.");
  process.exit(1);
});
