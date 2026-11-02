// Canvas → Sophira synchronization (2026-11-02).
//
// Design rules, all of which matter for correctness:
//  * Writes go through the USER-SCOPED Supabase client, never the service role,
//    so existing RLS policies remain the authority on ownership. The service
//    role is used only to read the student's own token row.
//  * Idempotent: a second run with unchanged Canvas data creates nothing.
//    planAssignmentSync (pure, tested) decides what to write.
//  * Additive: Canvas discoveries create NEW Sophira assignments through the
//    existing assignments table. Manual assignments are never modified, renamed
//    or deleted, and no existing id changes.
//  * Nothing is submitted anywhere. Sync only prepares a workspace.
//  * Canvas text is stored as data. It is never executed, never treated as
//    instructions to Sophira, and never logged in full.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listCourses,
  listCourseAssignments,
  normalizeAssignment,
  planAssignmentSync,
  describeSyncCounts,
  type NormalizedAssignment,
  type PreviousAssignmentState,
  type SyncPlan,
} from "@/lib/integrations/canvas";

export interface SyncSummary {
  ok: boolean;
  message: string;
  courses: number;
  created: number;
  updated: number;
  missing: number;
  restored: number;
  unchanged: number;
  /** Plain-language problems; never raw provider payloads. */
  notices: string[];
  /** What changed, ready for the student UI: no provider payloads, no tokens. */
  changes: SyncChange[];
}

export interface SyncChange {
  canvasId: string;
  title: string;
  courseName: string | null;
  kind: "new" | "updated" | "restored" | "missing";
  dueAt: string | null;
  /** Sophira assignment to open; null when Canvas no longer lists it. */
  assignmentId: string | null;
}

async function recordEvent(
  supabase: SupabaseClient,
  userId: string,
  kind: string,
  detail: Record<string, unknown> = {}
): Promise<void> {
  // Audit rows are best-effort: a failed audit write must not corrupt a sync.
  await supabase.from("canvas_sync_events").insert({ user_id: userId, kind, detail });
}

/**
 * Ensures the Canvas course has exactly one Sophira course row, and returns its
 * id. Idempotent via canvas_courses.sophira_course_id.
 */
async function ensureSophiraCourse(
  supabase: SupabaseClient,
  userId: string,
  canvasCourseId: string,
  name: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("canvas_courses")
    .select("id, sophira_course_id")
    .eq("user_id", userId)
    .eq("canvas_course_id", canvasCourseId)
    .maybeSingle();

  if (existing?.sophira_course_id) return existing.sophira_course_id as string;

  const { data: created, error } = await supabase
    .from("courses")
    .insert({ user_id: userId, name: name.slice(0, 200) })
    .select("id")
    .single();
  if (error || !created) return null;

  await supabase
    .from("canvas_courses")
    .update({ sophira_course_id: created.id })
    .eq("user_id", userId)
    .eq("canvas_course_id", canvasCourseId);
  return created.id as string;
}

