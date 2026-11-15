import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { flagEnabled } from "@/lib/features/flags";
import { continuationMode } from "@/lib/essay/autonomous";
import { advanceRun } from "@/lib/essay/runner";
import { resumableRuns } from "@/lib/essay/run-store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/essay/autonomous/tick — the scheduled sweep.
 *
 * This is the ONLY place a run is advanced without a student's browser, and it exists so a cron
 * (or an external scheduler) can drive progress. It is honest about its own preconditions:
 *
 *   - It refuses unless `CRON_SECRET` is set and the caller presents it. An unauthenticated
 *     public endpoint that generates student work would be indefensible.
 *   - It refuses unless the autonomous flag is on.
 *   - It advances a small, bounded number of runs, one step each: a scheduled tick must not
 *     become an unbounded queue consumer inside one invocation.
 *
 * Without this endpoint being called, runs advance only while a Sophira page is open — and the
 * student's screen says exactly that (`continuationMode`).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({
      error: "No scheduled worker is configured for this deployment, so runs advance only while a Sophira page is open.",
      configured: false,
    }, { status: 503 });
  }
  const provided = request.headers.get("authorization") ?? "";
  if (provided !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  if (!flagEnabled("autonomous_essay")) {
    return NextResponse.json({ ok: true, skipped: "the autonomous essay feature is switched off", advanced: 0 });
  }

  const nowIso = new Date().toISOString();
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "The worker could not reach the database." }, { status: 503 });
  }

  const candidates = await resumableRuns(admin, nowIso, 5);
  const results: { id: string; status: string }[] = [];
  for (const candidate of candidates) {
    // Explicit ownership: the runner filters every read and write on this run's own user_id, so
    // the privileged client never becomes a way to touch another student's work by id alone.
    const outcome = await advanceRun(admin, candidate.user_id, candidate.id);
    results.push({ id: candidate.id, status: outcome.status });
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    continuation: continuationMode(process.env),
    advanced: results.filter((r) => r.status === "advanced").length,
    results,
  });
}

/** GET — what this endpoint is, for an owner who finds the URL in the logs. */
export async function GET() {
  const continuation = continuationMode(process.env);
  return NextResponse.json({
    endpoint: "autonomous assignment sweep",
    configured: Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 16),
    continuation,
    note: "POST with Authorization: Bearer <CRON_SECRET> to advance a few runs by one step each.",
  });
}
