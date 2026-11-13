/**
 * Migration probe planning + execution for the release gate (2026-11-13).
 *
 * WHY THIS EXISTS
 * The release gate's `db-migrations` check used to ask the live database for four
 * hand-written objects that belonged to migrations 0035-0038. The chain has since
 * reached 0056, so the check could answer PASS while the newest migrations were
 * missing: it verified a stale tail. It also had to be edited by hand every time a
 * migration was added, which is exactly how it fell behind.
 *
 * WHAT IT DOES NOW
 * The probe set is DERIVED from `scripts/migration-markers.mjs` - the same single
 * source of truth CI (`scripts/apply-migrations.mjs`) and the first-launch wizard
 * already use - so the gate cannot drift from the chain again. The newest `sample`
 * migrations are probed against the live schema. The newest migration is mandatory:
 * if a probe cannot be derived for it, the check is BLOCKED, never PASS.
 *
 * WHAT IT PROVES, HONESTLY
 * A PASS means: every sampled marker object exists in the live schema, including the
 * newest migration's. It does NOT mean every historical migration was replayed; a
 * gap older than the sampled window is not visible from the REST API. The detail
 * string therefore names the window it actually verified instead of claiming the
 * whole chain.
 *
 * No new dependencies: Node built-ins, the existing markers module, and the same
 * service-role REST access the rest of the gate uses.
 */

const MIGRATION_RE = /^(\d{4})_/;

/** Extract a REST-verifiable probe from a marker SQL expression, or null. */
export function parseMarker(sql) {
  if (typeof sql !== "string" || !sql.trim()) return null;
  const text = sql.replace(/\s+/g, " ");

  // to_regclass('public.thing') is not null
  const table = text.match(/to_regclass\(\s*'public\.([a-z0-9_]+)'\s*\)/i);
  if (table) return { kind: "table", table: table[1] };

  // information_schema.columns ... table_name = 'thing' ... column_name = 'col'
  if (/information_schema\.columns/i.test(text)) {
    const t = text.match(/table_name\s*=\s*'([a-z0-9_]+)'/i);
    const c = text.match(/column_name\s*=\s*'([a-z0-9_]+)'/i);
    if (t && c) return { kind: "column", table: t[1], column: c[1] };
    return null;
  }

  // pg_proc ... proname = 'fn'
  if (/pg_proc/i.test(text)) {
    const fn = text.match(/proname\s*=\s*'([a-z0-9_]+)'/i);
    if (fn) return { kind: "function", function: fn[1] };
  }

  // Constraints, grants and other catalog-only markers have no REST surface.
  return null;
}

function restPath(target) {
  if (target.kind === "table") return `/rest/v1/${target.table}?select=*&limit=0`;
  if (target.kind === "column") return `/rest/v1/${target.table}?select=${target.column}&limit=0`;
  if (target.kind === "function") return `/rest/v1/rpc/${target.function}`;
  return null;
}

function label(marker, target) {
  if (target.kind === "table") return `${target.table} (${marker})`;
  if (target.kind === "column") return `${target.table}.${target.column} (${marker})`;
  if (target.kind === "function") return `${target.function}() (${marker})`;
  return marker;
}

/**
 * Build the probe plan for the newest `sample` migrations (default 12).
 * Returns { chainEnd, window, probes, unverifiable, error }.
 * `error` is set when the plan cannot prove the newest migration - the gate must
 * then report BLOCKED rather than PASS.
 */
