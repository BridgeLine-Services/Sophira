/**
 * PRODUCTION FIXES (2026-10-11): owner navigation from /owner/health, the
 * IndexedDB out-of-line-key failure, and System Health honesty in the
 * deployed architecture.
 */
import { existsSync, readFileSync } from "fs";

export function runProdFixTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("production fixes (owner nav, offline keys, deployment honesty)");

  const shell = readFileSync("src/components/app/AppShell.tsx", "utf8");
  assert(!shell.includes('href: "#'),
    "nav: no hash-only owner links remain (a hash-only href resolves against the CURRENT route, which is why they did nothing on /owner/health)");
  // 2026-11-03 (phase 1): the owner sections became real routes, so no owner nav link may
  // depend on a hash. A hash link only scrolls an existing anchor and silently does nothing
  // when that anchor is gone, which is the defect this file was written for.
  assert(!/\/owner#/.test(shell),
    "nav: no owner nav link uses a hash any more - every destination is its own page");
  for (const route of ["/owner", "/owner/health", "/owner/members", "/owner/invitations",
    "/owner/requests", "/owner/activity", "/owner/status", "/owner/security",
    "/owner/ai-providers", "/owner/integrations"]) {
    assert(shell.includes(`{ href: "${route}",`), `nav: ${route} is a sidebar destination`);
    const file = route === "/owner" ? "src/app/owner/page.tsx" : `src/app${route}/page.tsx`;
    assert(existsSync(file), `nav: ${route} resolves to a real page module (${file})`);
  }
  assert(!shell.includes('label: "Online status"'),
    "nav: no redundant owner-nav Online entry remains (the sidebar connectivity indicator already links to /online; two entries to the same page was the reported defect)");
  assert((shell.match(/href="\/online"/g) ?? []).length === 1,
    "nav: exactly ONE /online entry exists in the shell (the real-time connectivity indicator), opening the real Online page");
  assert(shell.includes('href.includes("#")'),
    "nav: active styling is route-aware; a section link is never marked active from another page");

  const backend = readFileSync("src/lib/offline/backend.ts", "utf8");
  assert(!/\.put\(\w+\)\)/.test(backend),
    "offline: no keyless put() remains on the out-of-line kv store (the exact production error: the store uses out-of-line keys and has no key generator)");
  assert(/\.put\(value,\s*\w+\)/.test(backend),
    "offline: every kv write now supplies the record key explicitly, preserving all existing stored records (no schema reset, no data loss)");

  // The overview keeps one anchor (its own tiles); the other sections are routes now, so a
  // stale anchor cannot be relied on. The dashboard must not scroll-jack to fake them.
  const dash = readFileSync("src/components/app/OwnerDashboard.tsx", "utf8");
  assert(dash.includes('id="overview"'), "nav: the overview anchor still exists for the dashboard link");
  for (const gone of ['id="requests"', 'id="invite"', 'id="members"']) {
    assert(!dash.includes(gone),
      `nav: ${gone} is no longer a dashboard anchor - that section is its own page`);
  }

  const route = readFileSync("src/app/api/owner/system-health/route.ts", "utf8");
  assert(route.includes("actions/workflows/health.yml"),
    "health: when the server cannot run the gate itself, the response gives the owner the real workflow instead of a dead end");
  const panel = readFileSync("src/components/app/SystemHealthPanel.tsx", "utf8");
  assert(panel.includes("actions/workflows/health.yml"),
    "health: the panel surfaces the real checkup link in the unavailable state");
}
