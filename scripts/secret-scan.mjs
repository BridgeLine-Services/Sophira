#!/usr/bin/env node
/**
 * Secret scan — CLIENT BUNDLE (2026-10-06).
 *
 * Scans built client artifacts for provider/service secret NAMES. The server
 * may reference process.env.GEMINI_API_KEY etc. (server bundles never ship
 * to browsers), but a client chunk, the service worker, or a Capacitor
 * asset bundle containing one of these names is a leak by construction:
 * everything in those directories ships to every user's device.
 *
 * Scan targets (whichever exist):
 *   .next/static/**             — Next.js client chunks (web PWA)
 *   public/**                   — service worker, manifest, icons
 *   android/app/src/main/assets/** — Capacitor ships the client build
 *   ios/App/App/public/**       — iOS Capacitor assets
 *   build/**                    — Tauri frontend bundle
 *
 * Usage:
 *   node scripts/secret-scan.mjs                 — scan
 *   node scripts/secret-scan.mjs --dir <path>    — scan a specific directory
 *   node scripts/secret-scan.mjs --self-test    — fixture self-test
 * Exit 0 = clean, 1 = leak found (or invalid usage).
 */

import { readdirSync, statSync, readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const SECRET_NAMES = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "SEARCH_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const DEFAULT_DIRS = [
  ".next/static",
  "public",
  "android/app/src/main/assets",
  "ios/App/App/public",
  "build",
];

const TEXT_EXT = /\.(js|mjs|cjs|html|css|json|txt|map|webmanifest)$/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (TEXT_EXT.test(name) || name.endsWith(".wasm")) out.push(p);
  }
  return out;
}

export function scanDir(dir) {
  const findings = [];
  for (const file of walk(dir)) {
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const secret of SECRET_NAMES) {
      // word-boundary match on the secret NAME (value leakage is impossible
      // to detect generically; name leakage proves the value can be read).
      const re = new RegExp(`(?<![A-Za-z0-9_])${secret}(?![A-Za-z0-9_])`);
      const idx = content.search(re);
      if (idx >= 0) {
        const line = content.slice(Math.max(0, idx - 60), idx + secret.length + 40).replace(/\s+/g, " ");
        findings.push({ file, secret, context: line });
      }
    }
  }
  return findings;
}

export function scanAll(dirs = DEFAULT_DIRS) {
  const findings = [];
  const scanned = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    scanned.push(d);
    findings.push(...scanDir(d));
  }
  return { findings, scanned };
}

/* ------------------------------ CLI ------------------------------ */

function selfTest() {
  const tmp = join(process.cwd(), ".tmp-scan-selftest");
  rmSync(tmp, { recursive: true, force: true });
  // clean tree: must produce NO findings
  mkdirSync(join(tmp, "clean"), { recursive: true });
  writeFileSync(join(tmp, "clean", "app.js"), 'console.log("ok");');
  writeFileSync(join(tmp, "clean", "adjacent.js"), "const x = MY_GEMINI_API_KEY_PLACEHOLDER; // adjacent-name hygiene");
  const clean = scanDir(join(tmp, "clean"));
  // leak tree: must catch the exact secret name
  mkdirSync(join(tmp, "leak"), { recursive: true });
  writeFileSync(join(tmp, "leak", "chunk.js"), 'const k = process.env.GEMINI_API_KEY;');
  const leak = scanDir(join(tmp, "leak"));
  rmSync(tmp, { recursive: true, force: true });
  const sawLeak = leak.some((f) => f.secret === "GEMINI_API_KEY");
  const falsePositive = clean.length > 0;
  const pass = sawLeak && !falsePositive;
  console.log(pass ? "secret-scan self-test: PASS" : "secret-scan self-test: FAIL");
  process.exit(pass ? 0 : 1);
}

const arg = process.argv[2];
if (arg === "--self-test") {
  selfTest();
} else if (arg === "--dir") {
  const d = process.argv[3];
  if (!d) {
    console.error("usage: node scripts/secret-scan.mjs --dir <path>");
    process.exit(1);
  }
  const findings = scanDir(d);
  for (const f of findings) console.error(`LEAK: ${f.secret} in ${f.file} — …${f.context}…`);
  process.exit(findings.length ? 1 : 0);
} else {
  const { findings, scanned } = scanAll();
  if (findings.length === 0) {
    console.log(`secret-scan: CLEAN (${scanned.length} client artifact dir(s) scanned, ${SECRET_NAMES.length} secret names checked)`);
    process.exit(0);
  }
  for (const f of findings) console.error(`LEAK: ${f.secret} in ${f.file} — …${f.context}…`);
  console.error(`secret-scan: ${findings.length} leak(s) found — FAIL (client bundles must never reference secret names)`);
  process.exit(1);
}
