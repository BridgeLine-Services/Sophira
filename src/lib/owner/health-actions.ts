/**
 * OWNER SYSTEM HEALTH - GITHUB ACTIONS RESULTS (2026-10-11, priority 3).
 *
 * Pure helpers for the deployed System Health experience: the app host
 * cannot run the full local gate, so the page shows the REAL result of the
 * authoritative GitHub Actions health workflow instead. A run that is
 * queued, in progress, failed, or missing is NEVER treated as a pass; a
 * successful run only means the checks RAN - the release verdict is the
 * gate's own TOTAL line, recovered from the pinned issue.
 */

export interface WorkflowRunSummary {
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  head_sha: string;
}

export type RunState = "never-run" | "running" | "completed" | "failed" | "stale" | "unknown";

/** The single authoritative health workflow (no other workflow is ever triggered). */
export const REPO_RUNS_URL =
  "https://api.github.com/repos/BridgeLine-Services/Sophira/actions/workflows/health.yml/runs?per_page=1";
export const REPO_ISSUES_URL = "https://api.github.com/repos/BridgeLine-Services/Sophira/issues?state=all&per_page=100";
export const ISSUE_TITLE = "Sophira health check needs your attention";

const STALE_MS = 8 * 24 * 60 * 60 * 1000; // weekly cadence -> older than 8 days is stale

export function classifyRun(run: WorkflowRunSummary | null, nowMs: number): RunState {
  if (!run) return "never-run";
  if (run.status !== "completed") return "running";
  const finished = Date.parse(run.updated_at);
  if (!Number.isFinite(finished)) return "unknown";
  if (run.conclusion === "success") {
    return nowMs - finished > STALE_MS ? "stale" : "completed";
  }
  if (run.conclusion) return "failed";
  return "unknown";
}

/** Extract the gate's own TOTAL line from issue text. Returns null when absent - never invented. */
export function extractGateSummary(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/TOTAL:\s*\d+\s+PASS:\s*\d+\s+FAIL:\s*\d+\s+BLOCKED:\s*\d+\s+NOT RUN:\s*\d+/);
  return m ? m[0] : null;
}
