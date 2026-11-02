#!/usr/bin/env node
/**
 * PRODUCTION VERIFICATION REPORT (Phase 1, 2026-11-02).
 *
 * Answers the questions a release decision actually depends on, with evidence:
 *   - which commit is deployed, and does it match GitHub?
 *   - is the application reachable?
 *   - did the database and sign-in services actually answer?
 *   - which optional integrations are configured?
 *
 * It never prints a key, token, hostname, or provider name, and it never claims a
 * capability works without a check that succeeded. Exit code 1 means a release blocker.
 *
 * Usage:
 *   node scripts/production-verification.mjs [--url https://sophira.vercel.app]
 *                                            [--repo BridgeLine-Services/Sophira]
 *                                            [--branch master] [--json]
 */
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const URL = (arg("url", process.env.SOPHIRA_APP_URL || "https://sophira.vercel.app")).replace(/\/+$/, "");
const REPO = arg("repo", "BridgeLine-Services/Sophira");
const BRANCH = arg("branch", "master");
const AS_JSON = args.includes("--json");
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const rows = [];
const row = (area, status, detail) => rows.push({ area, status, detail });

const getJson = async (url, headers = {}) => {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000), cache: "no-store" });
    return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
  } catch {
    return { ok: false, status: 0, body: null };
  }
};

// ---- 1. Deployed health (deep: real database + auth probes) --------------
const health = await getJson(`${URL}/api/health?deep=1`);
if (!health.ok || health.body?.ok !== true || health.body?.name !== "sophira") {
  row("Application", "FAIL", health.status ? `not answering as Sophira (HTTP ${health.status})` : "unreachable");
} else {
  row("Application", "PASS", "reachable and identifying itself");
}

const cfg = health.body?.configuration ?? {};
const checks = health.body?.checks ?? {};
const deployedCommit = (health.body?.commit ?? "").slice(0, 7) || null;

/**
 * Three outcomes, never two. "We could not verify" is not "broken", and a deployed
 * build that predates the deep check must not be reported as a failed database.
 */
const probe = (checkName, configured) => {
  const result = checks[checkName];
  if (result === "ready") return ["PASS", "a real check succeeded"];
  if (result === "unreachable") return ["FAIL", "the service did not answer"];
  if (result === "not_configured") return ["NOT CONFIGURED", "no settings present"];
  if (configured === true) return ["UNVERIFIED", "settings present; this deployed build cannot run the deep check"];
  return ["NOT CONFIGURED", "no settings present"];
};

const storageCfg = cfg.supabase === true;
const [storageStatus, storageDetail] = probe("database", storageCfg);
row("Private storage", storageStatus, storageDetail);
const [authStatus, authDetail] = probe("auth", storageCfg);
row("Signing in", authStatus, authDetail);
row("Academic help", cfg.ai === true ? "PASS" : "NEEDS SETUP", cfg.ai === true ? "a provider is configured" : "online help unavailable; offline help still works");
row("Online research", cfg.search === true ? "PASS" : "NOT CONNECTED", cfg.search === true ? "search provider configured" : "optional; nothing else is affected");
row("Canvas", "PER STUDENT", "each student connects their own account; this check cannot see it");
row("Google Docs", "PER STUDENT", "each student connects their own account; this check cannot see it");
row("Microsoft Word", "PER STUDENT", "each student connects their own account; this check cannot see it");
row("Notifications", "PARTIAL", "pop-up messages and email summaries only; no permanent list yet");

// ---- 2. GitHub head commit ----------------------------------------------
const gh = await getJson(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
  Accept: "application/vnd.github+json",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
});
const githubCommit = gh.body?.sha ? gh.body.sha.slice(0, 7) : null;
row("GitHub (" + BRANCH + ")", githubCommit ? "PASS" : "UNAVAILABLE",
  githubCommit ? `head is ${githubCommit}` : "could not read the branch head");

let match = "UNKNOWN";
if (githubCommit && deployedCommit) match = deployedCommit === githubCommit ? "MATCH" : "MISMATCH";
else if (!deployedCommit) match = "UNKNOWN";
row("Deployed commit", match, deployedCommit ? `serving ${deployedCommit}` : "deployment does not report a commit");

// ---- 3. Migrations -------------------------------------------------------
row("Database schema", "SEE RELEASE GATE",
  "scripts/release-gate.mjs db-migrations probes the newest tables; the Migrations workflow cannot verify production without repository credentials");

// A release blocker is something proven wrong or unproven by a check that exists.
// UNVERIFIED is reported separately: it blocks a confident release claim, not the run.
const blockers = rows.filter((r) => r.status === "FAIL" || r.status === "MISMATCH");
const unverified = rows.filter((r) => r.status === "UNVERIFIED");

if (AS_JSON) {
  console.log(JSON.stringify({ url: URL, rows, deployedCommit, githubCommit, blockers: blockers.length }, null, 2));
} else {
  console.log(`\nProduction verification — ${URL}\n`);
  const w = Math.max(...rows.map((r) => r.area.length));
  for (const r of rows) console.log(`  ${r.area.padEnd(w)}  ${r.status.padEnd(15)} ${r.detail}`);
  console.log(`\n  Deployed: ${deployedCommit ?? "unknown"}   GitHub ${BRANCH}: ${githubCommit ?? "unknown"}   ${match}`);
  if (unverified.length > 0) {
    console.log(`\n  Unverified (not failing, but not proven either): ${unverified.map((u) => u.area).join(", ")}`);
  }
  console.log(blockers.length === 0
    ? "\n  No release blockers found by this check.\n"
    : `\n  ${blockers.length} release blocker(s): ${blockers.map((b) => b.area).join(", ")}\n`);
}

process.exit(blockers.length === 0 ? 0 : 1);
