#!/usr/bin/env node
/**
 * RUNTIME SMOKE TEST (Stage 5 follow-up, 2026-11-02).
 *
 * Why this exists: every other check in this repo inspects source or a build
 * artifact. None of them start the server. A page can compile and still render an
 * error boundary, a blank screen, or a redirect loop, which is precisely the failure
 * that only ever shows up after deployment.
 *
 * This starts the production build, requests real URLs, and asserts on what came
 * back. It needs no credentials: it checks the public surface and the fail-closed
 * behaviour of protected routes.
 *
 * Usage: node scripts/smoke-runtime.mjs [port]
 */
import { spawn } from "child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "timers/promises";

const PORT = Number(process.argv[2] || process.env.SMOKE_PORT || 3311);
const BASE = `http://127.0.0.1:${PORT}`;

const PUBLIC_PAGES = [
  { path: "/login", expect: "sign", title: "Sophira" },
  { path: "/signup", expect: "account", title: "Sophira" },
  { path: "/privacy", expect: "privacy", title: "Sophira" },
  // The owner's first screen. It must explain itself, not just render.
  { path: "/setup", expect: "what sophira checks", title: "Sophira" },
  // Added 2026-11-03: these four also render without a session (probed against the built app),
  // so they were simply untested. Each now gets the response, heading and content checks.
  { path: "/terms", expect: "terms", title: "Sophira" },
  { path: "/reset-password", expect: "password", title: "Sophira" },
  { path: "/install", expect: "install", title: "Sophira" },
  { path: "/create-owner", expect: "owner", title: "Sophira" },
];
const PROTECTED = ["/dashboard", "/courses", "/settings", "/writing/review"];

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const get = async (path) => {
  const res = await fetch(BASE + path, { redirect: "manual" });
  const body = res.status === 200 ? await res.text() : "";
  return { status: res.status, body, headers: res.headers, location: res.headers.get("location") || "" };
};

// Refuse to run against a server this script did not start. A leftover process on the port
// answers happily and the suite then grades an OLD build, which is a false PASS (it happened
// on 2026-11-03: two fixed pages still showed the pre-fix HTML).
try {
  const probe = await fetch(BASE, { redirect: "manual" });
  if (probe.status > 0) {
    console.error(`SMOKE: something is already listening on ${BASE}.`);
    console.error("Stop it or pass another port: SMOKE_PORT=3400 npm run smoke:runtime");
    process.exit(1);
  }
} catch { /* nothing listening, which is what we want */ }

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
  detached: false,
});

let log = "";
server.stdout.on("data", (d) => (log += d.toString()));
server.stderr.on("data", (d) => (log += d.toString()));

const shutdown = () => {
  try { server.kill("SIGTERM"); } catch { /* already gone */ }
};

let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  await sleep(500);
  try {
    const res = await fetch(BASE + "/login", { redirect: "manual" });
    ready = res.status > 0;
  } catch { /* not listening yet */ }
}

if (!ready) {
  console.error("SMOKE: server never became reachable");
  console.error(log.split("\n").slice(-12).join("\n"));
  shutdown();
  process.exit(1);
}

console.log(`\nruntime smoke test against ${BASE}\n`);

// Security headers (2026-11-03). The app previously sent none; a regression here is invisible
// until it is exploited, so it is asserted on the same response the page checks use.
{
  const r = await get("/login");
  const want = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
  };
  for (const [name, value] of Object.entries(want)) {
    const got = r.headers.get(name);
    record(`header ${name}`, got === value, `${name}=${got ?? "(missing)"}`);
  }
  const perms = r.headers.get("permissions-policy") ?? "";
  record("header permissions-policy disables camera and microphone",
    perms.includes("camera=()") && perms.includes("microphone=()"), perms || "(missing)");
}

