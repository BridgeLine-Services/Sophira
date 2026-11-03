import { readFileSync } from "fs";
import { buildInventory, checkCoverage, SYSTEM_TABLES } from "../src/lib/backup/inventory";
import {
  buildManifest,
  sha256Hex,
  objectIndex,
  validateManifest,
  manifestSummary,
  looksSecret,
  type BackupComponent,
  type StorageObjectFact,
} from "../src/lib/backup/manifest";

/**
 * BACKUP INTEGRITY (Stage 1, 2026-11-03).
 *
 * These tests exist because a backup system's most dangerous failure is a confident one.
 * A green tick on an incomplete backup is worse than no backup at all, since the owner
 * stops worrying. Every assertion here defends one way that could happen.
 */

const pass = (key: string, label: string, required = true): BackupComponent => ({ key, label, required, status: "pass" });

const REQUIRED_SET = (): BackupComponent[] => [
  pass("database", "Academic records"),
  pass("identities", "Member accounts"),
  pass("storage", "Uploaded files"),
  pass("schema", "Database structure"),
];

const FILES: StorageObjectFact[] = [
  { bucket: "private-docs", path: "u1/essay.pdf", bytes: 1200, sha256: "a".repeat(64) },
  { bucket: "private-docs", path: "u2/notes.txt", bytes: 300, sha256: "b".repeat(64) },
];

