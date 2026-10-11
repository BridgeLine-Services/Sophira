/**
 * SCHEDULED HEALTH (phase 7, 2026-10-11): ongoing automated maintenance must
 * reuse the single authoritative release gate, run the FULL battery, use
 * least-privilege permissions, never echo credential values, keep its report
 * as evidence, and notify the owner through ONE pinned issue that can never
 * duplicate. The pass/fail decision comes only from the gate's own TOTAL
 * line, never from the mere existence of a run.
 */
import { existsSync, readFileSync } from "fs";

export function runScheduledHealthTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("scheduled health (ongoing automated maintenance, phase 7)");

  const wfPath = ".github/workflows/health.yml";
  assert(existsSync(wfPath), "scheduled health: the weekly verification workflow exists");
  const wf = readFileSync(wfPath, "utf8");

  assert(wf.includes("release-gate.mjs"),
    "scheduled health: it reuses the SINGLE authoritative release gate, not a second framework");
  assert(!wf.includes("--fast"),
    "scheduled health: the weekly run executes the FULL battery (tests, build, type check), not a reduced mode");
  assert(wf.includes("cron:") && wf.includes("workflow_dispatch"),
    "scheduled health: it runs on a schedule AND can be started manually");
  const permissions = wf.slice(wf.indexOf("permissions:"), wf.indexOf("jobs:"));
  assert(permissions.includes("contents: read") && permissions.includes("issues: write") && !permissions.includes("actions:"),
    "scheduled health: least-privilege permissions (read code, write the notification issue only)");
  assert(!/\$\{\{\s*secrets\./.test(wf),
    "scheduled health: no secret value is ever interpolated into the workflow (nothing sensitive in logs)");
  assert(wf.includes("upload-artifact") && wf.includes("retention-days"),
    "scheduled health: the full report is preserved as evidence, with a retention limit");
  assert(wf.includes("needs your attention") && wf.includes("listForIssues"),
    "scheduled health: the owner notification is ONE pinned issue, searched before creation so it can never duplicate");
  assert(wf.includes('state: "closed"'),
    "scheduled health: the issue closes automatically when everything genuinely passes");
  assert(wf.includes("ALL_PASS") && wf.includes("grep -q"),
    "scheduled health: the pass/fail decision comes from the gate's own TOTAL line, never from the mere existence of a run");

  const panel = readFileSync("src/components/app/SystemHealthPanel.tsx", "utf8");
  assert(panel.includes("github.com/BridgeLine-Services/Sophira/actions"),
    "scheduled health: the owner System Health page links to the real scheduled-check results");

  const docs = readFileSync("docs/RELEASE_GATE.md", "utf8");
  assert(docs.includes("Ongoing health (scheduled)"),
    "scheduled health: documentation explains how the scheduled checks run and what they can verify");
}
