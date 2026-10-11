import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * COURSE LOOKUP API (course-aware engines round 2026-10-11): engines opened
 * with ?course_id= resolve the course's real record to display its name —
 * identity stays the course_id; the name is NEVER fabricated client-side.
 *
 * GET /api/courses?id=<uuid> — the signed-in student's OWN course
 * (id, name, subject, academic_level). RLS plus the explicit user_id scope
 * mean no user can ever read another user's course.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const id = request.nextUrl.searchParams.get("id")?.trim() || "";
  if (!id) {
    return NextResponse.json({ error: "Missing course id" }, { status: 400 });
  }

  const { data: course, error } = await supabase
    .from("courses")
    .select("id, name, subject, academic_level")
    .eq("id", id)
    .eq("user_id", guard.data.user.id) // belt-and-suspenders with RLS
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }
  return NextResponse.json({ data: course });
}
