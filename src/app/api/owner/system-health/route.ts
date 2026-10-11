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
          "The release checks could not run in this environment. This is a real failure, not a pass. The same checks run in the project's continuous integration, where full evidence is produced.",
      },
      { status: 503 },
    );
  }
}
