import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { translateChecks, verdictFor, type GateCheck } from "@/lib/owner/gate-translate";
import { classifyRun, extractGateSummary, REPO_RUNS_URL, REPO_ISSUES_URL, ISSUE_TITLE, type WorkflowRunSummary } from "@/lib/owner/health-actions";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

/**
 * Owner-only System Health API (2026-10-11). Runs the SINGLE authoritative
 * release gate (fast report mode) through the health-json adapter and
 * returns its result translated into plain English. This route can never
 * fabricate a result: it either returns the gate's real parsed checks or
 * an honest 503 "could not run". Server-side owner check; secrets are
 * never returned (the gate reports variable NAMES only).
 */
export async function GET() {
  const supabase = createClient();
  // Shared session guard (requireUser: authenticated -> active), the same
  // server guard every protected route uses; owner-only on top of it.
  const user = await requireUser(supabase);
  const { profile } = await readProfileWithRepair(supabase, user.id);
  if (!profile || profile.role !== "owner") {
    return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  }
  try {
    const { stdout } = await execFileAsync("node", ["scripts/health-json.mjs"], {
      timeout: 300000,
      maxBuffer: 32 * 1024 * 1024,
      cwd: process.cwd(),
    });
    const parsed = JSON.parse(stdout) as { generated_at: string; checks: GateCheck[] };
    const checks = translateChecks(parsed.checks);
    const verdict = verdictFor(checks);
    return NextResponse.json({
      ok: true,
      source: "live gate run (fast report mode)",
      generated_at: parsed.generated_at,
      verdict: verdict.verdict,
      reason: verdict.reason,
      disclaimer: verdict.disclaimer,
      counts: verdict.counts,
      checks,
    });
  } catch {
    // The app host cannot run the local gate (the gate script and its
    // dependencies are not packaged into the serverless deployment). This is
    // a real limitation, never a fabricated pass. The honest fallback: the
    // REAL result of the authoritative GitHub Actions health workflow.
    // A missing, queued, in-progress, or failed run is NEVER treated as a
    // pass; a successful run only means the checks RAN - the release verdict
    // is the gate's own TOTAL line, recovered from the pinned issue.
    try {
      const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
      const ghToken = process.env.GITHUB_HEALTH_TOKEN; // optional; reading a public repo needs no token
      if (ghToken) headers.Authorization = `Bearer ${ghToken}`;
      const runsRes = await fetch(REPO_RUNS_URL, { headers, cache: "no-store" });
      if (!runsRes.ok) throw new Error(`runs ${runsRes.status}`);
      const runs = (await runsRes.json()) as { workflow_runs: WorkflowRunSummary[] };
      const run = runs.workflow_runs?.[0] ?? null;
      let gate_summary: string | null = null;
      const issuesRes = await fetch(REPO_ISSUES_URL, { headers, cache: "no-store" });
      if (issuesRes.ok) {
        const issues = (await issuesRes.json()) as { title: string; body: string | null; number: number }[];
        const pinned = issues.find((i) => i.title === ISSUE_TITLE);
        if (pinned) {
          gate_summary = extractGateSummary(pinned.body);
          if (!gate_summary) {
            const cRes = await fetch(
              `https://api.github.com/repos/BridgeLine-Services/Sophira/issues/${pinned.number}/comments?per_page=100`,
              { headers, cache: "no-store" },
            );
            if (cRes.ok) {
              const comments = (await cRes.json()) as { body: string }[];
              for (let i = comments.length - 1; i >= 0; i -= 1) {
                gate_summary = extractGateSummary(comments[i].body);
                if (gate_summary) break;
              }
            }
          }
        }
      }
      return NextResponse.json({
        ok: true,
        source: "github-actions",
        run_state: classifyRun(run, Date.now()),
        run_url: run?.html_url ?? null,
        run_updated_at: run?.updated_at ?? null,
        head_sha: run?.head_sha ?? null,
        gate_summary,
        note: "The full release suite runs in GitHub Actions, not on this server. The states below are the REAL workflow result. A successful run means the checks ran; the release verdict is the gate's own TOTAL line, which stays honest about every blocked item.",
      });
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error:
            "The release checks cannot run inside the app hosting environment, and the latest GitHub Actions result could not be retrieved right now. This is a real failure, not a pass. The weekly automatic checkup (every Monday 06:00 UTC) posts results to the repository, or start one yourself at https://github.com/BridgeLine-Services/Sophira/actions/workflows/health.yml (choose Run workflow).",
        },
        { status: 503 },
      );
    }
  }
}

/**
 * POST: owner-authorized start of the SINGLE health workflow via the
 * documented workflow-dispatch API. The token stays server-side
 * (GITHUB_HEALTH_TOKEN); ordinary users can never trigger it. Acceptance
 * is reported as acceptance - it is never conflated with a passed check.
 */
export async function POST() {
  const supabase = createClient();
  const user = await requireUser(supabase);
  const { profile } = await readProfileWithRepair(supabase, user.id);
  if (!profile || profile.role !== "owner") {
    return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  }
  const ghToken = process.env.GITHUB_HEALTH_TOKEN;
  if (!ghToken) {
    return NextResponse.json(
      {
        ok: false,
        missing: "GITHUB_HEALTH_TOKEN",
        error:
          "This deployment cannot start the check itself yet: the server-side secret GITHUB_HEALTH_TOKEN (a fine-grained GitHub token with Actions: write, limited to this repository) is not configured. Add it in your hosting provider's environment settings - never in chat or a file - or start the run manually at https://github.com/BridgeLine-Services/Sophira/actions/workflows/health.yml (choose Run workflow).",
      },
      { status: 503 },
    );
  }
  try {
    const res = await fetch(
      "https://api.github.com/repos/BridgeLine-Services/Sophira/actions/workflows/health.yml/dispatches",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json" },
        body: JSON.stringify({ ref: "master" }),
        cache: "no-store",
      },
    );
    if (res.status !== 204) {
      return NextResponse.json(
        { ok: false, error: `GitHub did not accept the workflow dispatch (HTTP ${res.status}). This is a real failure, not a pass.` },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      accepted: true,
      note: "GitHub accepted the run. Accepted is not passed: the real result appears when the run finishes (a few minutes). Press Check again, or use the run link.",
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "The dispatch request to GitHub failed. This is a real failure, not a pass." },
      { status: 502 },
    );
  }
}
