#!/usr/bin/env node
/**
 * Integrations doctor (2026-10-29) - the owner's one-command readiness check for
 * Google Docs and Microsoft Word. Offline and safe: it NEVER calls a provider,
 * never prints a secret, and never claims a connection works just because a
 * client ID exists. That distinction is the whole point (see the final report:
 * recon of credentials is not verification of a live account).
 *
 * Usage:
 *   node scripts/integrations-doctor.mjs            (reads process.env)
 *   node scripts/integrations-doctor.mjs --env-file .env.local
 *   node scripts/integrations-doctor.mjs --self-test
 */
import fs from "node:fs";

const REQUIRED = {
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  microsoft: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
};
const CALLBACK = {
  google: "/api/integrations/google/callback",
  microsoft: "/api/integrations/microsoft/callback",
};

function loadEnvFile(path, env) {
  if (!path || !fs.existsSync(path)) return false;
  for (const line of fs.readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return true;
}

export function buildReport(env) {
  const site = (env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const rows = [];
  for (const [provider, keys] of Object.entries(REQUIRED)) {
    const missing = keys.filter((k) => !env[k]);
    const configured = missing.length === 0;
    rows.push({
      provider,
      configured,
      // Deliberately separate: credentials present != account connected != verified.
      accountConnected: "unknown - connect in the app",
      status: configured ? "READY TO CONNECT" : "NOT CONFIGURED",
      callback: site ? `${site}${CALLBACK[provider]}` : `${CALLBACK[provider]} (site URL unknown)`,
      next: configured
        ? `Register the redirect URI above, then connect ${provider} once in Integrations and complete one real edit to verify write access.`
        : `Set ${missing.join(" and ")} in the hosting environment (never in source), then redeploy.`,
    });
  }
  return { siteUrlKnown: Boolean(site), rows };
}

export function selfTest() {
  const empty = buildReport({});
  const ok = [];
  const bad = [];
  const check = (cond, msg) => (cond ? ok : bad).push(msg);
  check(empty.rows.every((r) => !r.configured), "no credentials -> nothing claims to be configured");
  check(empty.rows.every((r) => r.status === "NOT CONFIGURED"), "status stays honest without credentials");
  check(empty.rows.every((r) => r.accountConnected.startsWith("unknown")), "credentials never imply a connected account");
  check(empty.rows.every((r) => /Set GOOGLE_CLIENT_ID|Set MICROSOFT_CLIENT_ID/.test(r.next)), "each row names the exact missing variable");
  const full = buildReport({
    GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "x",
    MICROSOFT_CLIENT_ID: "x", MICROSOFT_CLIENT_SECRET: "x",
    NEXT_PUBLIC_SITE_URL: "https://sophira.vercel.app",
  });
  check(full.rows.every((r) => r.configured && r.status === "READY TO CONNECT"), "full credentials -> READY TO CONNECT, not 'verified'");
  check(full.rows[0].callback === "https://sophira.vercel.app/api/integrations/google/callback", "Google callback URL is built correctly");
  check(full.rows.every((r) => r.accountConnected.startsWith("unknown")), "even with credentials, connection state is not invented");
  const text = JSON.stringify(full) + JSON.stringify(empty);
  check(!/access_token|refresh_token|Bearer/i.test(text), "no token-shaped field appears in the report");
  return { ok, bad };
}

const isMain = process.argv[1] && process.argv[1].endsWith("integrations-doctor.mjs");
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    const { ok, bad } = selfTest();
    ok.forEach((m) => console.log("ok -", m));
    bad.forEach((m) => console.log("FAIL -", m));
    console.log(`\nself-test: ${ok.length} passed, ${bad.length} failed`);
    process.exit(bad.length ? 1 : 0);
  }
  const envFile = args[args.indexOf("--env-file") + 1];
  const env = { ...process.env };
  const usedFile = args.includes("--env-file") && loadEnvFile(envFile, env);
  const { rows } = buildReport(env);
  console.log("Sophira integrations readiness\n");
  for (const r of rows) console.log(`[${r.status}] ${r.provider}\n  account: ${r.accountConnected}\n  redirect URI: ${r.callback}\n  next: ${r.next}\n`);
  console.log("Reminder: a configured client ID is NOT a working integration. Connect the account in Sophira and perform one real edit before calling it verified.");
  if (usedFile) console.log(`(read from ${envFile})`);
  process.exit(rows.every((r) => r.configured) ? 0 : 1);
}
