#!/usr/bin/env node
/**
 * Native URL resolution CLI (2026-10-05) — the no-silent-fallback front door
 * for native builds. Mirrors src/lib/native-url.ts (keep both in sync; the
 * TS module is the unit-tested source of truth, this is the shell entry).
 *
 * Usage:
 *   node scripts/native-url.mjs                 — resolve + print (dev mode default)
 *   SOPHIRA_NATIVE_RELEASE=1 node scripts/native-url.mjs
 *                                               — release mode: FAILS without a valid SOPHIRA_APP_URL
 *   node scripts/native-url.mjs --write-tauri   — also patch src-tauri/tauri.conf.json
 *   node scripts/native-url.mjs --self-test    — verify THIS script's rules
 *
 * Exit codes: 0 resolved (and patched), 1 invalid/missing URL, 2 usage error.
 */

// ---- rules (mirror of src/lib/native-url.ts) ---------------------------
const REMOVED_FALLBACK_URL = "https://sophira.example.com";
const PLACEHOLDER_PATTERNS = [
  /^sophira\.example\.com$/i,
  /(^|\.)example\.(com|org|net)$/i,
  /your-[-a-z0-9]*domain/i,
  /your-sophira-domain/i,
  /(^|\.)(placeholder|changeme|replace-me)/i,
];

function validate(raw, mode) {
  const errors = [];
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, url: null, errors: ["SOPHIRA_APP_URL is empty"] };
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, url: null, errors: [`"${trimmed}" is not a valid URL`] };
  }
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(u.hostname))) {
    errors.push(`"${u.toString()}" is a placeholder URL — set the real SOPHIRA_APP_URL deployment URL`);
  }
  if (mode === "release") {
    if (u.protocol !== "https:") errors.push(`the URL must use https (got "${u.protocol}")`);
    if (/^localhost$|127\.0\.0\.1|0\.0\.0\.0|::1/.test(u.hostname)) errors.push("a release build cannot point at localhost");
  } else if (u.protocol !== "https:" && u.protocol !== "http:") {
    errors.push(`the URL must use http or https (got "${u.protocol}")`);
  }
  if (u.username || u.password) errors.push("the URL must not contain credentials");
  if (!u.hostname) errors.push("the URL has no hostname");
  if (errors.length) return { ok: false, url: null, errors };
  return { ok: true, url: u.toString().replace(/\/+$/, ""), errors: [] };
}

function isRelease(env) {
  return env.SOPHIRA_NATIVE_RELEASE === "1" || env.SOPHIRA_NATIVE_RELEASE === "true";
}

function resolve(env) {
  const mode = isRelease(env) ? "release" : "dev";
  const provided = (env.SOPHIRA_APP_URL ?? "").trim();
  if (provided) {
    const v = validate(provided, mode);
    if (!v.ok) return { ok: false, mode, errors: v.errors };
    return { ok: true, url: v.url, mode, basis: "SOPHIRA_APP_URL", cleartext: false };
  }
  if (mode === "release") {
    return {
      ok: false, mode,
      errors: [
        "SOPHIRA_APP_URL must be defined for a release build — refusing to build.",
        `There is no fallback anymore (the old silent fallback ${REMOVED_FALLBACK_URL} was removed).`,
      ],
    };
  }
  const devCandidate = (env.SOPHIRA_DEV_URL ?? env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").trim();
  const v = validate(devCandidate, "dev");
  if (!v.ok) return { ok: false, mode, errors: ["development URL configuration is invalid: " + v.errors.join("; ")] };
  const isLocal = /^localhost$|127\.0\.0\.1|0\.0\.0\.0|::1/.test(new URL(v.url).hostname);
  return {
    ok: true, url: v.url, mode,
    basis: env.SOPHIRA_DEV_URL ? "SOPHIRA_DEV_URL (development)" : env.NEXT_PUBLIC_SITE_URL ? "NEXT_PUBLIC_SITE_URL (development)" : "http://localhost:3000 (development default)",
    cleartext: isLocal,
  };
}

// ---- self-test ----------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const t = (name, cond) => { if (!cond) { console.error(`SELF-TEST FAILED: ${name}`); process.exit(1); } };
  const rel = { SOPHIRA_NATIVE_RELEASE: "1" };
  t("release without URL → fail", resolve(rel).ok === false);
  t("release with placeholder → fail", resolve({ ...rel, SOPHIRA_APP_URL: "https://sophira.example.com" }).ok === false);
  t("release with any example.com → fail", resolve({ ...rel, SOPHIRA_APP_URL: "https://myapp.example.com" }).ok === false);
  t("release with malformed → fail", resolve({ ...rel, SOPHIRA_APP_URL: "not-a-url" }).ok === false);
  t("release with http → fail", resolve({ ...rel, SOPHIRA_APP_URL: "http://sophira.app" }).ok === false);
  t("release with localhost → fail", resolve({ ...rel, SOPHIRA_APP_URL: "http://localhost:3000" }).ok === false);
  t("release with creds → fail", resolve({ ...rel, SOPHIRA_APP_URL: "https://user:pw@sophira.app" }).ok === false);
  t("release with valid https → ok", resolve({ ...rel, SOPHIRA_APP_URL: "https://sophira.real.app/" }).url === "https://sophira.real.app");
  t("dev without URL → explicit localhost", resolve({}).url === "http://localhost:3000");
  t("dev with provided placeholder → still fail (no silent fallback)", resolve({ SOPHIRA_APP_URL: "https://sophira.example.com" }).ok === false);
  t("dev with NEXT_PUBLIC_SITE_URL → uses it", resolve({ NEXT_PUBLIC_SITE_URL: "http://localhost:5173" }).url === "http://localhost:5173");
  console.log("native-url.mjs self-test passed (11/11)");
  process.exit(0);
}

// ---- resolve / patch ----------------------------------------------------
const writeTauri = process.argv.includes("--write-tauri");
const result = resolve(process.env);
if (!result.ok) {
  console.error(`::error::Native build URL is invalid (${result.mode} build) — refusing to build:\n  - ${result.errors.join("\n  - ")}`);
  process.exit(1);
}
console.log(`[sophira] ${result.mode} build → ${result.url} (${result.basis})`);
if (writeTauri) {
  const fs = await import("node:fs");
  const p = "src-tauri/tauri.conf.json";
  const conf = JSON.parse(fs.readFileSync(p, "utf8"));
  conf.app.windows[0].url = result.url;
  fs.writeFileSync(p, JSON.stringify(conf, null, 2) + "\n");
  console.log(`[sophira] patched ${p} → ${result.url}`);
}
