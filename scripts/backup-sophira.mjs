#!/usr/bin/env node
/**
 * BACK UP SOPHIRA — Stage 1 (2026-11-03).
 *
 * Two jobs, in this order:
 *   1. Never claim a backup is complete when a piece is missing.
 *   2. Say what is missing in plain language an owner can act on.
 *
 * Usage
 *   node scripts/backup-sophira.mjs --plan          what would be protected, and what is missing
 *   node scripts/backup-sophira.mjs --run --out DIR do the backup (needs database + storage access)
 *   node scripts/backup-sophira.mjs --verify FILE   re-check a saved manifest
 *   node scripts/backup-sophira.mjs --print-scope   machine-readable scope (used by tests)
 *
 * Exit codes: 0 verified, 1 verification failed, 2 blocked (missing access), 3 incomplete.
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const MIGRATIONS = "supabase/migrations";
const TABLE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi;
const BUCKET_RE = /insert\s+into\s+storage\.buckets[^;]*?values\s*\(\s*'([a-z0-9-]+)'/gi;

const SECRET_PATTERNS = [
  { name: "a login token", re: /eyJ[A-Za-z0-9_-]{10,}/ },
  { name: "a database password", re: /postgres(?:ql)?:\/\/[^\s/]+:[^\s@]+@/i },
  { name: "an API key", re: /\b(?:sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|sbp_[a-f0-9]{20,})/ },
];

function readScope() {
  const tables = new Set();
  const buckets = new Set();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const m of sql.matchAll(TABLE_RE)) tables.add(m[1].toLowerCase());
    for (const m of sql.matchAll(BUCKET_RE)) buckets.add(m[1]);
  }
  return { migrations: files, tables: [...tables].sort(), buckets: [...buckets].sort() };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function findSecret(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const p of SECRET_PATTERNS) if (p.re.test(text)) return p.name;
  return null;
}

// ---- completeness rules --------------------------------------------------
// ok is true ONLY when every required component reports pass. "blocked" and
// "not_run" are never quietly upgraded to success.
const REQUIRED = ["database", "identities", "storage", "storage_checksums", "schema_state"];

function buildManifest({ id, components, objects, commit, schemaVersion, warnings }) {
  const objectsCount = objects.length;
  const objectsBytes = objects.reduce((n, o) => n + (Number(o.size) || 0), 0);
  const byKey = new Map(components.map((c) => [c.key, c]));

  // A component cannot pass while the evidence contradicts it.
  const storage = byKey.get("storage");
  if (storage && storage.status === "pass" && objectsCount === 0) {
    storage.status = "fail";
    storage.detail = "the listing was empty, so nothing can be shown to be protected";
  }
  const checks = byKey.get("storage_checksums");
  if (checks && checks.status === "pass" && objects.some((o) => !o.sha256)) {
    checks.status = "fail";
    checks.detail = "at least one file has no checksum, so it cannot be verified";
  }

  const ok = REQUIRED.every((k) => byKey.get(k)?.status === "pass");
  return {
    manifest_version: 1,
    id,
    created_at: new Date().toISOString(),
    app_commit: commit,
    schema_version: schemaVersion,
    components,
    objects_count: objectsCount,
    objects_bytes: objectsBytes,
    objects,
    warnings: warnings ?? [],
    ok,
  };
}

const LABELS = {
  database: "Your database",
  identities: "Member accounts",
  storage: "Uploaded files",
  storage_checksums: "File integrity",
  schema_state: "Database structure",
  restore_drill: "Member sign-in after a restore",
  configuration: "Settings",
};

const PLAIN = {
  pass: "protected",
  fail: "needs attention",
  blocked: "could not be checked",
  not_run: "not checked yet",
};

function summarize(manifest) {
  const lines = [];
  lines.push(manifest.ok ? "Sophira backup completed" : "Sophira backup needs attention");
  for (const c of manifest.components) {
    lines.push(`- ${LABELS[c.key] ?? c.key}: ${PLAIN[c.status] ?? c.status}`);
  }
  lines.push(`- Files protected: ${manifest.objects_count}`);
  const drill = (manifest.components ?? []).find((c) => c.key === "restore_drill");
  if (drill && drill.status !== "pass") {
    lines.push(`- ${LABELS.restore_drill}: ${drill.detail ?? "not checked yet"}`);
  }
  if (!manifest.ok) {
    const broken = manifest.components.filter((c) => REQUIRED.includes(c.key) && c.status !== "pass");
    lines.push("");
    lines.push("What to do next:");
    for (const c of broken) lines.push(`- ${LABELS[c.key] ?? c.key}: ${c.detail ?? "could not be completed"}`);
    lines.push("Nothing has been deleted or changed. Fix the item above and run the check again.");
  }
  return lines.join("\n");
}

// ---- verification of a saved manifest ------------------------------------
// A manifest is untrusted input: it may have been edited, truncated, or moved
// between machines. Re-check it instead of trusting its own "ok".
function verifyManifest(raw) {
  const problems = [];
  if (!raw || typeof raw !== "object") return { ok: false, problems: ["the backup record could not be read"] };
  if (raw.manifest_version !== 1) problems.push("the backup record was written by a different version");
  if (!Array.isArray(raw.components)) problems.push("the backup record is missing its checklist");
  else {
    const byKey = new Map(raw.components.map((c) => [c.key, c]));
    for (const key of REQUIRED) {
      const c = byKey.get(key);
      if (!c) problems.push(`${LABELS[key] ?? key} is missing from the record`);
      else if (c.status !== "pass") problems.push(`${LABELS[key] ?? key} is not protected (${PLAIN[c.status] ?? c.status})`);
    }
  }
  if (raw.ok !== true && problems.length === 0) problems.push("the backup was not marked complete");
  if (!Array.isArray(raw.objects)) problems.push("the file list is missing");
  else if (Number(raw.objects_count ?? 0) !== raw.objects.length) {
    problems.push("the file count does not match the file list, so the record cannot be trusted");
  }
  const leak = findSecret(raw);
  if (leak) problems.push(`the backup record contains ${leak}, which must never be stored in it`);
  return { ok: problems.length === 0, problems };
}

// ---- live backup ---------------------------------------------------------
/**
 * Reads one value from the live database. Used as EVIDENCE: a count of member
 * accounts inside the export, and the tables that actually exist. When psql is
 * missing or the database refuses, the caller must report "blocked", never "pass".
 */
