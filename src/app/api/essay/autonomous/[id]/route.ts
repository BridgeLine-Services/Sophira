import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { runView } from "@/lib/essay/autonomous";
import { loadRun } from "@/lib/essay/run-store";

export const runtime = "nodejs";

/**
 * GET /api/essay/autonomous/[id] — the status of one run.
 *
 * Owner-scoped: the query filters on user_id, so another student's run id answers 404 rather
 * than returning someone else's assignment. The response is the honest view — state, measured
 * progress, recorded limitations and, only when it is true, the completion sentence.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  const run = await loadRun(supabase, guard.data.user.id, id);
  if (!run) return NextResponse.json({ error: "That assignment run is not in your list." }, { status: 404 });

  // Full text is returned here because the owner is the reader; the list view never carries it.
  return NextResponse.json({
    data: {
      run: runView(run, Date.now()),
      plan: run.plan,
      outline: run.outline,
      sections: run.sections,
      finalVerification: run.final_verification,
      context: run.context,
    },
  });
}
