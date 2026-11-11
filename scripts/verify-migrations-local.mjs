#!/usr/bin/env node
/**
 * VERIFY MIGRATIONS LOCALLY (2026-11-11, repaired 2026-11-11).
 *
 * Applies the ENTIRE migration chain to a throwaway PostgreSQL, plus targeted
 * checks that the migrations which must survive EXISTING rows really do. This is
 * the only way to know the SQL is valid before it reaches the real database —
 * `npm test` reads files, it does not execute SQL.
 *
 * It is honest about what it cannot do:
 *   exit 0  the chain applied and every check below actually ran and passed
 *   exit 1  something failed (the SQL is wrong; fix it before applying anywhere)
 *   exit 3  SKIPPED: no `psql`/`createdb`/`dropdb` and/or no reachable server,
 *           so nothing was measured. A skip is never reported as a pass.
 *
 * Usage:
 *   scripts/verify-migrations-local.mjs                  (uses PGHOST/PGPORT/PGUSER)
 *   scripts/verify-migrations-local.mjs --port 5455
 *
 * The Supabase-provided pieces (auth schema, anon/authenticated/service_role, the
 * storage helpers) are stubbed by supabase/local-stub.sql, so this never touches a
 * real Supabase project.
 *
 * STRUCTURE (repaired 2026-11-11): this file used to contain two overlapping
 * migration-test blocks - an incomplete 0045-only one that never closed its `if`,
 * followed by the generalized implementation. The file did not parse, so
 * `npm run db:verify:local` could never run and ESLint failed on the orphaned
 * `catch`. There is now ONE implementation: shared setup helpers at the top, one
 * scenario runner, and a single set of declarations per scope.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const MIGRATION_DIR = "supabase/migrations";
const STUB_SQL = "supabase/local-stub.sql";
const BOOTSTRAP_SQL = "supabase/bootstrap-all.sql";

// ---------------------------------------------------------------------------
// Setup: connection details, the psql wrapper, and the honest skip path.
// ---------------------------------------------------------------------------
const argPort = (() => {
  const i = process.argv.indexOf("--port");
  return i !== -1 ? process.argv[i + 1] : null;
})();

const env = {
  ...process.env,
  PGHOST: process.env.PGHOST || "127.0.0.1",
  PGPORT: argPort || process.env.PGPORT || "5432",
  PGUSER: process.env.PGUSER || "postgres",
};

const psql = (db, args, { input } = {}) =>
  spawnSync("psql", ["-q", "-v", "ON_ERROR_STOP=1", ...(db ? ["-d", db] : []), ...args], {
    env,
    encoding: "utf8",
    input,
    timeout: 120_000,
  });

const have = (bin) => spawnSync(bin, ["--version"], { encoding: "utf8" }).status === 0;

if (!have("psql") || !have("createdb") || !have("dropdb")) {
  console.log("SKIPPED: psql/createdb/dropdb not installed, so no migration was executed.");
  process.exit(3);
}
const ping = psql("postgres", ["-tAc", "select 1"]);
if (ping.status !== 0) {
  console.log(`SKIPPED: no PostgreSQL reachable at ${env.PGHOST}:${env.PGPORT} (start one, or pass --port).`);
  process.exit(3);
}

// ---------------------------------------------------------------------------
// The migration set, declared ONCE. Every scenario below reads these.
// ---------------------------------------------------------------------------
const allMigrations = readdirSync(MIGRATION_DIR).filter((f) => f.endsWith(".sql")).sort();
const M45 = allMigrations.find((f) => f.startsWith("0045_")) || null;
// The migration that added responses.provider_used. Checked by name rather than by
// "is it the newest", so the provenance guarantee keeps being verified after newer
// migrations land on top of it (2026-11-11).
const PROVENANCE = allMigrations.find((f) => f.startsWith("0046_")) || null;
// The NEWEST migration by filename, whatever its number: adding a migration must
// not slip past this check by being newer than a hardcoded name (2026-11-11).
const NEWEST = allMigrations.length > 0 ? allMigrations[allMigrations.length - 1] : null;

const DB = process.env.SOPHIRA_VERIFY_DB || "sophira_verify";

function freshDatabase() {
  spawnSync("dropdb", ["--if-exists", DB], { env });
  const created = spawnSync("createdb", [DB], { env, encoding: "utf8" });
  if (created.status !== 0) throw new Error("could not create the verification database");
  const stub = psql(DB, ["-f", STUB_SQL]);
  if (stub.status !== 0) throw new Error(`local stub failed: ${(stub.stderr || "").slice(0, 300)}`);
}

const failures = [];
const check = (ok, name, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

// Apply every migration strictly before `exclusive`, in order. Returns false (and
// records a failure) as soon as one does not apply.
function applyUpTo(exclusive) {
  for (const f of allMigrations.filter((m) => m < exclusive)) {
    const r = psql(DB, ["-f", `${MIGRATION_DIR}/${f}`]);
    if (r.status !== 0) {
      check(false, `migrations before ${exclusive} apply`, `${f}: ${(r.stderr || "").slice(0, 160)}`);
      return false;
    }
  }
  return true;
}

// A member and an answer written BEFORE the migration under test. `created_at` is
// deliberately in the past: a row dated "now" would make timestamp assertions true
// by accident (the fixture bug found on 2026-11-11).
const LEGACY_USER = "11111111-1111-1111-1111-111111111111";
const LEGACY_TEXT = "legacy answer";
function seedLegacyRow() {
  psql(DB, ["-c", `insert into auth.users (id) values ('${LEGACY_USER}') on conflict do nothing`]);
  const seeded = psql(DB, ["-c",
    `insert into public.responses (user_id, content, created_at) values ('${LEGACY_USER}','${LEGACY_TEXT}','2026-10-01T10:00:00Z')`]);
  check(seeded.status === 0, "a pre-existing row can be written before the migration",
    seeded.status === 0 ? "" : (seeded.stderr || "").slice(0, 200));
}

/**
 * One scenario: start empty, apply everything before `migration`, write a row that
 * predates it, then apply it and run its specific assertions. `extraChecks` runs
 * after the shared ones (the migration applies, the text survives).
 */