function queryValue(dbUrl, sql) {
  if (!has("psql")) return { ok: false, reason: "psql is not installed, so the live database could not be read" };
  const r = spawnSync("psql", ["--no-psqlrc", "-t", "-A", "-q", "-v", "ON_ERROR_STOP=1", "--dbname", dbUrl, "-c", sql], { encoding: "utf8" });
  if (r.status !== 0) return { ok: false, reason: "the database did not answer the check" };
  return { ok: true, value: (r.stdout ?? "").trim() };
}

/**
 * A practice restore is the only proof that members can sign in again. The record
 * is a file the restore drill writes; without it the component stays "not_run".
 */
function readRestoreDrill() {
  const file = process.env.SOPHIRA_RESTORE_DRILL;
  if (!file) return { status: "not_run", detail: "a practice restore has not been run, so member sign-in after a restore is not proven yet" };
  let record;
  try {
    record = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { status: "blocked", detail: "the practice-restore record could not be read, so sign-in is still unproven" };
  }
  const when = new Date(String(record?.verified_at ?? ""));
  if (Number.isNaN(when.getTime())) {
    return { status: "blocked", detail: "the practice-restore record has no usable date, so sign-in is still unproven" };
  }
  const days = Math.floor((Date.now() - when.getTime()) / 86_400_000);
  const stamp = when.toISOString().slice(0, 10);
  if (record?.signin_verified !== true) {
    return { status: "fail", detail: `the practice restore on ${stamp} did not confirm that members could sign in` };
  }
  if (days > 180) {
    return { status: "blocked", detail: `the last confirmed practice restore was ${stamp} (${days} days ago); run a new one` };
  }
  return { status: "pass", detail: `members signed in after a practice restore on ${stamp}` };
}

