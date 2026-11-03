#!/usr/bin/env node
/**
 * PRODUCTION SMOKE — 2026-11-03.
 *
 * `npm run smoke:runtime` starts a local build and grades that. It cannot grade a deployed site,
 * so production was only ever checked by hand, once, and the result went stale immediately. This
 * script asks the same questions of a live address, which is the only thing that tells you what
 * your users are actually being served.
 *
 * What it can check without credentials: the signed-out gate, public pages, response headers, the
 * cache policy on member routes, and 404/unknown-route handling. What it cannot check: anything
 * behind sign-in. It never reports those as passing.
 *
 * Usage: node scripts/smoke-prod.mjs [https://your-app.example.com]
 * Exit: 0 all checks passed, 1 a check failed, 2 could not reach the site.
 */

const TARGET = (process.argv[2] || process.env.SMOKE_TARGET || "https://sophira.vercel.app").replace(/\/+$/, "");

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const get = async (path) => {
  const res = await fetch(TARGET + path, { redirect: "manual", signal: AbortSignal.timeout(20000) });
  const body = res.status === 200 ? await res.text() : "";
  return { status: res.status, body, headers: res.headers, location: res.headers.get("location") || "" };
};

const isGate = (r) => r.status === 307 || r.status === 302 || r.status === 303;
const goesToLogin = (r) => isGate(r) && /\/login/.test(r.location);

console.log(`SMOKE-PROD ${TARGET}`);

try {
  const probe = await fetch(TARGET, { redirect: "manual", signal: AbortSignal.timeout(20000) });
  if (probe.status === 0) throw new Error("no response");
} catch (e) {
  console.error(`\nSMOKE-PROD: could not reach ${TARGET} (${String(e).slice(0, 90)}). Nothing was checked.`);
  process.exit(2);
}

// A deployed site needs to be the site, not a parked page or an error screen.
const root = await get("/");
record("/ sends a signed-out visitor to /login", goesToLogin(root), `${root.status} ${root.location.slice(0, 60)}`);
record("/ does not serve an error page", root.status !== 500 && root.status !== 502, `status ${root.status}`);

const login = await get("/login");
record("/login answers 200", login.status === 200, `status ${login.status}`);
record("/login renders real content", login.body.length > 2000, `${login.body.length} bytes`);
record("/login has a title", /<title>[^<]*Sophira/i.test(login.body), "title tag");
record("/login did not hit the error boundary", !login.body.includes("Something went wrong"), "");
record("/login has exactly one h1", (login.body.match(/<h1[\s>]/g) ?? []).length === 1, "");
record("/login carries a main landmark", /<main[\s>]|role="main"/.test(login.body), "");

const signup = await get("/signup");
record("/signup answers 200", signup.status === 200, `status ${signup.status}`);
record("/signup mentions creating an account", /account/i.test(signup.body), "");

const robots = await get("/robots.txt");
record("/robots.txt is served", robots.status === 200, `status ${robots.status}`);

// The gate must hold for unknown and child routes too: a 500 there is a real defect, and a 200
// would mean an unauthenticated visitor reached an app page.
for (const path of ["/dashboard", "/notebooks", "/owner", "/api/owner/preservation", "/nope-not-a-route"]) {
  const r = await get(path);
  record(`${path} is behind the gate`, goesToLogin(r) || r.status === 404, `status ${r.status}`);
  record(`${path} does not error`, r.status !== 500, `status ${r.status}`);
}

// Headers that protect every visitor, not only signed-in ones.
const h = login.headers;
record("x-frame-options is DENY", (h.get("x-frame-options") ?? "").toUpperCase().includes("DENY"), h.get("x-frame-options") ?? "absent");
record("x-content-type-options is nosniff", (h.get("x-content-type-options") ?? "").toLowerCase() === "nosniff", h.get("x-content-type-options") ?? "absent");
record("referrer-policy is set", Boolean(h.get("referrer-policy")), h.get("referrer-policy") ?? "absent");
record("permissions-policy restricts capabilities", /camera=\(\)/.test(h.get("permissions-policy") ?? ""), h.get("permissions-policy") ?? "absent");
record("strict-transport-security is set", /max-age=\d{6,}/.test(h.get("strict-transport-security") ?? ""), h.get("strict-transport-security") ?? "absent");

// The cache policy is a privacy control: member JSON must never be shared-cacheable.
const api = await get("/api/owner/preservation");
const apiCache = (api.headers.get("cache-control") ?? "").toLowerCase();
record("/api/* is not shared-cacheable", apiCache.includes("no-store") && apiCache.includes("private"), apiCache || "absent");

const failed = results.filter((r) => !r.ok);
console.log(`\nSMOKE-PROD ${failed.length === 0 ? "PASS" : "FAIL"}: ${results.length - failed.length}/${results.length} checks`);
console.log("Not checked by this script (needs sign-in or credentials): dashboard, member data, the record");
console.log("census against the live database, and every third-party integration.");
process.exit(failed.length === 0 ? 0 : 1);
