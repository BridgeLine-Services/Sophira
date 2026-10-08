#!/usr/bin/env node
/**
 * SOPHIRA DOCTOR — one-command, plain-English setup check (2026-10-07).
 *
 * Prints a ✅/❌ checklist for the owner (a non-programmer): Supabase
 * connected, migrations applied, owner account exists, AI provider working,
 * search provider configured (optional), production URL set. Every ❌ says
 * the exact next step in simple language.
 *
 * SECURITY: this script NEVER prints secret values — only booleans from the
 * public, categorical /api/health and /api/setup-status endpoints (the same
 * ones a browser sees). It accepts --url <site> and reads SOPHIRA_APP_URL /
 * NEXT_PUBLIC_SITE_URL for the default. It exits 1 when anything required
 * is missing, so it can be used in scripts.
 */
import { env } from "node:process";

const args = process.argv.slice(2);
const urlArgIdx = args.indexOf("--url");
const base =
  (urlArgIdx !== -1 ? args[urlArgIdx + 1] : null) ||
  env.SOPHIRA_APP_URL ||
  env.NEXT_PUBLIC_SITE_URL ||
  "https://sophira.vercel.app";
const baseClean = base.replace(/\/+$/, "");

const fail = [];
const pass = (label) => console.log(`✅ ${label}`);
const miss = (label, nextStep) => {
  console.log(`❌ ${label}`);
  console.log(`   → Next step: ${nextStep}`);
  fail.push(label);
};

async function getJson(path) {
  try {
    const r = await fetch(`${baseClean}${path}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { __status: r.status };
    return await r.json();
  } catch (e) {
    return { __error: String(e && e.message ? e.message : e).split("\n")[0] };
  }
}

console.log(`Sophira doctor — checking ${baseClean}\n`);

const health = await getJson("/api/health");
if (health.__error || health.__status || health.ok !== true) {
  miss(
    "The Sophira site answers",
    health.__status
      ? `The site replied with error code ${health.__status}. Open ${baseClean} in a browser — if it does not load, redeploy from the Deployments tab in Vercel, then run this command again.`
      : "The site could not be reached. Check the address with --url <your site address>, and confirm the site loads in a browser.",
  );
  console.log("\nCould not check anything else until the site answers.");
  process.exit(1);
}

const c = health.configuration || {};
c.supabase
  ? pass("Supabase is connected")
  : miss(
      "Supabase is connected",
      "Open Vercel → your Sophira project → Settings → Environment Variables, and make sure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set (copy them from your Supabase project → Settings → API).",
    );

const status = await getJson("/api/setup-status");
const probe = status.probe || {};
const checklist = status.checklist || {};

probe.migrationsPresent === true
  ? pass("Database migrations are applied (0001-0026)")
  : miss(
      "Database migrations are applied (0001-0026)",
      probe.setupChannel === "none"
        ? "Open /setup on your site and read the Advanced diagnostics box — it names the exact missing piece. Usually: connect the Vercel project to your Supabase project (Vercel → your project → Integrations → Supabase), then click 'Set Up Sophira' on /setup."
        : "Open /setup on your site and click 'Set Up Sophira'. It applies every missing migration automatically — no SQL, usually under a minute.",
    );

probe.ownerAccount === "active"
  ? pass("The owner account exists")
  : probe.ownerAccount === "revoked"
    ? miss("The owner account exists", "The owner account was revoked. Contact the developer — revocation is a deliberate security state; it must be reversed deliberately, never automatically.")
    : miss(
        "The owner account exists",
        "Open /create-owner on your site and create the owner account (it needs the database step above to be ✅ first). The FIRST account created there becomes the owner.",
      );

c.ai
  ? pass(`An AI provider is working (${c.ai_selfhost ? "local/self-hosted" : "remote, free-tier preferred"})`)
  : miss(
      "An AI provider is working",
      "Open /setup on the site and follow the AI step: either set GEMINI_API_KEY (free — aistudio.google.com → Get API key) or run a local model server like Ollama (no key). The app also works fully without remote AI.",
    );

if (c.search) pass("A search provider is configured (optional)");
else
  console.log(
    "⚪ Search provider: not configured (OPTIONAL — only needed for live web research; the app says so honestly when it is missing).",
  );

c.site_url
  ? pass("The production URL is set")
  : miss(
      "The production URL is set",
      "Open Vercel → your Sophira project → Settings → Environment Variables, add NEXT_PUBLIC_SITE_URL with your site's address (like https://sophira.vercel.app), then redeploy. This makes invitation links and emails point to the right place.",
    );

console.log(
  fail.length === 0
    ? "\nAll required checks passed — Sophira is fully set up. 🎉"
    : `\n${fail.length} item(s) still need attention. Follow the "Next step" lines above, in order, then run this command again.`,
);
process.exit(fail.length === 0 ? 0 : 1);
