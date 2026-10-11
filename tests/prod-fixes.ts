/**
 * PRODUCTION FIXES (2026-10-11): owner navigation from /owner/health, the
 * IndexedDB out-of-line-key failure, and System Health honesty in the
 * deployed architecture.
 */
import { readFileSync } from "fs";

export function runProdFixTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("production fixes (owner nav, offline keys, deployment honesty)");

  const shell = readFileSync("src/components/app/AppShell.tsx", "utf8");
  assert(!shell.includes('href: "#'),
    "nav: no hash-only owner links remain (a hash-only href resolves against the CURRENT route, which is why they did nothing on /owner/health)");
  for (const href of ["/owner#overview", "/owner#requests", "/owner#invite", "/owner#members"]) {
    assert(shell.includes(`{ href: "${href}",`),
      `nav: ${href} navigates to the Owner Dashboard route FIRST, then applies the hash`);
  }
  assert(shell.includes('{ href: "/online", label: "Online status", icon: Wifi }'),
    "nav: the Online link opens the real /online page from the owner navigation");
  assert(shell.includes('href.includes("#")'),
    "nav: active styling is route-aware; a section link is never marked active from another page");

  const backend = readFileSync("src/lib/offline/backend.ts", "utf8");
  assert(!/\.put\(\w+\)\)/.test(backend),
    "offline: no keyless put() remains on the out-of-line kv store (the exact production error: the store uses out-of-line keys and has no key generator)");
  assert(/\.put\(value,\s*\w+\)/.test(backend),
    "offline: every kv write now supplies the record key explicitly, preserving all existing stored records (no schema reset, no data loss)");

  const dash = readFileSync("src/components/app/OwnerDashboard.tsx", "utf8");
  assert(dash.includes("hashchange") && dash.includes("scrollIntoView"),
    "nav: arriving at /owner#members (and refresh + back/forward) scrolls to the section instead of silently landing at the top");
  for (const id of ['id="overview"', 'id="requests"', 'id="invite"', 'id="members"']) {
    assert(dash.includes(id), `nav: the ${id} anchor target exists (a hash link without its anchor is a silent no-op)`);
  }

  const route = readFileSync("src/app/api/owner/system-health/route.ts", "utf8");
  assert(route.includes("actions/workflows/health.yml"),
    "health: when the server cannot run the gate itself, the response gives the owner the real workflow instead of a dead end");
  const panel = readFileSync("src/components/app/SystemHealthPanel.tsx", "utf8");
  assert(panel.includes("actions/workflows/health.yml"),
    "health: the panel surfaces the real checkup link in the unavailable state");
}