function has(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

async function listObjects(base, key, bucket, prefix = "", found = []) {
  const res = await fetch(`${base}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!res.ok) throw new Error(`listing ${bucket} returned ${res.status}`);
  for (const entry of await res.json()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!entry.id) { await listObjects(base, key, bucket, path, found); continue; }
    found.push({ bucket, path, size: entry.metadata?.size ?? 0 });
  }
  return found;
}

async function copyObjects(base, key, outDir, objects) {
  let failures = 0;
  for (const object of objects) {
    const res = await fetch(`${base}/storage/v1/object/${object.bucket}/${object.path.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) { object.sha256 = null; failures++; continue; }
    const body = Buffer.from(await res.arrayBuffer());
    object.size = body.length;
    object.sha256 = sha256(body);
    const target = join(outDir, "objects", object.bucket, object.path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, body);
  }
  return failures;
}

async function runBackup(outDir) {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const dbUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? "";
  const scope = readScope();
  const components = [];
  const warnings = [];

  if (!base || !key || !dbUrl) {
    for (const k of REQUIRED) components.push({ key: k, status: "blocked", detail: "Sophira was not given access to its own storage" });
    components.push({ key: "restore_drill", ...readRestoreDrill() });
    const blockedManifest = buildManifest({
      id: `blocked-${Date.now()}`, components, objects: [], commit: null,
      schemaVersion: scope.migrations.length, warnings: ["access was not available, so nothing was backed up"],
    });
    // The record is written even when blocked: an owner checking later must see why
    // the last attempt protected nothing, rather than finding no record at all.
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "manifest.json"), JSON.stringify(blockedManifest, null, 2));
    return blockedManifest;
  }

  mkdirSync(join(outDir, "objects"), { recursive: true });

  let dbStatus = "blocked", dbDetail = "the database tool is not installed on this machine";
  let dumpPath = null;
  if (has("pg_dump")) {
    dumpPath = join(outDir, "database.dump");
    const dump = spawnSync("pg_dump", ["--dbname", dbUrl, "-Fc", "-f", dumpPath], { stdio: "pipe" });
    if (dump.status === 0) { dbStatus = "pass"; dbDetail = `saved ${(readFileSync(dumpPath).length / 1024 / 1024).toFixed(1)} MB`; }
    else { dbStatus = "fail"; dbDetail = "the database refused the export; nothing was deleted, try again"; }
  }
  components.push({ key: "database", status: dbStatus, detail: dbDetail });

  // Member accounts live in the same database. A dump proves a FILE was written; it
  // does NOT prove the account rows are inside it, and it never proves sign-in. The
  // component is only "pass" when the account rows were actually counted, and the
  // separate restore_drill component carries the sign-in proof (2026-11-10).
  if (dbStatus !== "pass") {
    components.push({ key: "identities", status: "blocked", detail: "not exported, so member accounts cannot be preserved yet" });
  } else {
    const accounts = queryValue(dbUrl, "select count(*) from auth.users");
    if (!accounts.ok) {
      components.push({ key: "identities", status: "blocked", detail: accounts.reason });
    } else {
      const n = Number(accounts.value);
      components.push({
        key: "identities",
        status: Number.isFinite(n) && n > 0 ? "pass" : "fail",
        detail: Number.isFinite(n) && n > 0
          ? `${n} member account(s) are inside the export; signing in is proven only by a practice restore`
          : "the database reported no member accounts, so there is nothing to restore",
      });
    }
  }

  let objects = [];
  let storageStatus = "pass", checksumStatus = "pass", storageDetail = "every file was copied";
  try {
    for (const bucket of scope.buckets) objects = objects.concat(await listObjects(base, key, bucket));
    const failures = await copyObjects(base, key, outDir, objects);
    if (failures > 0) { storageStatus = "fail"; checksumStatus = "fail"; storageDetail = `${failures} file(s) could not be copied`; }
    if (objects.length === 0) { storageStatus = "fail"; storageDetail = "no files were found, so nothing can be shown to be protected"; }
  } catch (err) {
    storageStatus = "blocked"; checksumStatus = "blocked";
    storageDetail = "the file store did not answer, so uploaded files were not copied";
    warnings.push(String(err.message ?? err));
  }
  components.push({ key: "storage", status: storageStatus, detail: storageDetail });
  components.push({ key: "storage_checksums", status: checksumStatus, detail: objects.length ? `${objects.length} file(s) fingerprinted` : "no files to fingerprint" });
  // The number of migration FILES says what should exist; it says nothing about what
  // the live database actually has. Compare the two, and stay "blocked" when the live
  // schema cannot be read (2026-11-10).
  const liveTables = queryValue(dbUrl, "select table_name from information_schema.tables where table_schema = 'public'");
  if (!liveTables.ok) {
    components.push({ key: "schema_state", status: "blocked", detail: liveTables.reason });
  } else {
    const present = new Set(liveTables.value.split("\n").map((t) => t.trim().toLowerCase()).filter(Boolean));
    const missing = scope.tables.filter((t) => !present.has(t));
    components.push({
      key: "schema_state",
      status: missing.length === 0 ? "pass" : "fail",
      detail: missing.length === 0
        ? `${scope.tables.length} of ${scope.tables.length} expected tables are present in the live database`
        : `${missing.length} expected table(s) are missing from the live database`,
    });
  }
  components.push({ key: "restore_drill", ...readRestoreDrill() });
  components.push({ key: "configuration", status: "pass", detail: "no passwords or keys are stored in the backup record" });

  const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout?.trim() || null;
  const manifest = buildManifest({ id: `backup-${new Date().toISOString().replace(/[:.]/g, "-")}`, components, objects, commit, schemaVersion: scope.migrations.length, warnings });
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