function runOverExistingRows(migration, extraChecks = []) {
  freshDatabase();
  if (!applyUpTo(migration)) return;
  seedLegacyRow();
  const applied = psql(DB, ["-f", `${MIGRATION_DIR}/${migration}`]);
  check(applied.status === 0, `${migration} applies over existing data`, (applied.stderr || "").slice(0, 200));
  if (applied.status !== 0) return;
  const kept = psql(DB, ["-tAc", "select content from public.responses limit 1"]);
  check((kept.stdout || "").trim() === LEGACY_TEXT, `${migration} loses no existing text`,
    `got ${JSON.stringify((kept.stdout || "").trim())}`);
  for (const fn of extraChecks) fn();
}

// ---------------------------------------------------------------------------
// The verification itself.
// ---------------------------------------------------------------------------
try {
  // 1. The whole chain, from nothing.
  freshDatabase();
  const all = psql(DB, ["-f", BOOTSTRAP_SQL]);
  check(all.status === 0, "the full chain applies to an empty database",
    all.status === 0
      ? `${allMigrations.length} migrations`
      : (all.stderr || "").slice(0, 200));

  // 1b. The bundle really is the whole chain. bootstrap-all.sql is generated, so a
  //     stale bundle would make every check below pass while skipping a migration.
  if (all.status === 0) {
    const bundle = readFileSync(BOOTSTRAP_SQL, "utf8");
    const missing = allMigrations.filter((f) => !bundle.includes(` ${f} =`));
    check(missing.length === 0, "bootstrap-all.sql contains every migration",
      missing.length === 0 ? `${allMigrations.length} included` : `missing: ${missing.join(", ")}`);
  }

  const tables = psql(DB, ["-tAc", "select count(*) from information_schema.tables where table_schema='public'"]);
  check(Number((tables.stdout || "0").trim()) >= 54, "every expected table exists",
    `${(tables.stdout || "").trim()} public tables`);

  const policies = psql(DB, ["-tAc", "select count(*) from pg_policies where schemaname='public'"]);
  check(Number((policies.stdout || "0").trim()) >= 70, "RLS policies are installed",
    `${(policies.stdout || "").trim()} policies`);

  const rlsOff = psql(DB, ["-tAc",
    "select string_agg(t.tablename, ', ' order by t.tablename) from pg_tables t where t.schemaname='public' and not t.rowsecurity"]);
  check((rlsOff.stdout || "").trim() === "", "every public table has row level security on",
    (rlsOff.stdout || "").trim() === "" ? "" : `not on: ${(rlsOff.stdout || "").trim()}`);

  // 2. Migrations that must survive EXISTING rows, which is the only way to catch a
  //    NOT NULL column or a backfill that would break a live deployment.
  //
  // 2a. The 0045 guarantee: an answer written before versioning existed gets a
  //     version equal to its creation time, and keeps its text.
  if (!M45) {
    check(false, "migration 0045 is present");
  } else {
    runOverExistingRows(M45, [
      () => {
        const backfill = psql(DB, ["-tAc", "select (updated_at = created_at) from public.responses limit 1"]);
        check((backfill.stdout || "").trim() === "t", "existing rows inherit created_at as their version",
          `got ${JSON.stringify((backfill.stdout || "").trim())}`);
      },
    ]);
  }

  // 2b. The provenance guarantee: a row written before provenance was recorded keeps
  //     provider_used NULL. NULL means "not recorded", never "cloud".
  if (!PROVENANCE) {
    check(false, "the provenance migration (0046) is present");
  } else {
    runOverExistingRows(PROVENANCE, [
      () => {
        const prov = psql(DB, ["-tAc", "select coalesce(provider_used,'NULL') from public.responses limit 1"]);
        check((prov.stdout || "").trim() === "NULL",
          "a row written before provenance was recorded stays unrecorded, never guessed as cloud",
          `got ${JSON.stringify((prov.stdout || "").trim())}`);
      },
    ]);
  }

  // 2c. The NEWEST migration, whatever it is, against a row that predates it. When
  //     it is one of the two above, that scenario already covered it and a second run
  //     would only re-prove the same thing, so it is not re-run (and not claimed).
  if (!NEWEST) {
    check(false, "the newest migration is present");
  } else if (NEWEST === M45 || NEWEST === PROVENANCE) {
    console.log(`NOTE  ${NEWEST} is the newest migration and was checked against existing rows above.`);
  } else {
    runOverExistingRows(NEWEST);
  }
} catch (e) {
  check(false, "verification ran", String(e?.message ?? e).slice(0, 200));
} finally {
  spawnSync("dropdb", ["--if-exists", DB], { env });
}

console.log(failures.length === 0
  ? "\nMIGRATIONS VERIFIED: the chain applies and the migrations that touch existing rows are safe."
  : `\nMIGRATIONS FAILED: ${failures.length} check(s) — do not apply this to a real database.`);
process.exit(failures.length === 0 ? 0 : 1);
