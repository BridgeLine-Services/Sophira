import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { recordPatternEvidence, EVIDENCE_TYPES, type EvidenceType, type PatternEvidence } from "@/lib/learning/evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATTERN EVIDENCE (confidence-decay round, 2026-10-05).
 *
 * POST /api/learning/patterns/evidence  { id, evidence, note? }
 *
 * Records ONE evidence event against a learning pattern. Confidence only
 * ever changes from recorded evidence (positive or negative), the decay
 * ladder is deterministic (src/lib/learning/evidence.ts), and the
 * transition is a LADDER — candidate → active → lower_confidence →
 * inactive — never an abrupt delete. A demoted or inactive pattern
 * becomes active again when later evidence confirms it.
 *
 * Teacher and current-assignment instructions always override learned
 * patterns: `teacher_contradicts` / `instruction_conflict` are strong
 * negative evidence and a pattern can never outrank fresh instructions.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  let body: { id?: string; evidence?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { id, evidence, note } = body;
  if (!id || !evidence || !EVIDENCE_TYPES.includes(evidence as EvidenceType)) {
    return NextResponse.json(
      { error: `Missing pattern id or valid evidence type (${EVIDENCE_TYPES.join(", ")}).` },
      { status: 400 }
    );
  }

  const { data: pattern } = await supabase
    .from("learning_patterns")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id) // RLS also enforces this
    .single();
  if (!pattern) return NextResponse.json({ error: "That pattern could not be found." }, { status: 404 });

  const outcome = recordPatternEvidence(pattern, { type: evidence as EvidenceType, note } satisfies PatternEvidence);

  // Persist ONLY the fields the evidence engine changed — plus an audit
  // trail so the UI can explain exactly why confidence moved.
  const { data: updated, error } = await supabase
    .from("learning_patterns")
    .update(outcome.updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: updated,
    explanation: outcome.explanation,
    changes: outcome.changes,
  });
}
