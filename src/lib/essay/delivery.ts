/**
 * COMPLETE-DOCUMENT DELIVERY (directive 2026-11-15, Part 6).
 *
 * A run stores its work inside `assignment_runs`. The student's essays live in `essay_sessions`,
 * which is the table the essay workspace reads and the table the manual workflow writes. Before
 * this file, an autonomous run could reach "completed" and the finished piece existed nowhere the
 * student could open, print or export — the text was real but stranded.
 *
 * So this is the hand-off, and it keeps four rules:
 *
 *  1. It runs only when the run may honestly be called complete (`canClaimCompletion`). A run
 *     that has not stored its text and a verdict is never placed in the library.
 *  2. It writes through the student's own signed-in client, filtered on their own user_id. The
 *     service role never touches a member's essay.
 *  3. It is idempotent: the session id is remembered on the run, so a retry updates the same
 *     essay instead of producing a second copy of the student's work.
 *  4. A failure to deliver is reported, and the run is blocked rather than marked complete. An
 *     essay the student cannot find is not a delivered essay.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { canClaimCompletion, type RunRecord } from "./autonomous";

/** The columns one delivery writes into `essay_sessions`. */
export interface SessionPayload {
  title: string;
  question: string;
  genre: string;
  stage: "final_verification";
  status: "verified";
  outline_approved: true;
  plan: unknown;
  outline: unknown;
  sections: unknown;
  final_verification: unknown;
  assignment_id: string | null;
  course_id: string | null;
  teacher_id: string | null;
  research_project_id: string | null;
}

export interface DeliveryDecision {
  allowed: boolean;
  reason: string | null;
}

/**
 * May this run's text be placed in the student's library?
 *
 * The one gate that matters is the same one completion uses, so the two can never disagree:
 * a run that cannot claim completion cannot deliver a document either.
 */
export function deliveryDecision(run: RunRecord): DeliveryDecision {
  const claim = canClaimCompletion(run);
  if (!claim.allowed) {
    return { allowed: false, reason: claim.reason ?? "The work is not finished yet." };
  }
  if (!run.final_verification) {
    return { allowed: false, reason: "There is no stored verification result for this run yet." };
  }
  return { allowed: true, reason: null };
}

/** A short, readable title for the student's essay, never invented from a model. */
export function sessionTitle(run: RunRecord): string {
  const fromRequest = (run.request.title ?? "").trim();
  if (fromRequest) return fromRequest.slice(0, 120);
  const question = (run.request.question ?? "").trim().replace(/\s+/g, " ");
  if (!question) return "Assignment";
  return question.length > 80 ? `${question.slice(0, 77).trimEnd()}…` : question;
}

/**
 * The exact columns delivery writes. Pure, so a test can pin them without a database.
 *
 * `outline_approved` is true by construction: the autonomous runner's own outline stage is what
 * approved it, and `canClaimCompletion` refuses a run whose sections were not all drafted against
 * that outline. Nothing here edits the student's existing session.
 */
export function sessionPayload(run: RunRecord): SessionPayload {
  return {
    title: sessionTitle(run),
    question: run.request.question ?? "",
    genre: (run.request.genre ?? "").trim() || "Essay",
    stage: "final_verification",
    status: "verified",
    outline_approved: true,
    plan: run.plan ?? {},
    outline: run.outline,
    sections: run.sections,
    final_verification: run.final_verification,
    assignment_id: run.request.assignmentId ?? null,
    course_id: run.request.courseId ?? null,
    teacher_id: run.request.teacherId ?? null,
    research_project_id: run.request.researchProjectId ?? null,
  };
}

export interface DeliveryOutcome {
  sessionId: string | null;
  created: boolean;
  error: string | null;
}

const DELIVERY_FAILED = "The finished piece could not be placed in your library, so the run is not marked finished.";

/** Shown when delivery produced no essay at all. */
export const DELIVERY_NEEDS_LIBRARY = DELIVERY_FAILED;

/**
 * Place a completed run's text in the student's essay library.
 *
 * Ownership is enforced twice: the run carries the id of the session it already created, and
 * every read/write is filtered on the student's own user_id, so a stale or tampered id cannot
 * reach somebody else's essay.
 */
export async function deliverRunToLibrary(
  supabase: SupabaseClient,
  userId: string,
  run: RunRecord,
): Promise<DeliveryOutcome> {
  const decision = deliveryDecision(run);
  if (!decision.allowed) {
    return { sessionId: null, created: false, error: decision.reason ?? "The work is not finished yet." };
  }

  const payload = sessionPayload(run);

  // The run already owns a session: update that one so a retry never duplicates the essay.
  if (run.essay_session_id) {
    const { data, error } = await supabase
      .from("essay_sessions")
      .update({ ...payload, updated_date: new Date().toISOString() })
      .eq("id", run.essay_session_id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (error) return { sessionId: run.essay_session_id, created: false, error: DELIVERY_FAILED };
    if (data?.id) return { sessionId: data.id, created: false, error: null };
    // The session was deleted by the student: fall through and create a fresh one rather than
    // silently reporting a delivery that no longer exists.
  }

  const { data, error } = await supabase
    .from("essay_sessions")
    .insert({ ...payload, user_id: userId })
    .select("id")
    .maybeSingle();
  if (error || !data?.id) return { sessionId: null, created: false, error: DELIVERY_FAILED };
  return { sessionId: data.id, created: true, error: null };
}