// Nothing may be public by accident (2026-11-03). Every page route in the build is probed
// signed-out; a 200 is only allowed for the routes listed here, each of which is public on
// purpose. Adding a route that forgets its auth check now fails the suite instead of quietly
// exposing a page. Dynamic segments are probed with a placeholder and only need to not be 200.
const PUBLIC_ROUTES = new Set([
  "/create-owner", // first-run owner claim; gated by its own logic, not by a session
  "/downloads",    // release downloads; reads only the public GitHub API
  "/install", "/license", "/login", "/privacy", "/reset-password", "/setup", "/signup", "/terms",
]);
{
  const manifest = JSON.parse(
    readFileSync(new URL("../.next/server/app-paths-manifest.json", import.meta.url), "utf8"));
  const routes = Object.keys(manifest)
    .map((k) => k.replace(/\/page$/, ""))
    .filter((r) => !r.startsWith("/api"));
  const offenders = [];
  let probed = 0;
  for (const r of routes) {
    const url = (r === "/" ? "/" : r).replace(/\[[^\]]+\]/g, "smoke-probe");
    const res = await fetch(BASE + url, { redirect: "manual" });
    probed++;
    if (res.status === 200 && !PUBLIC_ROUTES.has(r)) offenders.push(`${r} answered 200 signed-out`);
  }
  record(`no route outside the public allowlist answers 200 signed-out (${probed} probed)`,
    offenders.length === 0, offenders.join("; ") || "none");
}

for (const page of PUBLIC_PAGES) {
  const r = await get(page.path);
  record(`${page.path} responds 200`, r.status === 200, `status ${r.status}`);
  record(`${page.path} renders content`, r.body.length > 2000, `${r.body.length} bytes`);
  record(`${page.path} has a title`, /<title>[^<]*Sophira/i.test(r.body), "title tag");
  record(`${page.path} did not hit the error boundary`, !r.body.includes("Something went wrong"), "");
  record(`${page.path} mentions its own subject`, r.body.toLowerCase().includes(page.expect), page.expect);
  // Heading structure (directive 5.7): a rendered page needs exactly one h1, and it must say
  // something. Checked on the real HTML because a page can delegate its title to a component,
  // which a source grep cannot see - five pages looked headerless and were not.
  const h1s = [...r.body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
  record(`${page.path} has exactly one h1`, h1s.length === 1, `${h1s.length} found`);
  record(`${page.path} h1 is not empty`, h1s.every((t) => t.length > 2), h1s[0]?.slice(0, 40) ?? "none");
}

for (const path of PROTECTED) {
  const r = await get(path);
  const redirected = r.status === 307 || r.status === 302 || r.status === 303;
  record(`${path} fails closed when signed out`, redirected, `status ${r.status}`);
  record(`${path} redirects to a sign-in route`, /login|local/.test(r.location), r.location || "no location");
}

// An unknown URL must never render an authenticated shell to a signed-out visitor.
const unknown = await get("/this-page-does-not-exist-9f3a");
record("unknown URL fails closed", [302, 303, 307, 404].includes(unknown.status), `status ${unknown.status}`);

// A real stylesheet must be served, otherwise pages "work" but look broken.
const login = await get("/login");
const cssHref = (login.body.match(/href="(\/_next\/static\/css\/[^"]+)"/) || [])[1];
if (cssHref) {
  const css = await fetch(BASE + cssHref);
  const text = await css.text();
  record("stylesheet is served", css.status === 200 && text.length > 1000, `${text.length} bytes`);
  record("stylesheet carries theme tokens", /--(?:accent|paper|ink)/.test(text), "design tokens present");
} else {
  record("stylesheet is linked", false, "no CSS link found in HTML");
}

const failed = results.filter((r) => !r.ok);
console.log(`\nSMOKE ${failed.length === 0 ? "PASS" : "FAIL"}: ${results.length - failed.length}/${results.length} checks`);
shutdown();
await sleep(300);
process.exit(failed.length === 0 ? 0 : 1);
