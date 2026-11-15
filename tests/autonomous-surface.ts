/**
 * THE SCREEN A STUDENT ACTUALLY REACHES (directive 2026-11-15, Parts 4 and 7).
 *
 * The autonomous runner shipped with a state machine, a lease, routes and a migration — and no
 * screen. A capability a student cannot open is not a capability. These assertions pin the
 * surface itself, and in particular the three lies a run screen is most likely to tell:
 *
 *  1. "Finished" when the server has not said so.
 *  2. A progress bar that fills faster than the stored work.
 *  3. "Working on it" when this deployment has the whole thing switched off.
 *
 * Offline: source pins on the panel and the page, plus the vocabulary the panel is allowed to
 * use. Nothing here touches a database or a network.
 */
import { readFileSync, existsSync } from "node:fs";

export function runAutonomousSurfaceTests(assert: (cond: boolean, msg: string) => void, section: (name: string) => void): void {
  const panelPath = "src/components/app/AutonomousRuns.tsx";
  const pagePath = "src/app/writing/autonomous/page.tsx";
  const panel = readFileSync(panelPath, "utf8");
  const page = readFileSync(pagePath, "utf8");
  const nav = readFileSync("src/lib/navigation/workspace-nav.ts", "utf8");
  const writingIndex = readFileSync("src/app/writing/page.tsx", "utf8");

  section("autonomous runs: the student can reach the runner");

  assert(existsSync(pagePath) && existsSync(panelPath),
    "surface: the runs page and the panel that drives it both exist");
  assert(page.includes("<h1") && page.includes("AppShell"),
    "surface: the page has one h1 inside the app shell, like every other signed-in page");
  assert(page.includes("profile.status === \"revoked\"") && page.includes("/onboarding"),
    "surface: a revoked account is still refused and an unfinished signup is still sent to onboarding");
  assert(nav.includes('href: "/writing/autonomous"'),
    "surface: the runs page is in the workspace navigation, so it is not a page nobody can find");
  assert(writingIndex.includes('href="/writing/autonomous"'),
    "surface: the writing workspace links to it, so the two flows do not drift apart");

  section("autonomous runs: it reports what the server stored, and nothing more");

  assert(panel.includes('fetch("/api/essay/autonomous"') && panel.includes("/advance") && panel.includes("/cancel"),
    "surface: it uses the three existing routes rather than inventing a fourth");
  assert(panel.includes("run.completionClaim"),
    "surface: a finished run shows the server's own completion sentence, not one written in the screen");
  assert(!/['"`](Complete|Done|100% finished)[!'"`]/.test(panel),
    "surface: the screen never writes its own success word for a run");
  assert(panel.includes("run.progress.percent") && panel.includes("run.progress.measured"),
    "surface: the progress bar is fed by measured progress and says when the number is only an estimate");
  assert(panel.includes("aria-valuenow") && panel.includes("role=\"progressbar\""),
    "surface: the bar is a real progressbar for a screen reader, not a decorated div");
  assert(panel.includes("run.findings") && panel.includes("severity === \"limitation\""),
    "surface: anything the runner could not do is shown as a limitation instead of disappearing");
  assert(panel.includes("run.lastError"),
    "surface: a failed step's reason is visible to the student");
  assert(panel.includes("run.continuation.detail"),
    "surface: it says WHERE the work continues (page open, or scheduled) in the server's words");
  assert(panel.includes("run.feasibility.verdict") && panel.includes("remainingSteps"),
    "surface: how much work is left comes from the runner's own estimate");

  section("autonomous runs: switched off reads as switched off");

  assert(panel.includes("enabled === false") && panel.includes("switched off in this deployment"),
    "surface: a deployment with the switch off says so instead of pretending to work");
  assert(panel.includes("manual essay workflow is unchanged"),
    "surface: the same sentence names what still works, so the student is not left stuck");
  assert(panel.includes("json.data?.duplicate"),
    "surface: a repeated click reports that the existing run was kept, instead of implying a second draft");
  assert(panel.includes("does not produce a draft on its own"),
    "surface: starting a run is not described as producing a draft");

  section("autonomous runs: the panel keeps the house rules");

  assert(!/#[0-9a-fA-F]{3,6}\b/.test(panel.replace(/id="[^"]*"/g, "")),
    "surface: no literal colours — the design tokens do the styling");
  assert(!/console\.(log|error|warn)/.test(panel),
    "surface: nothing about a student's assignment is written to a log");
  assert(!/fetch\(["'`]https?:\/\//.test(panel),
    "surface: every call is to this application's own routes, never an outside address");
  // The words below are the ones the platform's plain-language audit refuses.
  const copy = panel.replace(/JSON\.stringify\(/g, "stringify(").replace(/JSON\.parse\(/g, "parse(");
  for (const jargon of ["endpoint", "payload", "schema", "RLS", "Supabase", "JSON", "API"]) {
    assert(!new RegExp(`\\b${jargon}\\b`).test(copy),
      `surface: the panel never says "${jargon}" to a student`);
  }
}
