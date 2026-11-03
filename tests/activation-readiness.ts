import { existsSync, readFileSync } from "fs";

/**
 * The activation runbook is only useful if it stays true. These checks fail if someone
 * quietly rewrites the migration into something destructive, or upgrades the runbook's
 * claims before the evidence exists.
 */
export function runActivationReadinessTests(assert: (cond: boolean, msg: string) => void) {
  const sql = readFileSync("supabase/migrations/0042_member_notifications.sql", "utf8");
  assert(!/\bdrop\s+(table|column|schema)\b|\btruncate\b|\bdelete\s+from\b/i.test(sql),
    "0042: the pending migration stays additive, so applying it cannot destroy member data");
  assert((sql.match(/create table if not exists/gi) ?? []).length >= 2,
    "0042: it creates the notification tables");
  assert(/enable row level security/i.test(sql),
    "0042: the new tables are protected before they are reachable");

  const doc = readFileSync("docs/PRODUCTION_ACTIVATION.md", "utf8");
  assert(/Notification \*\*list\*\* \| \*\*NOT LIVE\*\*/.test(doc),
    "runbook: the notification list is still recorded as not live until 0042 is applied");
  assert(/zero\*\* destructive statements/.test(doc),
    "runbook: it states why the migration is safe, with the check that backs it");
  assert(!/fully verified|all checks passed|production is complete/i.test(doc),
    "runbook: it never claims a finished state it has not earned");

  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  for (const name of ["db:migrate", "verify:production", "test"]) {
    assert(Boolean(pkg.scripts[name]), `runbook: npm run ${name} exists, so its instructions can be followed`);
  }
  for (const file of ["scripts/production-verification.mjs", "scripts/release-gate.mjs"]) {
    assert(existsSync(file), `runbook: ${file} exists, so its verification step is real`);
  }
  assert(!/eyJ[A-Za-z0-9_-]{20,}/.test(doc),
    "runbook: no key material is pasted into the guide");
}