async function applyPlan(
  supabase: SupabaseClient,
  userId: string,
  courseId: string | null,
  courseName: string | null,
  plan: SyncPlan,
  changes: SyncChange[],
  titleById: Map<string, string>
): Promise<{ created: number; updated: number; missing: number; restored: number }> {
  let created = 0, updated = 0, missing = 0, restored = 0;

  const write = async (a: NormalizedAssignment, restore: boolean) => {
    // A Canvas assignment becomes a NEW Sophira assignment the first time. The
    // student still reviews and edits it; sync never writes their answer.
    let sophiraAssignmentId: string | null = null;
    const { data: link } = await supabase
      .from("canvas_assignments")
      .select("sophira_assignment_id")
      .eq("user_id", userId)
      .eq("canvas_assignment_id", a.canvasId)
      .maybeSingle();
    sophiraAssignmentId = (link?.sophira_assignment_id as string | null) ?? null;
    const existed = sophiraAssignmentId !== null;

    if (!sophiraAssignmentId) {
      const { data: createdAssignment } = await supabase
        .from("assignments")
        .insert({
          user_id: userId,
          title: a.title,
          course_id: courseId,
          mode: "assignment",
          instructions_text: a.description,
          status: "active",
        })
        .select("id")
        .single();
      sophiraAssignmentId = (createdAssignment?.id as string | undefined) ?? null;
    }

    await supabase.from("canvas_assignments").upsert(
      {
        user_id: userId,
        canvas_course_id: a.courseId,
        canvas_assignment_id: a.canvasId,
        title: a.title,
        description: a.description,
        due_at: a.dueAt,
        points_possible: a.pointsPossible,
        submission_types: a.submissionTypes,
        html_url: a.htmlUrl,
        rubric: a.rubric,
        attachments: a.attachments,
        published: a.published,
        content_fingerprint: a.fingerprint,
        last_seen_at: new Date().toISOString(),
        sync_state: "active",
        sophira_assignment_id: sophiraAssignmentId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,canvas_assignment_id" }
    );

    changes.push({
      canvasId: a.canvasId,
      title: a.title,
      courseName,
      kind: restore ? "restored" : existed ? "updated" : "new",
      dueAt: a.dueAt,
      assignmentId: sophiraAssignmentId,
    });

    if (restore) {
      restored++;
      await recordEvent(supabase, userId, "assignment_updated", {
        canvas_assignment_id: a.canvasId, note: "available again",
      });
    } else if (existed) {
      updated++;
      await recordEvent(supabase, userId, "assignment_updated", { canvas_assignment_id: a.canvasId });
    } else {
      created++;
      await recordEvent(supabase, userId, "assignment_new", { canvas_assignment_id: a.canvasId });
    }
  };

  for (const a of plan.toCreate) await write(a, false);
  for (const a of plan.toUpdate) await write(a, false);
  for (const a of plan.toRestore) await write(a, true);

  for (const canvasId of plan.toMarkMissing) {
    // Kept, not deleted: the student may already have work attached to it.
    await supabase
      .from("canvas_assignments")
      .update({ sync_state: "missing", updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("canvas_assignment_id", canvasId);
    missing++;
    changes.push({
      canvasId,
      title: titleById.get(canvasId) ?? "An assignment",
      courseName,
      kind: "missing",
      dueAt: null,
      assignmentId: null,
    });
    await recordEvent(supabase, userId, "assignment_missing", { canvas_assignment_id: canvasId });
  }

  return { created, updated, missing, restored };
}

export async function runCanvasSync(
  supabase: SupabaseClient,
  userId: string,
  baseUrl: string,
  accessToken: string
): Promise<SyncSummary> {
  const empty: SyncSummary = {
    ok: false, message: "", courses: 0, created: 0, updated: 0, missing: 0,
    restored: 0, unchanged: 0, notices: [], changes: [],
  };
  await recordEvent(supabase, userId, "sync_started", {});

  const courseResult = await listCourses(baseUrl, accessToken);
  if (!courseResult.ok) {
    await recordEvent(supabase, userId, "sync_failed", { stage: "courses" });
    return { ...empty, message: "Sophira could not reach Canvas just now. Nothing was changed — try again in a moment." };
  }

  const notices: string[] = [];
  const changes: SyncChange[] = [];
  let created = 0, updated = 0, missing = 0, restored = 0, unchanged = 0;

  for (const course of courseResult.courses) {
    const canvasCourseId = String(course.id);
    const name = (course.name ?? "Canvas course").slice(0, 200);
    const instructor = course.teachers?.[0]?.display_name ?? null;

    const sophiraCourseId = await ensureSophiraCourse(supabase, userId, canvasCourseId, name);
    await supabase.from("canvas_courses").upsert(
      {
        user_id: userId,
        canvas_course_id: canvasCourseId,
        name,
        course_code: course.course_code ?? null,
        workflow_state: course.workflow_state ?? null,
        term_name: course.term?.name ?? null,
        instructor_name: instructor,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,canvas_course_id" }
    );

    const assignmentResult = await listCourseAssignments(baseUrl, accessToken, canvasCourseId);
    if (!assignmentResult.ok) {
      // One unreadable course must not abort the rest of the sync.
      notices.push(`One course (${name}) could not be read just now.`);
      continue;
    }

    const incoming = assignmentResult.assignments
      .map(normalizeAssignment)
      .filter((a): a is NormalizedAssignment => a !== null)
      // Canvas returns drafts to teachers, not students; guard anyway so an
      // unpublished item never lands in a student's workspace as work.
      .filter((a) => a.published);

    const { data: previousRows } = await supabase
      .from("canvas_assignments")
      .select("canvas_assignment_id, content_fingerprint, sync_state, title")
      .eq("user_id", userId)
      .eq("canvas_course_id", canvasCourseId);

    const previous: PreviousAssignmentState[] = (previousRows ?? []).map((r) => ({
      canvasId: r.canvas_assignment_id as string,
      fingerprint: (r.content_fingerprint as string | null) ?? null,
      syncState: (r.sync_state as "active" | "missing") ?? "active",
    }));

    const titleById = new Map<string, string>(
      (previousRows ?? []).map((r) => [r.canvas_assignment_id as string, (r.title as string | null) ?? "An assignment"])
    );

    const plan = planAssignmentSync(previous, incoming);
    unchanged += plan.unchanged;
    const applied = await applyPlan(
      supabase, userId, sophiraCourseId, name, plan, changes, titleById
    );
    created += applied.created;
    updated += applied.updated;
    missing += applied.missing;
    restored += applied.restored;
  }

  const message = describeSyncCounts({ created, updated, missing, restored });

  await recordEvent(supabase, userId, "sync_completed", {
    courses: courseResult.courses.length,
    created, updated, missing, restored,
  });

  return {
    ok: true,
    message,
    courses: courseResult.courses.length,
    created, updated, missing, restored, unchanged,
    notices, changes,
  };
}