export function buildProbePlan({ markers, migrationFiles, sample = 12 } = {}) {
  const files = (Array.isArray(migrationFiles) ? migrationFiles : [])
    .filter((f) => typeof f === "string" && f.endsWith(".sql") && MIGRATION_RE.test(f))
    .sort();
  if (!files.length) {
    return { chainEnd: null, window: [], probes: [], unverifiable: [], error: "no migration files were found to probe" };
  }
  const newest = files[files.length - 1];
  const chainEnd = newest.slice(0, 4);
  const window = files.slice(Math.max(0, files.length - Math.max(1, sample)));
  const probes = [];
  const unverifiable = [];

  for (const file of window) {
    const marker = markers && markers[file];
    const parsed = marker ? parseMarker(marker) : null;
    if (!parsed) {
      unverifiable.push({ file, reason: marker ? "marker is catalog-only (no REST surface)" : "no marker recorded" });
      continue;
    }
    probes.push({
      file,
      kind: parsed.kind,
      target: parsed,
      path: restPath(parsed),
      // PostgREST's OpenAPI document lists functions as "/rpc/<name>" (the REST call
      // itself is /rest/v1/rpc/<name>) - keep both shapes explicit.
      docPath: parsed.kind === "function" ? `/rpc/${parsed.function}` : null,
      label: label(file, parsed),
    });
  }

  // The newest migration must be provable, or the gate cannot say anything useful
  // about the chain end. This is the exact defect shape that let 0053-0056 slip: a
  // check that answered PASS about objects that were not the newest ones.
  const newestProbe = probes.find((p) => p.file === newest);
  if (!newestProbe) {
    const why = unverifiable.find((u) => u.file === newest);
    return {
      chainEnd,
      window,
      probes,
      unverifiable,
      error: `the newest migration ${newest} has no REST-verifiable marker (${why ? why.reason : "unknown"}) - the gate cannot verify the chain end`,
    };
  }

  return { chainEnd, window, probes, unverifiable, error: null };
}

/**
 * Execute a plan against the live database.
 * Table/column markers use `select=<col>&limit=0` (200 only when the column exists).
 * Function markers are checked against PostgREST's OpenAPI document instead of being
 * CALLED - calling them could have side effects and would report a permission error
 * as a missing migration.
 *
 * Returns { status: "PASS" | "FAIL" | "BLOCKED", detail, verified, failed }.
 */
