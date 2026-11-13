/**
 * MIGRATION RELEASE-GATE ACCURACY (2026-11-13).
 *
 * The defect this pins: the release gate's `db-migrations` check asked production for four
 * hand-written objects belonging to migrations 0035-0038 while the chain had reached 0056.
 * A database missing 0039-0056 could therefore answer PASS, and the list had to be edited by
 * hand for every new migration, which is how it fell nine migrations behind.
 *
 * The fix (scripts/migration-probes.mjs) derives the probe set from scripts/migration-markers.mjs
 * - the single source of truth CI and the setup wizard already share - probes the newest window,
 * and treats an unprovable newest migration as BLOCKED, never PASS.
 *
 * These tests run the module's own behavioural self-test (current database, old database, missing
 * newest, partial tail, no credentials, no provable chain end) and pin the wiring, the coverage of
 * the marker table, and the honesty of the documentation.
 */
import { readFileSync, readdirSync } from "fs";
import { spawnSync } from "child_process";

type Assert = (cond: boolean, msg: string) => void;

export function runMigrationReleaseGateTests(assert: Assert, section: (name: string) => void) {
  section("migration release gate: the newest migrations are actually verified");

  const probeSrc = readFileSync("scripts/migration-probes.mjs", "utf8");
  const gateSrc = readFileSync("scripts/release-gate.mjs", "utf8");
  const markersSrc = readFileSync("scripts/migration-markers.mjs", "utf8");
  const doc = readFileSync("docs/RELEASE_GATE.md", "utf8");

  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  const newest = migrations[migrations.length - 1];

  // --- coverage: every migration in the chain carries a marker -----------------
  assert(migrations.length > 0, "chain: migration files exist");
  const unmarked = migrations.filter((f) => !markersSrc.includes(`"${f}"`));
  assert(unmarked.length === 0,
    `chain: every one of the ${migrations.length} migrations has a marker, so the dynamic gate can follow the chain end (unmarked: ${unmarked.join(", ") || "none"})`);

  // --- wiring: the gate uses the derived plan, not a frozen list ---------------
  assert(gateSrc.includes("buildProbePlan") && gateSrc.includes("runMigrationProbes"),
    "gate: db-migrations builds and runs the derived probe plan");
  assert(gateSrc.includes("supabase\", \"migrations\"") || gateSrc.includes("supabase/migrations"),
    "gate: the plan is built from the repository's own migration directory");
  assert(gateSrc.includes("migration-markers.mjs"),
    "gate: the marker table is the source of truth (same module CI and the setup wizard use)");
  assert(!gateSrc.includes("typing_attempts?select=backspaces") && !gateSrc.includes("teachers?select=archived_at"),
    "gate: the hard-written 0035-0038 probe list is gone");
  assert(!/0001-00\d\d/.test(gateSrc),
    "gate: no detail string claims a frozen chain range any more");

  // --- never a false green ----------------------------------------------------
  assert(/if \(plan\.error\)[\s\S]{0,200}status = "BLOCKED"/.test(gateSrc),
    "gate: an unprovable chain end is BLOCKED, not PASS");
  assert(probeSrc.includes("function not exposed") && probeSrc.includes("the newest migration"),
    "planner: a missing newest migration is named, and the newest is mandatory");
  assert(/status: "BLOCKED"[\s\S]{0,400}credentials/.test(probeSrc),
    "executor: missing credentials BLOCK instead of passing");
  assert(/run the \/setup repair/.test(probeSrc),
    "executor: a partial tail names the repair action in plain language");

  // --- documentation matches the implementation -------------------------------
  assert(doc.includes("DERIVED from `scripts/migration-markers.mjs`") && !doc.includes("0030 `subject_preferences`"),
    "doc: the migration row describes the derived probe, not the stale 0030 chain");
  assert(/window it actually verified/.test(doc),
    "doc: states what a PASS proves instead of overclaiming the whole chain");

  // --- behaviour: the module's own scenarios --------------------------------
  const run = spawnSync(process.execPath, ["scripts/migration-probes.mjs", "--self-test"], { encoding: "utf8" });
  const out = `${run.stdout || ""}${run.stderr || ""}`;
  assert(run.status === 0, `probes: the self-test passes (exit ${run.status}) ${out.slice(-300)}`);
  assert(/MIGRATION PROBES: \d+ passed, 0 failed/.test(out),
    "probes: current database PASSes; old database, missing newest, and partial states FAIL; no credentials BLOCK");
  const passed = Number((out.match(/MIGRATION PROBES: (\d+) passed/) ?? [])[1] || 0);
  assert(passed >= 15, `probes: all ${passed} behavioural scenarios ran (>=15)`);

  // --- the production gate still behaves as a gate ---------------------------
  const checkCount = (gateSrc.match(/^  check\(/gm) ?? []).length;
  assert(checkCount === 41, "gate: still registers exactly 41 checks (no check added or lost)");
  assert(gateSrc.includes("RELEASE STATUS: GO") && gateSrc.includes("RELEASE STATUS: BLOCKED"),
    "gate: still emits exactly one final state");
  assert(newest >= "0056",
    `chain: the gate now covers migrations up to ${newest.slice(0, 4)} (>=0056)`);
}
