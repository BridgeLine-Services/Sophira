import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One assignment, as the member describes it.
 *
 * PATCH /api/assignments/[id] — rename it and edit the brief (the instructions
 * text the member pasted or typed). Scoped to the signed-in member three times
 * over: the auth guard, the explicit `.eq("user_id", ...)`, and RLS on the table.
 *
 * Revision-aware (Phase 6): the editor sends the version it started from in
 * `x-sophira-base-version`. If the assignment moved on since — another tab,
 * another device — the write is refused with 409 instead of overwriting newer
 * work. A caller that sends no version behaves as before.
 *
 * What this route deliberately does NOT touch: `due_date` does not exist on
 * `assignments` (the schedule owns due dates), and status changes have their own
 * flows. Only the member's own words are edited here.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  const { id } = await params;

  let body: { title?: unknown; instructions_text?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const patch: Record<string, string> = {};
  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (title.length < 2) {
      return NextResponse.json({ error: "Give the assignment a title of at least two characters." }, { status: 400 });
    }
    patch.title = title.slice(0, 200);
  }
  if (typeof body.instructions_text === "string") {
    patch.instructions_text = body.instructions_text.slice(0, 20000);
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const baseVersion = request.headers.get("x-sophira-base-version");
  let write = supabase.from("assignments").update(patch).eq("id", id).eq("user_id", user.id);
  if (baseVersion) write = write.eq("updated_at", baseVersion);

  const { data, error } = await write.select("id, title, instructions_text, updated_at").maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Could not save the assignment." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      {
        error:
          "This assignment changed somewhere else. Your text is still here - choose which version to keep.",
        conflict: true,
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ assignment: data });
}
