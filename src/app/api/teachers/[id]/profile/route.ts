import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What one teacher actually requires — the text that shapes every answer about
 * their work.
 *
 * PUT /api/teachers/[id]/profile — save the requirement fields.
 *
 * These fields were previously written straight from the browser on a manual
 * "Save requirements" click, with no version check: two tabs, or a closed tab,
 * silently lost what the teacher had said. Now the editor saves as you type
 * through this route, revision-checked on `updated_at`, so a stale tab is
 * refused (409) instead of overwriting newer requirements.
 *
 * The route owns ONLY the thirteen requirement texts. The document lists
 * (rubrics, official instructions, examples, corrections) keep their own paths,
 * and an archived teacher is not edited here at all — an archived teacher is not
 * active context, so quietly changing its requirements would be misleading.
 *
 * A missing profile row is created on first save: `teacher_profiles` is unique per
 * teacher, and the insert is scoped to the signed-in member.
 */
const FIELDS = [
  "required_methods",
  "required_steps",
  "preferred_notation",
  "units_sig_figs",
  "formatting_requirements",
  "citation_requirements",
  "essay_structure",
  "lab_report_requirements",
  "preferred_terminology",
  "show_work_rules",
  "calculator_rules",
  "allowed_tools",
  "prohibited_tools",
] as const;

const MAX_FIELD = 4000;

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  const { id } = await params;

  let body: { requirements?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.requirements || typeof body.requirements !== "object") {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }
  const incoming = body.requirements as Record<string, unknown>;

  const patch: Record<string, string> = {};
  for (const field of FIELDS) {
    if (!(field in incoming)) continue;
    const raw = incoming[field];
    if (typeof raw !== "string") {
      return NextResponse.json({ error: `The field ${field} must be text.` }, { status: 400 });
    }
    patch[field] = raw.slice(0, MAX_FIELD);
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }

  // The teacher must be this member's own, and still active.
  const { data: teacher } = await supabase
    .from("teachers")
    .select("id, archived_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!teacher) return NextResponse.json({ error: "Teacher not found." }, { status: 404 });
  if (teacher.archived_at) {
    return NextResponse.json(
      { error: "This teacher is archived. Restore them before changing their requirements." },
      { status: 409 },
    );
  }

  const { data: existing } = await supabase
    .from("teacher_profiles")
    .select("id, updated_at")
    .eq("teacher_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const now = new Date().toISOString();
  const baseVersion = request.headers.get("x-sophira-base-version");

  if (!existing) {
    // First save: create the profile with exactly what the member typed. A base
    // version here would mean "update a row that should exist", which is a stale
    // tab creating a second profile — the unique constraint refuses it anyway.
    const { data, error } = await supabase
      .from("teacher_profiles")
      .insert({ ...patch, teacher_id: id, user_id: user.id, updated_at: now })
      .select("id, updated_at")
      .maybeSingle();
    if (error) {
      if (error.code === "23505" || /duplicate key/i.test(error.message)) {
        return NextResponse.json(
          {
            error: "This teacher's requirements were opened in two places. Reload before saving.",
            conflict: true,
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "Could not save the requirements." }, { status: 500 });
    }
    return NextResponse.json({ data });
  }

  let write = supabase
    .from("teacher_profiles")
    .update({ ...patch, updated_at: now })
    .eq("id", existing.id)
    .eq("user_id", user.id);
  if (baseVersion) write = write.eq("updated_at", baseVersion);

  const { data, error } = await write.select("id, updated_at").maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Could not save the requirements." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      {
        error:
          "This teacher's requirements changed somewhere else. Your text is still here - choose which version to keep.",
        conflict: true,
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ data });
}
