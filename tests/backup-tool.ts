/**
 * BACKUP TOOL CONTRACT (Stage 1, 2026-11-03).
 *
 * The command line is where an owner or a cron job meets these rules, so it gets its own
 * tests: a blocked run must never look like a completed one, a saved record must be
 * re-checked rather than trusted, and the tool must agree with the typed inventory.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInventory } from "../src/lib/backup/inventory";

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ["scripts/backup-sophira.mjs", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", DATABASE_URL: "", SUPABASE_DB_URL: "" },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function manifestWith(overrides: Record<string, unknown>) {
  return {
    manifest_version: 1,
    id: "test",
    created_at: new Date().toISOString(),
    app_commit: "abc1234",
    schema_version: 42,
    components: [
      { key: "database", status: "pass" },
      { key: "identities", status: "pass" },
      { key: "storage", status: "pass" },
      { key: "storage_checksums", status: "pass" },
      { key: "schema_state", status: "pass" },
    ],
    objects_count: 1,
    objects: [{ bucket: "private-docs", path: "a/b.pdf", size: 12, sha256: "x" }],
    warnings: [],
    ok: true,
    ...overrides,
  };
}

export async function runBackupToolTests(assert: (cond: boolean, msg: string) => void) {
  const inv = buildInventory();

  // ---- the tool and the typed inventory must agree ----
  const scope = JSON.parse(run(["--print-scope"]).out);
  assert(JSON.stringify(scope.tables) === JSON.stringify(inv.tables.map((t) => t.name).sort()),
    "backup tool: the command line protects exactly the tables the typed inventory knows about");
  assert(JSON.stringify(scope.buckets) === JSON.stringify(inv.buckets.map((b) => b.id).sort()),
    "backup tool: the command line protects exactly the storage buckets the inventory knows about");
  assert(scope.migrations.length === inv.migrations.length,
    "backup tool: the recorded schema version matches the migration chain");

  // ---- no access: blocked, never a false success ----
  const blocked = run(["--plan"]);
  assert(blocked.code === 2, "backup tool: a run without access exits as blocked (2), not success");
  assert(blocked.out.includes("cannot back itself up yet"),
    "backup tool: the owner is told plainly that the backup cannot happen yet");
  assert(blocked.out.includes("Nothing was changed"),
    "backup tool: the owner is told their information was not touched");
  assert(!/pg_dump|SUPABASE_|service.role|env var/i.test(blocked.out),
    "backup tool: the blocked message names no tools or configuration keys");

  // ---- a genuinely complete record verifies ----
  const dir = mkdtempSync(join(tmpdir(), "sophira-backup-"));
  const good = join(dir, "good.json");
  writeFileSync(good, JSON.stringify(manifestWith({})));
  const ok = run(["--verify", good]);
  assert(ok.code === 0 && ok.out.includes("Sophira backup completed"),
    "backup tool: a record with every item protected verifies and reads as completed");
  assert(ok.out.includes("Every item on the checklist passed"),
    "backup tool: verification states the checklist result explicitly");

  // ---- one missing piece fails the whole thing ----
  const partial = join(dir, "partial.json");
  writeFileSync(partial, JSON.stringify(manifestWith({
    ok: false,
    components: [
      { key: "database", status: "pass" },
      { key: "identities", status: "blocked" },
      { key: "storage", status: "fail" },
      { key: "storage_checksums", status: "pass" },
      { key: "schema_state", status: "pass" },
    ],
  })));
  const bad = run(["--verify", partial]);
  assert(bad.code === 1, "backup tool: a record with a failed component exits as failed (1)");
  assert(bad.out.includes("needs attention"), "backup tool: partial protection reads as needing attention");
  assert(bad.out.includes("Member accounts") && bad.out.includes("Uploaded files"),
    "backup tool: the failed components are named in ordinary language");

  // ---- a record that lies about itself is caught ----
  const lying = join(dir, "lying.json");
  writeFileSync(lying, JSON.stringify(manifestWith({
    components: [
      { key: "database", status: "pass" },
      { key: "identities", status: "pass" },
      { key: "storage", status: "pass" },
      { key: "storage_checksums", status: "pass" },
      { key: "schema_state", status: "pass" },
    ],
    objects_count: 5,
    objects: [],
  })));
  const lie = run(["--verify", lying]);
  assert(lie.code === 1 && /file (count|list)/.test(lie.out),
    "backup tool: a record claiming files it does not list is rejected");

  // ---- secrets never live in a backup record ----
  const leaky = join(dir, "leaky.json");
  writeFileSync(leaky, JSON.stringify(manifestWith({ note: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghij" })));
  const leak = run(["--verify", leaky]);
  assert(leak.code === 1 && leak.out.includes("must never be stored"),
    "backup tool: a record carrying a login token is rejected");

  // ---- missing file is explained, not crashed on ----
  const absent = run(["--verify", join(dir, "nope.json")]);
  assert(absent.code === 1 && absent.out.includes("No backup record was found"),
    "backup tool: a missing record produces a plain message, not a stack trace");

  // ---- a real run without access writes an honest record ----
  const runDir = join(dir, "out");
  const attempted = run(["--run", "--out", runDir]);
  assert(attempted.code === 3, "backup tool: an backed-up run without access exits as incomplete (3)");
  const written = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  assert(written.ok === false, "backup tool: the written record is marked incomplete");
  const capture = written.components.filter((c: { key: string }) => c.key !== "restore_drill");
  assert(capture.every((c: { status: string }) => c.status === "blocked"),
    "backup tool: every data-capture component is recorded as could-not-check rather than passed");
  const drill = written.components.find((c: { key: string }) => c.key === "restore_drill");
  assert(drill?.status === "not_run",
    "backup tool: member sign-in after a restore is reported as not checked, never as protected");
  assert(!written.components.some((c: { key: string; status: string }) => c.key === "identities" && c.status === "pass"),
    "backup tool: an unverified member-account step is never reported as protected");
  assert(!/eyJ|postgres(?:ql)?:\/\/[^\s/]+:[^\s@]+@/i.test(readFileSync(join(runDir, "manifest.json"), "utf8")),
    "backup tool: the written record contains no credentials");

  // ---- a practice restore is the only proof that sign-in survives ----
  const drillRun = (record: unknown, name: string) => {
    const path = join(dir, name);
    writeFileSync(path, typeof record === "string" ? record : JSON.stringify(record));
    const out = join(dir, `out-${name}`);
    run(["--run", "--out", out], { SOPHIRA_RESTORE_DRILL: path });
    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    return m.components.find((c: { key: string }) => c.key === "restore_drill");
  };
  const recent = new Date(Date.now() - 3 * 86_400_000).toISOString();
  assert(drillRun({ verified_at: recent, signin_verified: true }, "drill-ok.json")?.status === "pass",
    "backup tool: a recent practice restore that confirmed sign-in marks the drill step protected");
  assert(drillRun({ verified_at: recent, signin_verified: false }, "drill-bad.json")?.status === "fail",
    "backup tool: a practice restore that did NOT confirm sign-in fails instead of passing");
  const stale = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const staleDrill = drillRun({ verified_at: stale, signin_verified: true }, "drill-stale.json");
  assert(staleDrill?.status === "blocked" && String(staleDrill?.detail).includes(stale.slice(0, 10)),
    "backup tool: a stale practice restore is reported with its date, not treated as current proof");
  assert(drillRun("not json at all", "drill-broken.json")?.status === "blocked",
    "backup tool: an unreadable practice-restore record is could-not-check, not protected");
}
