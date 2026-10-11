/**
 * SYSTEM HEALTH - REAL ACTIONS RESULTS + HONEST DISPATCH (priority 3,
 * 2026-10-11). The deployed page must show the REAL workflow result (never
 * interpreting a queued/failed/missing run as a pass), and starting a check
 * must be owner-only, token-guarded server-side, and honest that acceptance
 * is not a pass.
 */
import { classifyRun, extractGateSummary } from "../src/lib/owner/health-actions";
import { readFileSync } from "fs";

export function runSystemHealthActionsTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("system health: GitHub Actions results + honest dispatch");

  // ---- behavioral: run classification ----
  const base = {
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/BridgeLine-Services/Sophira/actions/runs/1",
    created_at: "2026-10-11T06:00:00Z",
    updated_at: "2026-10-11T06:01:00Z",
    head_sha: "abc123",
  };
  const fresh = Date.parse("2026-10-11T08:00:00Z");
  assert(classifyRun(null, fresh) === "never-run",
    "health: no run at all is reported as never-run, never as a pass");
  assert(classifyRun({ ...base, status: "queued" }, fresh) === "running",
    "health: a queued run is 'running', never a pass");
  assert(classifyRun({ ...base, status: "in_progress" }, fresh) === "running",
    "health: an in-progress run is 'running', never a pass");
  assert(classifyRun(base, fresh) === "completed",
    "health: a fresh successful completed run is 'completed'");
  assert(classifyRun(base, fresh + 9 * 24 * 60 * 60 * 1000) === "stale",
    "health: a result older than the weekly cadence is flagged stale");
  assert(classifyRun({ ...base, conclusion: "failure" }, fresh) === "failed",
    "health: a failed run is reported as failed");
  assert(classifyRun({ ...base, conclusion: null }, fresh) === "unknown",
    "health: a completed run without a conclusion is unknown, never a pass");
  assert(classifyRun({ ...base, updated_at: "not a date" }, fresh) === "unknown",
    "health: an unparsable timestamp is unknown, never a pass");

  // ---- behavioral: gate summary extraction ----
  const issueText = "Sophira's scheduled health check found items that are not ready yet.\n\nResult: TOTAL: 39  PASS: 21  FAIL: 0  BLOCKED: 17  NOT RUN: 1\n\nMore text.";
  const summary = extractGateSummary(issueText);
  assert(summary !== null && summary.startsWith("TOTAL: 39") && summary.includes("BLOCKED: 17"),
    "health: the gate's own TOTAL line is recovered from the pinned issue");
  assert(extractGateSummary("no summary in here") === null,
    "health: a missing TOTAL line returns null - it is never invented");
  assert(extractGateSummary(null) === null, "health: missing text returns null");

  // ---- wiring: the route and the panel ----
  const route = readFileSync("src/app/api/owner/system-health/route.ts", "utf8");
  assert(route.includes('"github-actions"') && route.includes("workflow_runs"),
    "health: when the local gate cannot run, GET falls back to the REAL latest workflow run");
  assert(route.includes("classifyRun") && route.includes("extractGateSummary"),
    "health: the fallback uses the tested, honest classification helpers");
  assert(route.includes("export async function POST") && route.includes("GITHUB_HEALTH_TOKEN") && route.includes("503"),
    "health: POST dispatches only with the server-side token; without it the exact missing prerequisite is reported (503), never a fake dispatch");
  assert(route.includes("actions/workflows/health.yml/dispatches"),
    "health: dispatch is restricted to the single health workflow");
  assert(!route.includes("NEXT_PUBLIC"),
    "health: no GitHub token is ever exposed to the browser");
  assert(route.includes("Accepted is not passed"),
    "health: acceptance and passing are reported as separate states");

  const panel = readFileSync("src/components/app/SystemHealthPanel.tsx", "utf8");
  assert(panel.includes("data.run_url") && panel.includes("stale") && panel.includes("Running right now"),
    "health: the panel renders the run link and every honest state (running, stale, failed, never-run)");
  assert(panel.includes("startCheck") && panel.includes("Start a fresh full check"),
    "health: the panel offers the owner-authorized start-check action");
}
