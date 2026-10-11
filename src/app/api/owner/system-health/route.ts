import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { translateChecks, verdictFor, type GateCheck } from "@/lib/owner/gate-translate";

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
    return NextResponse.json(
      {
        ok: false,
        error:
          "The release checks cannot run inside the app hosting environment (it does not allow running the full local check suite there). This is a real limitation, not a pass. Two honest ways to get the real check: the weekly automatic checkup (every Monday 06:00 UTC) posts results to the repository, or start one yourself at https://github.com/BridgeLine-Services/Sophira/actions/workflows/health.yml (choose Run workflow). The same checks also run on every code change in continuous integration.",
      },
      { status: 503 },
    );
  }
}
