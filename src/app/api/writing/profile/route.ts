import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import {
  closenessExplanation,
  closenessLabel,
  CONTEXT_DESCRIPTIONS,
  CONTEXT_LABELS,
  DEFAULT_CLOSENESS,
  parseWritingContext,
  WRITING_CONTEXTS,
} from "@/lib/ai/writing-contexts";
import { loadContextProfiles, setCloseness } from "@/lib/ai/writing-profiles";

export const runtime = "nodejs";

/**
 * THE STUDENT'S OWN WRITING PREFERENCES, PER CONTEXT (2026-11-13, directive Part 5).
 *
 * GET  - the three contexts, what the student has for each, and their closeness setting.
 * PATCH - set the closeness dial for one context. This is the student's PREFERENCE, so it
 *         is written directly and needs no AI and no approval; suggested changes to the
 *         guidance itself still go through the existing proposal + approval flow.
 *
 * ADDITIVE: nothing here reads or changes existing endpoints. A student with no profiles
 * yet gets three empty contexts and the default dial, never an error.
 */
export async function GET() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const user = guard.data.user;

  const { contexts, degraded } = await loadContextProfiles(supabase, user.id);

  return NextResponse.json({
    contexts: contexts.map((c) => ({
      context: c.context,
      label: CONTEXT_LABELS[c.context],
      description: CONTEXT_DESCRIPTIONS[c.context],
      has_profile: Boolean(c.profile),
      // The guidance TEXT is not returned: it is long, and the writing screen already
      // shows it through the existing profile view. What a student needs here is state.
      approved: Boolean(c.approved),
      approved_version: c.approved?.version ?? null,
      updated_at: c.profile?.updated_at ?? null,
      closeness: c.closeness,
      closeness_label: closenessLabel(c.closeness),
      closeness_explanation: closenessExplanation(c.closeness),
    })),
    default_closeness: DEFAULT_CLOSENESS,
    degraded,
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const user = guard.data.user;

  let body: { context?: unknown; closeness?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the context and the closeness value." }, { status: 400 });
  }

  if (body.closeness === undefined || body.closeness === null) {
    return NextResponse.json({ error: "Send a closeness value between 0 and 100." }, { status: 400 });
  }

  const context = parseWritingContext(body.context);
  const result = await setCloseness(supabase, user.id, context, body.closeness);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Your setting was not saved. Nothing else was changed - please try again.", context: result.context },
      { status: result.error?.includes("cannot store") ? 503 : 500 },
    );
  }

  if (!WRITING_CONTEXTS.includes(result.context)) {
    // Unreachable through parseWritingContext, kept so an added context can never leak.
    return NextResponse.json({ error: "Unknown writing context." }, { status: 400 });
  }

  return NextResponse.json({
    saved: true,
    context: result.context,
    label: CONTEXT_LABELS[result.context],
    closeness: result.closeness,
    closeness_label: closenessLabel(result.closeness),
    closeness_explanation: closenessExplanation(result.closeness),
    created_profile: result.created,
  });
}
