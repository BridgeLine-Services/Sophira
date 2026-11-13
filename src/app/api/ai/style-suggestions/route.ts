import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { proposeStyleSuggestions } from "@/lib/ai/writing-profile-learning";
import { noSamplesMessage, pickAccepted, proposalRowFor, suggestionDisclaimer } from "@/lib/ai/style-suggestions";
import { CONTEXT_LABELS, parseWritingContext } from "@/lib/ai/writing-contexts";
import { ensureProfileForContext } from "@/lib/ai/writing-profiles";

export const runtime = "nodejs";

/**
 * Deterministic style suggestions from the user's OWN samples.
 *
 * Deliberately requires no AI provider: this route works on the free tier with
 * no key configured, because the analysis is local and rule-based. It writes
 * nothing except PENDING proposals the user explicitly selected.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const user = guard.data.user;

  let body: { accept?: unknown; assignment_type?: string; context?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // no body -> analyse everything usable and apply nothing
  }

  // 2026-11-13 (directive Part 5): suggestions come only from samples of the SAME kind of
  // writing, so a casual note never proposes changes to the student's academic voice.
  const context = parseWritingContext(body.context);

  const { data: samples, error: samplesError } = await supabase
    .from("writing_samples")
    .select("content, created_at")
    .eq("profile_context", context)
    .neq("representativeness", "not_representative")
    .order("created_at", { ascending: false })
    .limit(20);

  if (samplesError) {
    // No context column (a database before 0058): refuse rather than silently mixing
    // registers. Nothing is written.
    return NextResponse.json(
      { suggestions: [], proposed: 0, error: "Separate writing contexts are not available on this database yet. Nothing was changed." },
      { status: 503 },
    );
  }

  const texts = (samples ?? [])
    .map((s) => (typeof s.content === "string" ? s.content : ""))
    .filter((t) => t.trim().length > 0);

  if (texts.length === 0) {
    return NextResponse.json({ suggestions: [], message: noSamplesMessage() }, { status: 200 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("academic_level")
    .limit(1);

  const level = profile?.[0]?.academic_level ?? "";
  const assignmentType = typeof body.assignment_type === "string" ? body.assignment_type : "";
  const suggestions = proposeStyleSuggestions(texts, level, assignmentType);

  const accepted = pickAccepted(suggestions, body.accept);
  let proposed = 0;

  if (accepted.length > 0) {
    // The profile this context's suggestions belong to (directive Part 5).
    const ensured = await ensureProfileForContext(supabase, user.id, context);
    if (!ensured.profileId) {
      return NextResponse.json(
        { error: "Could not prepare your writing profile. Nothing was changed - please try again." },
        { status: 500 }
      );
    }
    const profileId = ensured.profileId;

    const rows = accepted.map((s) => proposalRowFor(user.id, profileId, s));
    const { error: insertError } = await supabase.from("profile_update_proposals").insert(rows);
    if (insertError) {
      return NextResponse.json(
        { error: "Your suggestions were not saved. Nothing was applied - please try again." },
        { status: 500 }
      );
    }
    proposed = rows.length;
  }

  return NextResponse.json({
    suggestions,
    proposed,
    context,
    context_label: CONTEXT_LABELS[context],
    disclaimer: suggestionDisclaimer(),
  });
}