export function runBackupIntegrityTests(assert: (cond: boolean, msg: string) => void) {
  // ---- Inventory is derived from migrations, not hand-written -------------------
  const inv = buildInventory();
  assert(inv.migrations.length >= 40, "backup inventory: the migration chain is discovered from disk");
  assert(inv.tables.length >= 30, "backup inventory: application tables are discovered, not listed by hand");

  const names = new Set(inv.tables.map((t) => t.name));
  for (const required of ["profiles", "assignments", "courses", "invitations", "member_notifications"]) {
    assert(names.has(required), `backup inventory: ${required} is inside the backup scope`);
  }
  assert(inv.buckets.some((b) => b.id === "private-docs" && b.private), "backup inventory: the private upload bucket is discovered and known to be private");
  assert(inv.tables.filter((t) => t.name === "member_notifications").every((t) => t.memberOwned), "backup inventory: member-owned tables are recognised as owned per member");

  // ---- Coverage fails closed ---------------------------------------------------
  const allCovered = {
    coveredTables: inv.tables.map((t) => t.name),
    coveredBuckets: inv.buckets.map((b) => b.id),
  };
  assert(checkCoverage(inv, allCovered).ok, "backup coverage: covering everything the migrations created reports ok");

  const oneMissing = { ...allCovered, coveredTables: allCovered.coveredTables.filter((t) => t !== "assignments") };
  const missingReport = checkCoverage(inv, oneMissing);
  assert(!missingReport.ok && missingReport.missingTables.includes("assignments"),
    "backup coverage: a table that is not covered fails the check and is named");

  const noFilesCovered = { ...allCovered, coveredBuckets: [] };
  assert(!checkCoverage(inv, noFilesCovered).ok, "backup coverage: leaving out the upload bucket fails the check");

  const empty = checkCoverage(inv, { coveredTables: [], coveredBuckets: [] });
  assert(!empty.ok && empty.missingTables.length > 0, "backup coverage: an empty scope is a broken configuration, never 'nothing to back up'");
  assert(SYSTEM_TABLES.has("app_config") && !empty.missingTables.includes("app_config"),
    "backup coverage: system tables are excluded visibly, not silently");

  const stale = checkCoverage(inv, { coveredTables: [...allCovered.coveredTables, "table_that_never_existed"], coveredBuckets: allCovered.coveredBuckets });
  assert(stale.unknownTables.includes("table_that_never_existed"), "backup coverage: a stale configuration entry is reported");

  // ---- Checksums --------------------------------------------------------------
  assert(sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "backup manifest: checksums use SHA-256");

  const idxA = objectIndex(FILES);
  const idxB = objectIndex([...FILES].reverse());
  assert(idxA[0].indexSha256 === idxB[0].indexSha256, "backup manifest: the checksum index does not depend on listing order");
  assert(idxA[0].count === 2 && idxA[0].bytes === 1500, "backup manifest: object count and size are recorded per bucket");

  const changed = objectIndex([{ ...FILES[0], sha256: "c".repeat(64) }, FILES[1]]);
  assert(changed[0].indexSha256 !== idxA[0].indexSha256, "backup manifest: a changed file changes the checksum index");

  // ---- Success is earned, never defaulted -------------------------------------
  const good = buildManifest({ id: "bk1", createdAt: "2026-11-03T00:00:00Z", components: REQUIRED_SET(), objects: FILES });
  assert(good.ok, "backup manifest: a complete, verified backup is reported ok");
  assert(good.objectCount === 2 && good.objectBytes === 1500, "backup manifest: the manifest records what it protected");

  const failedDb = buildManifest({
    id: "bk2", createdAt: "2026-11-03T00:00:00Z", objects: FILES,
    components: REQUIRED_SET().map((c) => (c.key === "database" ? { ...c, status: "fail" as const, detail: "The database could not be read." } : c)),
  });
  assert(!failedDb.ok, "backup manifest: a failed database backup is never reported ok");

  const blockedIds = buildManifest({
    id: "bk3", createdAt: "2026-11-03T00:00:00Z", objects: FILES,
    components: REQUIRED_SET().map((c) => (c.key === "identities" ? { ...c, status: "blocked" as const } : c)),
  });
  assert(!blockedIds.ok, "backup manifest: an unverifiable member-account component is never reported ok");

  const optionalFail = buildManifest({
    id: "bk4", createdAt: "2026-11-03T00:00:00Z", objects: FILES,
    components: [...REQUIRED_SET(), { key: "ai", label: "Extra settings", required: false, status: "fail" as const }],
  });
  assert(optionalFail.ok, "backup manifest: an optional component never blocks a complete backup");

  const mismatched = buildManifest({
    id: "bk5", createdAt: "2026-11-03T00:00:00Z", components: REQUIRED_SET(), objects: FILES,
    checksumMismatches: ["u1/essay.pdf"],
  });
  assert(!mismatched.ok, "backup manifest: a checksum mismatch fails the whole backup");
  assert(mismatched.components.find((c) => c.key === "storage")?.status === "fail",
    "backup manifest: a failed checksum overrides a storage component that claimed success");

  const noFiles = buildManifest({
    id: "bk6", createdAt: "2026-11-03T00:00:00Z", components: REQUIRED_SET(), objects: [],
  });
  assert(!noFiles.ok, "backup manifest: claiming files are protected while finding none is a failure, not a pass");

  // ---- A stored manifest is untrusted input -----------------------------------
  assert(validateManifest(good).ok, "backup validation: a genuine manifest passes re-validation");
  const tampered = validateManifest({ ...good, components: good.components.map((c) => (c.key === "storage" ? { ...c, status: "blocked" } : c)), ok: true });
  assert(!tampered.ok && tampered.problems.length > 0,
    "backup validation: an edited manifest cannot keep its success claim");
  assert(validateManifest({ hello: "world" }).problems.length > 0, "backup validation: an unreadable file is reported, not thrown");
  assert(validateManifest({ ...good, components: [{ key: "x", label: "Thing", required: true, status: "weird" }] }).problems.some((p) => p.includes("unknown state")),
    "backup validation: an unrecognised state is refused rather than assumed fine");

  // ---- No credentials in a shareable artifact ---------------------------------
  assert(looksSecret("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"),
    "backup security: a JWT is recognised as a credential");
  assert(looksSecret("postgresql://postgres:hunter2@db.example.com:5432/postgres"),
    "backup security: a database address containing a password is recognised");
  assert(!looksSecret("private-docs/u1/essay.pdf"), "backup security: ordinary file paths are not treated as secrets");

  const leaked = validateManifest({ ...good, schemaVersion: "postgres://user:secret@host/db" });
  assert(!leaked.ok && leaked.problems.some((p) => p.includes("credential")),
    "backup security: a manifest carrying a credential is rejected");

  // ---- The owner sees sentences, not internals --------------------------------
  const summary = manifestSummary(good);
  assert(summary.ok && summary.title.includes("completed"), "backup summary: a good backup reads as completed");
  assert(summary.lines.every((l) => !/sha256|pg_dump|rls|json|http/i.test(l)),
    "backup summary: no implementation jargon is shown to the owner");

  const badSummary = manifestSummary(failedDb);
  assert(!badSummary.ok && badSummary.title.toLowerCase().includes("needs attention"),
    "backup summary: a failed backup says it needs attention instead of looking finished");

  // ---- The written inventory cannot drift from the schema ----------------------
  const inventoryDoc = readFileSync("docs/BACKUP_INVENTORY.md", "utf8");
  const undocumented = inv.tables
    .filter((t) => !inventoryDoc.includes("`" + t.name + "`"))
    .map((t) => t.name);
  assert(undocumented.length === 0,
    `backup inventory doc: every table in the schema is documented (missing: ${undocumented.slice(0, 5).join(", ")})`);
  assert(inv.buckets.every((b) => inventoryDoc.includes(b.id)),
    "backup inventory doc: every storage bucket is documented");
  assert(inventoryDoc.includes("not run") && inventoryDoc.includes("not tested"),
    "backup inventory doc: unverified items are stated plainly instead of being implied as done");
  assert(inventoryDoc.includes("SHA-256") && inventoryDoc.includes("checksum"),
    "backup inventory doc: the file-verification method is recorded");
}
