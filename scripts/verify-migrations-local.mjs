#!/usr/bin/env node
/**
 * VERIFY MIGRATIONS LOCALLY (2026-11-11).
 *
 * Applies the ENTIRE migration chain to a throwaway PostgreSQL, plus a targeted
 * check that the newest migration does the right thing to EXISTING rows. This is
 * the only way to know the SQL is valid before it reaches the real database —
 * `npm test` reads files, it does not execute SQL.
 *
 * It is honest about what it cannot do:
 *   exit 0  the chain applied and the checks passed
 *   exit 1  something failed (the SQL is wrong; fix it before applying anywhere)
 *   exit 3  SKIPPED: no `psql` and/or no reachable server, so nothing was measured
 *
 * Usage:
 *   scripts/verify-migrations-local.mjs                  (uses PGHOST/PGPORT/PGUSER)
 *   scripts/verify-migrations-local.mjs --port 5455
 *
 * The Supabase-provided pieces (auth schema, anon/authenticated/service_role, the
 * storage helpers) are stubbed by supabase/local-stub.sql, so this never touches a
 * real Supabase project.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

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

const DB = process.env.SOPHIRA_VERIFY_DB || "sophira_verify";
// The NEWEST migration by filename, whatever its number: adding a migration must
// not slip past this check by being newer than a hardcoded name (2026-11-11).
const NEWEST = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort().pop();

function freshDatabase() {
  spawnSync("dropdb", ["--if-exists", DB], { env });
  const created = spawnSync("createdb", [DB], { env, encoding: "utf8" });
  if (created.status !== 0) throw new Error("could not create the verification database");
  const stub = psql(DB, ["-f", "supabase/local-stub.sql"]);
  if (stub.status !== 0) throw new Error(`local stub failed: ${(stub.stderr || "").slice(0, 300)}`);
}

const failures = [];
const check = (ok, name, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

try {
  // 1. The whole chain, from nothing.
  freshDatabase();
  const all = psql(DB, ["-f", "supabase/bootstrap-all.sql"]);
  check(all.status === 0, "the full chain applies to an empty database",
    all.status === 0 ? `${readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).length} migrations` : (all.stderr || "").slice(0, 200));

  const tables = psql(DB, ["-tAc", "select count(*) from information_schema.tables where table_schema='public'"]);
  check(Number((tables.stdout || "0").trim()) >= 54, "every expected table exists",
    `${(tables.stdout || "").trim()} public tables`);

  const policies = psql(DB, ["-tAc", "select count(*) from pg_policies where schemaname='public'"]);
  check(Number((policies.stdout || "0").trim()) >= 70, "RLS policies are installed",
    `${(policies.stdout || "").trim()} policies`);

  const rlsOff = psql(DB, ["-tAc",
    "select count(*) from pg_tables t where t.schemaname='public' and not t.rowsecurity"]);
  check(Number((rlsOff.stdout || "0").trim()) === 0, "every public table has row level security on",
    `${(rlsOff.stdout || "").trim()} without RLS`);

  // 2. Migrations that must survive EXISTING rows, which is the only way to catch a
  //    NOT NULL column or a backfill that would break a live deployment.
  //
  //    Each scenario inserts its fixture BEFORE the migration it tests. The generic
  //    scenario used to insert after 0045 had already applied, so its own fixture
  //    arrived with today's timestamp and the 0045 assertion failed - the fixture was
  //    wrong, not the migration (found 2026-11-11).
  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  const seedRow = () => {
    psql(DB, ["-c", "insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111')"]);
    const seeded = psql(DB, ["-c",
      "insert into public.responses (user_id, content, created_at) values ('11111111-1111-1111-1111-111111111111','legacy answer','2026-10-01T10:00:00Z')"]);
    check(seeded.status === 0, "a pre-existing row can be written before the migration");
  };
  const applyUpTo = (exclusive) => {
    for (const f of migrations.filter((f) => f < exclusive)) {
      const r = psql(DB, ["-f", `supabase/migrations/${f}`]);
      if (r.status !== 0) {
        check(false, `migrations before ${exclusive} apply`, `${f}: ${(r.stderr || "").slice(0, 160)}`);
        return false;
      }
    }
    return true;
  };

  // 2a. The 0045 guarantee: an answer written before versioning existed gets a
  //     version equal to its creation time, and keeps its text.
  const M45 = migrations.find((f) => f.startsWith("0045_"));
  if (M45) {
    freshDatabase();
    if (applyUpTo(M45)) {
      seedRow();
      const applied = psql(DB, ["-f", `supabase/migrations/${M45}`]);
      check(applied.status === 0, `${M45} applies over existing data`, (applied.stderr || "").slice(0, 200));
      const backfill = psql(DB, ["-tAc", "select (updated_at = created_at) from public.responses limit 1"]);
      check((backfill.stdout || "").trim() === "t", "existing rows inherit created_at as their version");
      const kept = psql(DB, ["-tAc", "select content from public.responses limit 1"]);
      check((kept.stdout || "").trim() === "legacy answer", "the migration loses no existing text");
    }
  }

  // 2b. The NEWEST migration, whatever it is, against a row that predates it.
  if (!NEWEST) {
    check(false, "the newest migration is present");
  } else if (NEWEST !== M45) {
    freshDatabase();
    if (applyUpTo(NEWEST)) {
      seedRow();
      const applied = psql(DB, ["-f", `supabase/migrations/${NEWEST}`]);
      check(applied.status === 0, `${NEWEST} applies over existing data`, (applied.stderr || "").slice(0, 200));
      const kept = psql(DB, ["-tAc", "select content from public.responses limit 1"]);
      check((kept.stdout || "").trim() === "legacy answer", "the newest migration loses no existing text");
      if (NEWEST.startsWith("0046_")) {
        const prov = psql(DB, ["-tAc", "select coalesce(provider_used,'NULL') from public.responses limit 1"]);
        check((prov.stdout || "").trim() === "NULL",
          "a row written before provenance was recorded stays unrecorded, never guessed as cloud");
      }
    }
  }
} catch (e) {
  check(false, "verification ran", String(e?.message ?? e).slice(0, 200));
} finally {
  spawnSync("dropdb", ["--if-exists", DB], { env });
}

console.log(failures.length === 0
  ? "\nMIGRATIONS VERIFIED: the chain applies and the newest migration is safe on existing rows."
  : `\nMIGRATIONS FAILED: ${failures.length} check(s) — do not apply this to a real database.`);
process.exit(failures.length === 0 ? 0 : 1);
