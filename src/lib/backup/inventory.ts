import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * BACKUP SCOPE INVENTORY (Stage 1, 2026-11-03).
 *
 * The failure this file exists to prevent: a hand-written list of "tables we back up"
 * that quietly falls behind the migrations, so a later feature stores member work in a
 * table nobody backs up and only notices after a restore.
 *
 * The inventory is therefore DERIVED from the migration chain, not typed out by hand.
 * Every `create table` and every storage bucket in `supabase/migrations/*.sql` becomes an
 * expected backup target automatically. Adding a migration adds coverage; nothing has to
 * be remembered.
 *
 * Node-only (reads the repository). Used by tests and owner-facing backup status, never
 * shipped to the browser.
 */

export interface TableFact {
  /** Table name without the public. schema prefix. */
  name: string;
  /** The migration file that first created it, e.g. 0001_init.sql. */
  introducedBy: string;
  /** Rows belong to one member (has a user_id/owner column in its create statement). */
  memberOwned: boolean;
  /** Holds private academic content or credentials; must never appear in a report. */
  sensitive: boolean;
}

export interface BucketFact {
  id: string;
  /** Only true when the migration explicitly creates it as private. */
  private: boolean;
  introducedBy: string;
}

export interface SchemaInventory {
  tables: TableFact[];
  buckets: BucketFact[];
  migrations: string[];
}

/** Tables that are deliberately NOT part of the member-facing backup scope. */
export const SYSTEM_TABLES = new Set([
  "sophira_meta",
  "app_config",
  "owner_bootstrap",
  "provider_usage",
]);

/**
 * Content that must be protected but must never be copied into a manifest, log, report
 * or preservation snapshot. The backup covers these; the REPORTING layer must not print
 * their contents (only counts and checksums).
 */
const SENSITIVE_PATTERNS = [
  /(^|_)(token|tokens|secret|secrets)($|_)/,
  /password/,
  /credential/,
  /(^|_)content($|_)/,
  /(^|_)text($|_)/,
  /(^|_)(essay|draft|body|transcript)($|_)/,
];

const MEMBER_OWNER_COLUMNS = /\b(user_id|owner_id|created_by)\b/;

export function migrationsDir(root = "supabase/migrations"): string {
  return root;
}

export function migrationFiles(root = "supabase/migrations"): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Reads the migration chain and derives the backup scope.
 *
 * Deliberately simple parsing: this reads CREATE TABLE / storage.buckets statements
 * rather than trying to be a SQL parser. It is a coverage check, not a schema authority.
 */
export function buildInventory(root = "supabase/migrations"): SchemaInventory {
  const migrations = migrationFiles(root);
  const tables = new Map<string, TableFact>();
  const buckets = new Map<string, BucketFact>();

  for (const file of migrations) {
    const sql = readFileSync(join(root, file), "utf8");
    const lower = sql.toLowerCase();

    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi;
    let match: RegExpExecArray | null;
    while ((match = createRe.exec(sql))) {
      const name = match[1].toLowerCase();
      if (tables.has(name)) continue;
      const body = match[2].toLowerCase();
      tables.set(name, {
        name,
        introducedBy: file,
        memberOwned: MEMBER_OWNER_COLUMNS.test(body),
        sensitive: SENSITIVE_PATTERNS.some((re) => re.test(name)),
      });
    }

    // Storage buckets: `insert into storage.buckets (id, name, public) values ('x', 'x', false)`
    const bucketRe = /storage\.buckets[\s\S]{0,200}?values\s*\(\s*'([^']+)'[^)]*?,\s*(true|false)\s*\)/gi;
    while ((match = bucketRe.exec(sql))) {
      const id = match[1];
      if (buckets.has(id)) continue;
      buckets.set(id, { id, private: match[2].toLowerCase() === "false", introducedBy: file });
    }
    // A bucket created any other way is still a bucket: catch the literal names too.
    if (/storage\.buckets/.test(lower)) {
      const nameRe = /'(private-docs|[a-z0-9-]+-docs)'/g;
      while ((match = nameRe.exec(sql))) {
        const id = match[1];
        if (!buckets.has(id)) buckets.set(id, { id, private: true, introducedBy: file });
      }
    }
  }

  return {
    tables: [...tables.values()].sort((a, b) => a.name.localeCompare(b.name)),
    buckets: [...buckets.values()].sort((a, b) => a.id.localeCompare(b.id)),
    migrations,
  };
}

export interface CoverageInput {
  /** Table names the backup process says it protects. */
  coveredTables: readonly string[];
  /** Bucket ids the backup process says it protects. */
  coveredBuckets: readonly string[];
}

export interface CoverageReport {
  /** Member-facing tables present in the schema but absent from the backup scope. */
  missingTables: string[];
  missingBuckets: string[];
  /** Names claimed by the backup that no longer exist (stale config). */
  unknownTables: string[];
  /** System tables are intentionally excluded; listed so the exclusion stays visible. */
  systemExcluded: string[];
  ok: boolean;
}

/**
 * Compares what the migrations created against what the backup actually covers.
 *
 * Fails closed: an empty coverage list is not "nothing to back up", it is a broken
 * configuration, and every table counts as missing.
 */
export function checkCoverage(inventory: SchemaInventory, coverage: CoverageInput): CoverageReport {
  const coveredTables = new Set(coverage.coveredTables.map((t) => t.toLowerCase()));
  const coveredBuckets = new Set(coverage.coveredBuckets);
  const presentTables = new Set(inventory.tables.map((t) => t.name));

  const systemExcluded: string[] = [];
  const missingTables: string[] = [];
  for (const table of inventory.tables) {
    if (SYSTEM_TABLES.has(table.name)) {
      systemExcluded.push(table.name);
      continue;
    }
    if (!coveredTables.has(table.name)) missingTables.push(table.name);
  }

  const missingBuckets = inventory.buckets
    .filter((b) => !coveredBuckets.has(b.id))
    .map((b) => b.id);

  const unknownTables = [...coveredTables].filter((t) => !presentTables.has(t));

  return {
    missingTables,
    missingBuckets,
    unknownTables,
    systemExcluded,
    ok: missingTables.length === 0 && missingBuckets.length === 0,
  };
}
