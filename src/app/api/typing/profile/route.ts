import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { effectiveTypingPace, PLAUSIBLE_MAX_WPM } from "@/lib/typing-profile";

export const runtime = "nodejs";

/**
 * ADAPTIVE TYPING PROFILE API (2026-10-05) — optional, user-controlled.
 *
 *   GET   /api/typing/profile → the profile + the effective pace
 *   PATCH /api/typing/profile { auto_adjust_enabled?, manual_wpm? }
 *         → enable/disable adaptive pacing, select or clear a preferred
 *           pace. Pacing NEVER changes automatically unless enabled.
 *
 * RLS: typing_profiles is strictly per-user (migration 0018). The user
 * keeps full control: baseline fixed by default, retake calibration any
 * time via POST/PATCH /api/typing.
 */

const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

export async function GET() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const { data: profile } = await supabase
    .from("typing_profiles")
    .select("*")
    .eq("user_id", guard.data.user.id)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({
      data: {
        profile: null,
        message: "No profile yet — complete the typing test and select a baseline first.",
      },
    });
  }
  const pace = effectiveTypingPace({
    baseline_wpm: Number(profile.baseline_wpm),
    recommended_wpm: Number(profile.recommended_wpm),
    auto_adjust_enabled: profile.auto_adjust_enabled,
    manual_wpm: profile.manual_wpm === null ? null : Number(profile.manual_wpm),
  });
  return NextResponse.json({ data: { profile, effective_pace: pace } });
}

export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  let body: { auto_adjust_enabled?: boolean; manual_wpm?: number | null };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request body.");
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.auto_adjust_enabled === "boolean") {
    patch.auto_adjust_enabled = body.auto_adjust_enabled;
  }
  if (body.manual_wpm !== undefined) {
    if (body.manual_wpm === null) {
      patch.manual_wpm = null; // clear the manual preference → fall back to auto/baseline
    } else {
      const wpm = Number(body.manual_wpm);
      if (!Number.isFinite(wpm) || wpm <= 0 || wpm > PLAUSIBLE_MAX_WPM) {
        return bad(`A preferred pace must be between 1 and ${PLAUSIBLE_MAX_WPM} WPM.`);
      }
      patch.manual_wpm = Math.round(wpm * 10) / 10;
    }
  }
  if (Object.keys(patch).length === 1) {
    return bad("Nothing to update — pass auto_adjust_enabled and/or manual_wpm.");
  }

  // Create-on-first-use: if no profile exists yet, derive one from the
  // user's selected baseline so the toggles always have a row to hold them.
  const { data: existing } = await supabase
    .from("typing_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!existing) {
    const { data: base } = await supabase
      .from("typing_attempts")
      .select("wpm, test_date")
      .eq("is_baseline", true)
      .maybeSingle();
    if (!base) {
      return bad("Complete the typing test and select a baseline first.", 404);
    }
    const { error } = await supabase.from("typing_profiles").insert({
      user_id: user.id,
      baseline_wpm: base.wpm,
      recent_average_wpm: base.wpm,
      recommended_wpm: base.wpm,
      confidence: "LOW",
      sample_count: 0,
      last_calibration_at: base.test_date,
      auto_adjust_enabled: false,
      manual_wpm: null,
    });
    if (error) return bad("Could not create the profile: " + error.message, 500);
  }

  const { data: updated, error } = await supabase
    .from("typing_profiles")
    .update(patch)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error || !updated) return bad("Could not update the profile: " + (error?.message ?? "unknown"), 500);

  const pace = effectiveTypingPace({
    baseline_wpm: Number(updated.baseline_wpm),
    recommended_wpm: Number(updated.recommended_wpm),
    auto_adjust_enabled: updated.auto_adjust_enabled,
    manual_wpm: updated.manual_wpm === null ? null : Number(updated.manual_wpm),
  });
  return NextResponse.json({ data: { profile: updated, effective_pace: pace } });
}