export async function runMigrationProbes({ baseUrl, apiKey, plan, fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  if (!plan || plan.error) {
    return { status: "BLOCKED", detail: plan?.error || "no probe plan", verified: 0, failed: [] };
  }
  if (!baseUrl || !apiKey) {
    return {
      status: "BLOCKED",
      detail: "database credentials (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) are not available to the gate - live migration verification is BLOCKED (never PASS)",
      verified: 0,
      failed: [],
    };
  }

  const root = String(baseUrl).replace(/\/$/, "");
  const headers = { apikey: apiKey, Authorization: `Bearer ${apiKey}` };
  const failed = [];
  let verified = 0;

  const rpcProbes = plan.probes.filter((p) => p.kind === "function");
  let rpcPaths = null;
  if (rpcProbes.length) {
    try {
      const res = await fetchImpl(`${root}/rest/v1/`, {
        method: "GET",
        headers: { ...headers, Accept: "application/openapi+json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const doc = await res.json();
        rpcPaths = new Set(Object.keys(doc?.paths || {}));
      }
    } catch {
      rpcPaths = null;
    }
  }

  for (const probe of plan.probes) {
    try {
      if (probe.kind === "function") {
        if (rpcPaths) {
          if (rpcPaths.has(probe.docPath || probe.path)) verified += 1;
          else failed.push(`${probe.label}: function not exposed`);
          continue;
        }
        // Fall back to a HEAD on the RPC endpoint: PostgREST answers 404 for an
        // unknown function. Never POST, so nothing executes.
        const res = await fetchImpl(`${root}${probe.path}`, { method: "HEAD", headers, signal: AbortSignal.timeout(timeoutMs) });
        if (res.status === 404) failed.push(`${probe.label}: function missing`);
        else verified += 1;
        continue;
      }
      const res = await fetchImpl(`${root}${probe.path}`, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) verified += 1;
      else failed.push(`${probe.label}: HTTP ${res.status}`);
    } catch (e) {
      failed.push(`${probe.label}: ${String(e?.message || e).slice(0, 80)}`);
    }
  }

  const windowLabel = plan.window.length ? `${plan.window[0].slice(0, 4)}-${plan.chainEnd}` : plan.chainEnd;

  if (failed.length === 0) {
    return {
      status: "PASS",
      detail: `every sampled migration marker is in the LIVE production schema (window ${windowLabel}, ${verified} of ${plan.probes.length} probes verified, newest ${plan.chainEnd} proven${plan.unverifiable.length ? `; ${plan.unverifiable.length} catalog-only marker(s) not probeable via REST` : ""})`,
      verified,
      failed,
    };
  }
  if (verified === 0) {
    return {
      status: "FAIL",
      detail: `production database rejected every migration probe (${failed.join("; ").slice(0, 180)}) - migrations may be missing`,
      verified,
      failed,
    };
  }
  return {
    status: "FAIL",
    detail: `live schema is missing migration markers in the ${windowLabel} window: ${failed.join("; ").slice(0, 200)} - run the /setup repair to apply the missing tail`,
    verified,
    failed,
  };
}

// ---------------------------------------------------------------------------
// Self-test: `node scripts/migration-probes.mjs --self-test`
//
// Runs the planner and executor against simulated production schemas, including
// the exact defect this module was written to fix (an OLD database answering
// "everything is fine") and the partial tails that a real repair can leave.
// No credentials and no network: the fetch function is injected.
// ---------------------------------------------------------------------------
function fakeFetch({ missing = [], rpc = [], docOk = true } = {}) {
  return async (url) => {
    if (String(url).endsWith("/rest/v1/")) {
      const paths = Object.fromEntries((docOk ? rpc : []).map((n) => [`/rpc/${n}`, {}]));
      return { ok: docOk, status: docOk ? 200 : 500, json: async () => ({ paths }) };
    }
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const hit = missing.some((m) => path.includes(m));
    return { ok: !hit, status: hit ? 404 : 200, json: async () => ({}) };
  };
}

async function selfTest() {
  const { readdirSync } = await import("node:fs");
  const { MARKERS } = await import("./migration-markers.mjs");
  const files = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql"));
  const newest = [...files].sort().pop();
  let passed = 0;
  const failed = [];
  const check = (cond, msg) => { if (cond) passed += 1; else failed.push(msg); };

  const current = buildProbePlan({ markers: MARKERS, migrationFiles: files });
  check(current.error === null, "a current repository produces a probe plan");
  check(current.chainEnd === newest.slice(0, 4), "the plan follows the repository's newest migration");
  check(current.probes.some((p) => p.file === newest), "the newest migration is always probed");

  const allOk = await runMigrationProbes({ baseUrl: "https://x.supabase.co", apiKey: "k", plan: current,
    fetchImpl: fakeFetch({ rpc: ["record_admin_event", "network_activity_daily", "network_member_phones"] }) });
  check(allOk.status === "PASS", "a fully current database PASSES");
  check(/window \d{4}-\d{4}/.test(allOk.detail), "the PASS names the verified window instead of claiming the whole chain");

  const oldDb = await runMigrationProbes({ baseUrl: "https://x.supabase.co", apiKey: "k", plan: current,
    fetchImpl: fakeFetch({ missing: current.probes.map((p) => p.target.table || p.target.function || "").filter(Boolean).slice(-6) }) });
  check(oldDb.status === "FAIL", "an OLD database cannot produce a false PASS");

  const missingNewest = await runMigrationProbes({ baseUrl: "https://x.supabase.co", apiKey: "k", plan: current,
    fetchImpl: fakeFetch({ missing: ["rpc/network_activity_daily"] }) });
  check(missingNewest.status === "FAIL", "a missing newest migration FAILS");
  check(/network_activity_daily|0056/.test(missingNewest.detail), "the failure names the missing newest migration");

  const partial = await runMigrationProbes({ baseUrl: "https://x.supabase.co", apiKey: "k", plan: current,
    fetchImpl: fakeFetch({ missing: ["qa_reports"], rpc: ["record_admin_event", "network_activity_daily", "network_member_phones"] }) });
  check(partial.status === "FAIL" && /qa_reports/.test(partial.detail), "a partial state is detected and named");
  check(/\/setup repair/.test(partial.detail), "the diagnostic names the repair action");
  check(partial.verified > 0 && partial.failed.length === 1, "the executor reports how much was verified alongside what failed");

  const noCreds = await runMigrationProbes({ baseUrl: "", apiKey: "", plan: current });
  check(noCreds.status === "BLOCKED", "missing credentials BLOCK the check, never PASS it");

  const unprobeable = buildProbePlan({ markers: { ...MARKERS, [newest]: "select 1" }, migrationFiles: files });
  check(Boolean(unprobeable.error), "an unprovable newest marker blocks instead of guessing");
  const blocked = await runMigrationProbes({ baseUrl: "https://x.supabase.co", apiKey: "k", plan: unprobeable, fetchImpl: fakeFetch() });
  check(blocked.status === "BLOCKED", "a plan with no provable chain end can never PASS");

  const empty = buildProbePlan({ markers: MARKERS, migrationFiles: [] });
  check(Boolean(empty.error), "an empty migration directory is reported, not treated as success");

  for (const line of failed) console.log(`  FAIL  ${line}`);
  console.log(`MIGRATION PROBES: ${passed} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}

if (process.argv.includes("--self-test")) await selfTest();
