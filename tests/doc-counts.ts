import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Documentation counts must be true.
 *
 * docs/BACKUP_INVENTORY.md tells whoever restores Sophira how much data to expect.
 * A stale count there is not cosmetic: it makes a short restore look complete.
 * So the numbers in the document are asserted against the repository itself, and
 * the suite fails when either one drifts.
 *
 * This is deliberately strict. If a migration is added, the document must be
 * updated in the same change; the failure message says which number to fix.
 */

// Compiled to tests-dist/tests/, so the repository root is two levels up. Using
// process.cwd() would break when the suite is run from another directory.
const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const INVENTORY = join(ROOT, "docs", "BACKUP_INVENTORY.md");

/** Every CREATE TABLE in the migrations, normalised to a bare table name. */
function tablesCreated(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    // Deliberately simple: the literal keyword, optional IF NOT EXISTS, optional
    // public. schema and optional double quotes. Comments are stripped first so a
    // commented-out CREATE cannot inflate the count.
    const withoutComments = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(withoutComments))) names.add(match[1].toLowerCase());
  }
  return [...names].sort();
}

/** Tables dropped later in the same migration set. A dropped table must not count. */
function tablesDropped(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const pattern = /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql))) names.add(match[1].toLowerCase());
  }
  return [...names].sort();
}

/** Storage buckets the migrations create. */
function bucketsCreated(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const pattern = /insert\s+into\s+storage\.buckets[\s\S]{0,400}?'([a-z0-9-]+)'/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql))) names.add(match[1].toLowerCase());
  }
  return [...names].sort();
}

type Check = (condition: boolean, message: string) => void;

export function runDocCountTests(assert: Check, _section?: unknown): void {
  const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
  const created = tablesCreated();
  const dropped = tablesDropped();
  const live = created.filter((t) => !dropped.includes(t));
  const buckets = bucketsCreated();

  // The extraction itself must be sane before it is used to judge the document.
  assert(migrationFiles.length > 40, `doc-counts: expected the migration set, found ${migrationFiles.length} files`);
  assert(live.length >= 50, `doc-counts: table extraction looks broken, only ${live.length} tables found`);
  assert(!live.includes("if"), "doc-counts: extraction picked up a keyword instead of a table name");

  const doc = readFileSync(INVENTORY, "utf8");
  const scopeLine = doc.split("\n").find((line) => /Scope at time of writing/i.test(line)) ?? "";
  assert(scopeLine.length > 0, "doc-counts: BACKUP_INVENTORY.md lost its scope line");

  const claimedMigrations = Number((/(\d+)\s+migrations?/i.exec(scopeLine) ?? [])[1]);
  const claimedTables = Number((/(\d+)\s+(?:application\s+)?tables?/i.exec(scopeLine) ?? [])[1]);
  const claimedBuckets = Number((/(\d+)\s+(?:private\s+)?storage\s+buckets?/i.exec(scopeLine) ?? [])[1]);

  assert(!Number.isNaN(claimedMigrations), `doc-counts: scope line names no migration count: "${scopeLine}"`);
  assert(!Number.isNaN(claimedTables), `doc-counts: scope line names no table count: "${scopeLine}"`);
  assert(!Number.isNaN(claimedBuckets), `doc-counts: scope line names no bucket count: "${scopeLine}"`);

  assert(claimedMigrations === migrationFiles.length,
    `doc-counts: BACKUP_INVENTORY.md says ${claimedMigrations} migrations; supabase/migrations holds ${migrationFiles.length}`,
  );
  assert(claimedTables === live.length,
    `doc-counts: BACKUP_INVENTORY.md says ${claimedTables} tables; the migrations create ${live.length} that are never dropped`,
  );
  assert(claimedBuckets === buckets.length,
    `doc-counts: BACKUP_INVENTORY.md says ${claimedBuckets} storage buckets; the migrations create ${buckets.length} (${buckets.join(", ")})`,
  );

  // The bucket that matters must be named, because a restore that forgets it
  // produces a working app whose documents are all missing.
  for (const bucket of buckets) {
    assert(doc.includes(bucket), `doc-counts: the "${bucket}" bucket is created by the migrations but not named in the inventory`);
  }

  // The inventory must still explain that member identity has to be restored.
  assert(/original identifiers/i.test(doc), "doc-counts: the inventory must keep the original-identifier requirement for member identity");
  assert(/restore/i.test(doc), "doc-counts: the inventory must describe restoring, not only backing up");
}
