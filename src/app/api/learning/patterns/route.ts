import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import {
  transitionPattern,
  type PatternAction,
  type PatternSource,
} from "@/lib/learning/patterns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The student's structured learning state (workflow §9–§12).
 *
 * GET   — all of the user's learning patterns (their own; RLS-enforced).
 * PATCH — lifecycle transitions, always initiated or confirmed by the user:
 *           confirm        "yes, that's a real pattern of mine"
 *           mark_corrected "I don't make this mistake anymore"
 *           reactivate     "it came back"
 *           mark_temporary "that was a one-off"
 *         No AI path silently rewrites a pattern's state — the model may only
 *         record new observations (via /api/ai/solve), never confirm/correct.
 * DELETE — forget a pattern entirely.
 */
const ACTIONS: PatternAction[] = ["confirm", "mark_corrected", "reactivate", "mark_temporary"];

export async function GET() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const { data, error } = await supabase
    .from("learning_patterns")
    .select("*")
    .eq("user_id", guard.data.user.id)
    .order("last_observed", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  let body: { id?: string; action?: string; correction_source?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { id, action } = body;
  if (!id || !action || !ACTIONS.includes(action as PatternAction)) {
    return NextResponse.json({ error: "Missing pattern id or valid action." }, { status: 400 });
  }

  const { data: pattern } = await supabase
    .from("learning_patterns")
    .select("*")
    .eq("id", id)
    .eq("user_id", guard.data.user.id) // RLS also enforces this
    .single();
  if (!pattern) return NextResponse.json({ error: "That pattern could not be found." }, { status: 404 });

  const t = transitionPattern(pattern, action as PatternAction, {
    source: "user" as PatternSource,
    correctionSource: body.correction_source,
  });
  const { data: updated, error } = await supabase
    .from("learning_patterns")
    .update({
      status: t.status,
      confidence: t.confidence,
      ...(t.source ? { source: t.source } : {}),
      ...(t.correction_source !== undefined ? { correction_source: t.correction_source } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: updated });
}

export async function DELETE(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing pattern id." }, { status: 400 });
  const { error } = await supabase
    .from("learning_patterns")
    .delete()
    .eq("id", id)
    .eq("user_id", guard.data.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: { ok: true } });
}
