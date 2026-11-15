import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { flagDisabledMessage, flagEnabled } from "@/lib/features/flags";
import { advanceRunToBudget } from "@/lib/essay/runner";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/essay/autonomous/[id]/advance — do the next bounded step(s) of a run.
 *
 * Safe to call repeatedly and safe to call twice at once: the runner takes a lease, so a
 * repeated callback is ignored instead of writing a section twice. `steps` is capped so one
 * request cannot try to generate a whole essay.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  if (!flagEnabled("autonomous_essay")) {
    return NextResponse.json({ error: flagDisabledMessage("autonomous_essay"), flag: "autonomous_essay" }, { status: 503 });
  }

  let steps = 1;
  try {
    const body = (await request.json()) as { steps?: number };
    if (typeof body?.steps === "number") steps = Math.min(Math.max(Math.trunc(body.steps), 1), 3);
  } catch {
    /* no body is fine: one step is the default */
  }

  const { id } = await context.params;
  const outcome = await advanceRunToBudget(supabase, guard.data.user.id, id, steps);

  if (outcome.status === "not_found") {
    return NextResponse.json({ error: outcome.reason }, { status: 404 });
  }
  return NextResponse.json({
    data: {
      run: outcome.view,
      status: outcome.status,
      advanced: outcome.status === "advanced" ? outcome.did : null,
      reason: outcome.status === "advanced" ? null : outcome.reason,
    },
  });
}
