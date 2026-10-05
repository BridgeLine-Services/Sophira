import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { computeTypingResult } from "@/lib/typing";
import { recomputeTypingProfile, trustworthyObservations, type ObservedTypingAttempt } from "@/lib/typing-profile";
import { passageById, pickPassage } from "@/lib/typing-passage";

export const runtime = "nodejs";

/**
 * Typing calibration API (spec §9).
 *
 *  GET   /api/typing            → { passage, attempts, baseline }
 *  GET   /api/typing?passage=X  → same, with a specific canonical passage
 *  POST  /api/typing            → record an attempt (metrics recomputed
 *                                 server-side against the canonical
 *                                 reference; the typed text is never stored)
 *  PATCH /api/typing            → select one of your own VALID attempts
 *                                 as the baseline (atomic, single-baseline)
 *
 * All rows live in typing_attempts with user_id = auth.uid() RLS (migration
 * 0009). The owner can never read another user's typing data.
 */

const MAX_TYPED_LENGTH = 4000;
const MIN_DURATION_MS = 500;
const MAX_DURATION_MS = 15 * 60 * 1000;


/** Recompute + persist the adaptive profile from the user's own attempts. */
async function syncTypingProfile(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  calibrationAtMs: number
) {
  const { data: history } = await supabase
    .from("typing_attempts")
    .select("wpm, test_date, valid_attempt, flags")
    .order("test_date", { ascending: true })
    .limit(200);
  const { data: base } = await supabase
    .from("typing_attempts")
    .select("wpm")
    .eq("is_baseline", true)
    .maybeSingle();
  if (!base) return null; // no baseline yet → no profile (retake calibration first)
  const { data: existing } = await supabase
    .from("typing_profiles")
    .select("auto_adjust_enabled, manual_wpm")
    .eq("user_id", userId)
    .maybeSingle();
  const observed: ObservedTypingAttempt[] = (history ?? []).map((a: { wpm: number; test_date: string; valid_attempt: boolean; flags: string[] }) => ({
    wpm: Number(a.wpm), testDateMs: Date.parse(a.test_date),
    valid: a.valid_attempt, flags: a.flags ?? [],
  }));
  const profile = recomputeTypingProfile({
    baselineWpm: Number(base.wpm),
    attempts: observed,
    calibrationAtMs,
    autoAdjustEnabled: existing?.auto_adjust_enabled ?? false,
    manualWpm: existing?.manual_wpm ?? null,
  });
  const { data: saved, error } = await supabase
    .from("typing_profiles")
    .upsert({ user_id: userId, ...profile }, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) return null;
  return saved;
}

interface AttemptBody {
  passage_id?: string;
  typed?: string;
  started_at_ms?: number;
  ended_at_ms?: number;
}

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const passageId = request.nextUrl.searchParams.get("passage");
  const passage = (passageId && passageById(passageId)) || pickPassage(guard.data.user.id);

  const { data: attempts, error } = await supabase
    .from("typing_attempts")
    .select("id, test_date, duration_ms, characters_typed, wpm, accuracy, net_wpm, valid_attempt, flags, is_baseline, notes")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: "Could not load your typing history." }, { status: 500 });

  const baseline = attempts.find((a) => a.is_baseline) ?? null;
  // The OPTIONAL adaptive profile — never changes pacing unless enabled.
  const { data: profile } = await supabase
    .from("typing_profiles")
    .select("*")
    .eq("user_id", guard.data.user.id)
    .maybeSingle();
  return NextResponse.json({ data: { passage, attempts, baseline, profile: profile ?? null } });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  let body: AttemptBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const passage = passageById((body.passage_id || "").trim());
  if (!passage) {
    return NextResponse.json({ error: "Unknown passage — reload the calibration page and try again." }, { status: 400 });
  }
  const typed = typeof body.typed === "string" ? body.typed : "";
  if (!typed.trim()) {
    return NextResponse.json({ error: "Nothing was typed — type the passage first, then submit." }, { status: 400 });
  }
  if (typed.length > MAX_TYPED_LENGTH) {
    return NextResponse.json({ error: "That attempt looks invalid (far longer than the passage). Try again." }, { status: 400 });
  }
  const started = Number(body.started_at_ms);
  const ended = Number(body.ended_at_ms);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) {
    return NextResponse.json({ error: "The attempt timing is invalid. Please retake the test." }, { status: 400 });
  }
  const durationMs = ended - started;
  if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    return NextResponse.json(
      { error: "That attempt is too short or too long to count. The test should take at most a few minutes." },
      { status: 400 }
    );
  }

  // Server-side recomputation against the canonical reference: the stored
  // metrics are ours, never the client's claim.
  const result = computeTypingResult({
    startedAtMs: started,
    endedAtMs: ended,
    typed,
    reference: passage.text,
  });

  const { data: row, error } = await supabase
    .from("typing_attempts")
    .insert({
      user_id: user.id,
      test_date: new Date(ended).toISOString(),
      duration_ms: Math.round(result.durationMs),
      characters_typed: result.charactersTyped,
      wpm: Math.round(result.wpm * 10) / 10,
      accuracy: Math.round(result.accuracy * 1000) / 1000,
      net_wpm: Math.round(result.netWpm * 10) / 10,
      valid_attempt: result.validAttempt,
      flags: result.flags,
    })
    .select("id, wpm, accuracy, net_wpm, duration_ms, valid_attempt, flags")
    .single();
  if (error) return NextResponse.json({ error: "Could not save the attempt: " + error.message }, { status: 500 });

  // Adaptive profile: only trustworthy observations update the estimate.
  // Suspicious/flagged attempts are stored in history but NEVER corrupt it.
  let profileSynced = false;
  if (result.validAttempt && result.flags.length === 0) {
    const savedProfile = await syncTypingProfile(supabase, user.id, Date.now());
    profileSynced = savedProfile !== null;
  }

  return NextResponse.json({
    data: {
      attempt: row,
      valid: result.validAttempt,
      flags: result.flags,
      profile_updated: profileSynced,
      // Honest guidance, mirroring the flags exactly.
      message: result.validAttempt
        ? "Attempt saved."
        : "Attempt saved, but it was flagged (" + result.flags.join(", ") + ") and cannot become your baseline.",
    },
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  let body: { attempt_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const attemptId = (body.attempt_id || "").trim();
  if (!attemptId) return NextResponse.json({ error: "Missing attempt id." }, { status: 400 });

  const { error } = await supabase.rpc("select_typing_baseline", { p_attempt_id: attemptId });
  if (error) {
    return NextResponse.json(
      {
        error:
          error.message.includes("eligible baseline")
            ? "Only a valid attempt of your own can become the baseline — retake the test first."
            : "Could not select the baseline: " + error.message,
      },
      { status: 400 }
    );
  }
  // Repeated calibration: the profile's baseline + rolling estimate are
  // recomputed from the user's own recorded attempts.
  const profile = await syncTypingProfile(supabase, guard.data.user.id, Date.now());
  return NextResponse.json({ data: { ok: true, profile } });
}