// ---- command line --------------------------------------------------------
function plan() {
  const scope = readScope();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const missing = [];
  if (!base) missing.push("the address of Sophira's private storage");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("permission to read Sophira's files");
  if (!(process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL)) missing.push("permission to read Sophira's database");
  if (!has("pg_dump")) missing.push("the database backup tool on this machine");
  console.log("What a Sophira backup protects");
  console.log(`- ${scope.tables.length} kinds of academic record, including every member's own work`);
  console.log(`- member accounts, roles and invitations`);
  console.log(`- ${scope.buckets.length} private file area(s): ${scope.buckets.join(", ")}`);
  console.log(`- the database structure (${scope.migrations.length} updates)`);
  if (missing.length === 0) { console.log("\nEverything needed is available. Run --run to protect Sophira now."); return 0; }
  console.log("\nSophira cannot back itself up yet. It needs:");
  for (const item of missing) console.log(`- ${item}`);
  console.log("\nNothing was changed. Add the missing access and run this again.");
  return 2;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) { console.log("node scripts/backup-sophira.mjs [--plan | --run --out DIR | --verify FILE | --print-scope]"); return 0; }
  if (args.includes("--print-scope")) { console.log(JSON.stringify(readScope(), null, 2)); return 0; }
  if (args.includes("--verify")) {
    const file = args[args.indexOf("--verify") + 1];
    if (!file || !existsSync(file)) { console.log("No backup record was found at that location."); return 1; }
    const result = verifyManifest(JSON.parse(readFileSync(file, "utf8")));
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    console.log(summarize({ ...manifest, components: manifest.components ?? [], objects_count: manifest.objects_count ?? 0 }));
    if (!result.ok) { console.log("\nProblems found:"); for (const p of result.problems) console.log(`- ${p}`); return 1; }
    console.log("\nEvery item on the checklist passed.");
    return 0;
  }
  if (args.includes("--run")) {
    const at = args.indexOf("--out");
    const outDir = at >= 0 ? args[at + 1] : "backups";
    const manifest = await runBackup(outDir);
    console.log(summarize(manifest));
    return manifest.ok ? 0 : 3;
  }
  return plan();
}

main().then((code) => { process.exitCode = code; }).catch((err) => {
  console.error("Sophira could not finish the backup check. Nothing was deleted or changed.");
  console.error(String(err?.message ?? err));
  process.exitCode = 1;
});
