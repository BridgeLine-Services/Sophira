/**
 * OWNER SYSTEM HEALTH (phase 6, 2026-10-11): the release gate's result must
 * reach the nontechnical owner in plain English — grouped by prerequisite,
 * with exact owner actions — while NEVER softening a real status. The
 * verdict is READY only when every check genuinely passed.
 */
import { translateChecks, verdictFor, type GateCheck } from "../src/lib/owner/gate-translate";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";

export function runOwnerSystemHealthTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("owner system health (release gate in plain English)");

  // ---- pure translation logic ----
  const base: GateCheck[] = [
    { id: 1, name: "Type checking passes", status: "PASS", detail: "tsc clean" },
    { id: 2, name: "AI provider configured", status: "BLOCKED", detail: "no AI provider configured; GEMINI_API_KEY is the free path" },
    { id: 3, name: "Security tests pass", status: "BLOCKED", detail: "SUPABASE_TEST_URL and SUPABASE_TEST_ANON_KEY are not configured" },
    { id: 4, name: "APK tested on physical Android device", status: "NOT RUN", detail: "requires release APK and real deployment URL" },
    { id: 5, name: "Secret scan passes", status: "FAIL", detail: "found a test fixture" },
  ];
  const t = translateChecks(base);
  assert(t.length === 5, "health: every gate check is translated, none dropped");
  assert(t[0].displayState === "Ready" && t[0].ownerAction === "", "health: a PASS check reads as Ready with nothing asked of the owner");
  assert(t[1].group === "AI connection" && t[1].ownerAction.length > 10 && t[1].plain.length > 10,
    "health: the AI blocker gets a plain-English meaning, a reason, and an exact owner action");
  assert(t[2].group === "One-time test environment",
    "health: the security-matrix blocker is grouped under its single shared prerequisite");
  assert(t[1].group !== t[2].group, "health: different prerequisites land in different groups (no misleading merge)");
  assert(t.every((c) => c.status === base[c.id - 1].status),
    "health: translation NEVER changes a check's real status (BLOCKED stays BLOCKED)");
  assert(t[4].displayState === "Failed" && t[4].group === "Other checks",
    "health: an unmatched failed check still gets an honest fallback group and label");

  const v = verdictFor(t);
  assert(v.verdict === "NOT READY", "health: any BLOCKED or NOT RUN check forces NOT READY — never softened");
  const allPass = translateChecks(base.map((c) => ({ ...c, status: "PASS" as const })));
  assert(verdictFor(allPass).verdict === "READY FOR RELEASE",
    "health: READY FOR RELEASE only when every single check genuinely passes");
  assert(verdictFor([]).verdict === "NOT READY", "health: zero evidence is never READY");
  assert(v.disclaimer.includes("not a guarantee"),
    "health: the verdict carries the honest disclaimer, not a compliance claim");

  // ---- wiring: owner-only, real gate, no fabrication ----
  const route = readFileSync("src/app/api/owner/system-health/route.ts", "utf8");
  assert(route.includes("requireUser") && route.includes('role !== "owner"') && route.includes("403"),
    "health: the API uses the shared session guard and refuses non-owners server-side (403)");
  assert(route.includes("health-json.mjs") && route.includes("503"),
    "health: the API runs the REAL gate adapter and reports honest unavailability (503) instead of faking a result");

  const adapter = readFileSync("scripts/health-json.mjs", "utf8");
  assert(adapter.includes("release-gate.mjs"),
    "health: the adapter reuses the single authoritative gate — no second gate framework");
  assert(adapter.includes("--fast") && adapter.includes("--report"),
    "health: the owner view runs the gate in fast report mode (no duplicate heavy test runs)");
  assert(adapter.includes("Refusing to invent"),
    "health: the adapter fails loudly when it cannot parse the gate output");

  const shell = readFileSync("src/components/app/AppShell.tsx", "utf8");
  assert(shell.includes("/owner/health"),
    "health: System Health is reachable from the owner navigation");

  const page = readFileSync("src/app/owner/health/page.tsx", "utf8");
  assert(page.includes('redirect("/owner")'),
    "health: a non-owner reaching /owner/health is redirected, never shown owner data");

  // ---- live integration: the adapter must parse the REAL gate output ----
  const out = execFileSync("node", ["scripts/health-json.mjs"], {
    encoding: "utf8",
    timeout: 420000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(out) as { checks: GateCheck[]; counts: { total: number } };
  assert(parsed.checks.length >= 30,
    `health: the adapter parsed ${parsed.checks.length} real checks from the gate report`);
  assert(parsed.checks.every((c) => ["PASS", "FAIL", "BLOCKED", "NOT RUN"].includes(c.status)),
    "health: every parsed status is a real gate status (never invented)");
  const live = translateChecks(parsed.checks);
  assert(verdictFor(live).verdict === "NOT READY",
    "health: in this environment (known owner-side blockers) the live verdict is honestly NOT READY");
}
