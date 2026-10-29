import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { proposeStyleSuggestions } from "@/lib/ai/writing-profile-learning";
import { noSamplesMessage, pickAccepted, proposalRowFor, suggestionDisclaimer } from "@/lib/ai/style-suggestions";

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

  let body: { accept?: unknown; assignment_type?: string } = {};
  try {
    body = await request.json();
  } catch {
    // no body -> analyse everything usable and apply nothing
  }

  const { data: samples } = await supabase
    .from("writing_samples")
    .select("content, created_at")
    .neq("representativeness", "not_representative")
    .order("created_at", { ascending: false })
    .limit(20);

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
    const { data: existing } = await supabase
      .from("writing_profiles")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1);

    let profileId = existing?.[0]?.id as string | undefined;
    if (!profileId) {
      const { data: created, error } = await supabase
        .from("writing_profiles")
        .insert({ user_id: user.id, summary: {}, guidance: "", status: "draft", version: 1 })
        .select("id")
        .single();
      if (error || !created) {
        return NextResponse.json(
          { error: "Could not prepare your writing profile. Nothing was changed - please try again." },
          { status: 500 }
        );
      }
      profileId = created.id as string;
    }

    const rows = accepted.map((s) => proposalRowFor(user.id, profileId as string, s));
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
    disclaimer: suggestionDisclaimer(),
  });
}
