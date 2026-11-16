import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { canUseTesterFeatures } from "@/lib/auth/permissions";
import { OUTCOME_LABEL, parseOutcome } from "@/lib/tester/test-library";

export const runtime = "nodejs";

/**
 * POST /api/tester/results — record what happened when a numbered test was run.
 *
 * Three things this route deliberately does not do:
 *
 *   1. It does not decide the outcome. Only the four recorded outcomes are accepted; a typo is
 *      refused with a sentence, never rounded to "passed".
 *   2. It does not take a person's identity from the browser. `reported_by` is set from the
 *      authenticated session, and the insert policy in migration 0061 checks it again, so a forged
 *      body cannot record a result in somebody else's name.
 *   3. It does not touch the test case itself. A result is evidence about a test, not an edit to it:
 *      only staff may change the list, and this route never does.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !canUseTesterFeatures(profile.role)) {
    return NextResponse.json({ error: "Only testers and staff can record test results." }, { status: 403 });
  }

  let body: { test_case_id?: string; outcome?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const testCaseId = String(body.test_case_id ?? "").trim();
  if (!testCaseId) return NextResponse.json({ error: "Choose the test you ran." }, { status: 400 });

  const outcome = parseOutcome(body.outcome);
  if (!outcome) {
    return NextResponse.json(
      { error: "Record what happened: passed, failed, could not run, or not run." },
      { status: 400 },
    );
  }

  const notes = String(body.notes ?? "").trim();
  if (notes.length > 2000) {
    return NextResponse.json({ error: "Keep the note under 2000 characters." }, { status: 400 });
  }

  // The case must be one the caller can see. Reading it first means a retired test cannot be
  // recorded against by a stale page, and a missing case is a plain sentence rather than a
  // database error.
  const { data: testCase, error: caseError } = await supabase
    .from("qa_test_cases")
    .select("id, code, title, is_active")
    .eq("id", testCaseId)
    .maybeSingle();

  if (caseError) {
    return NextResponse.json(
      { error: "The test list could not be read, so nothing was recorded. Try again in a moment." },
      { status: 503 },
    );
  }
  if (!testCase) {
    return NextResponse.json({ error: "That test is not in the library." }, { status: 404 });
  }
  if (testCase.is_active === false) {
    return NextResponse.json(
      { error: "That test has been retired, so a result would not mean anything. Pick an active one." },
      { status: 409 },
    );
  }

  const { data: saved, error: saveError } = await supabase
    .from("qa_test_results")
    .insert({ test_case_id: testCaseId, outcome, notes, reported_by: user.id })
    .select("id, outcome, created_at")
    .single();

  if (saveError || !saved) {
    return NextResponse.json({ error: "The result could not be saved. Nothing was recorded." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: saved.id,
    outcome,
    // The sentence the tester sees, in their own words rather than the column's.
    message: `${testCase.code} recorded as ${OUTCOME_LABEL[outcome].toLowerCase()}.`,
  });
}
