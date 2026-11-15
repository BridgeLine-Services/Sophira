import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { cancelRun, runView } from "@/lib/essay/autonomous";
import { loadRun, saveRun } from "@/lib/essay/run-store";

export const runtime = "nodejs";

/**
 * POST /api/essay/autonomous/[id]/cancel — stop a run.
 *
 * Whatever was already drafted stays exactly as it is: cancelling stops work, it does not erase
 * a student's sections. A run that already finished cannot be "cancelled" retroactively, which
 * would falsify the record.
 */
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { id } = await context.params;

  const run = await loadRun(supabase, guard.data.user.id, id);
  if (!run) return NextResponse.json({ error: "That assignment run is not in your list." }, { status: 404 });

  if (run.state === "completed") {
    return NextResponse.json({ error: "This run already finished, so there is nothing to cancel." }, { status: 409 });
  }
  const cancelled = cancelRun(run, Date.now());
  if (cancelled === run) {
    return NextResponse.json({ data: { run: runView(run, Date.now()) } });
  }
  const error = await saveRun(supabase, guard.data.user.id, cancelled);
  if (error) return NextResponse.json({ error: "The run could not be cancelled." }, { status: 500 });
  return NextResponse.json({ data: { run: runView(cancelled, Date.now()) } });
}
