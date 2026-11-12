import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import { Workspace } from "./Workspace";
import CanvasAssignmentContext from "@/components/app/CanvasAssignmentContext";
import { loadCanvasContext } from "@/lib/integrations/canvas-rubric";
import type { AiResponse, Assignment, Course, Teacher, WorkSession } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AssignmentWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: assignment } = await supabase
    .from("assignments")
    .select("*")
    .eq("id", id)
    .single();
  if (!assignment) notFound();

  const [courseRes, teacherRes, sessionRes, responsesRes] = await Promise.all([
    assignment.course_id
      ? supabase.from("courses").select("*").eq("id", assignment.course_id).single()
      : Promise.resolve({ data: null }),
    assignment.teacher_id
      ? supabase.from("teachers").select("*").eq("id", assignment.teacher_id).single()
      : Promise.resolve({ data: null }),
    supabase.from("work_sessions").select("*").eq("assignment_id", assignment.id).single(),
    supabase
      .from("responses")
      .select("*")
      .eq("assignment_id", assignment.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  // Canvas details for THIS student's assignment only (RLS plus an explicit user filter).
  // Null for every assignment that did not come from Canvas, which is the common case.
  const canvasContext = await loadCanvasContext(supabase, user.id, assignment.id);

  return (
    <AppShell
      subtitle="Read the brief, work through it, and submit when you are ready." title={assignment.title} backHref="/dashboard">
      {canvasContext && <CanvasAssignmentContext context={canvasContext} />}
      <Workspace
        assignment={assignment as Assignment}
        course={(courseRes.data as Course) ?? null}
        teacher={(teacherRes.data as Teacher) ?? null}
        session={(sessionRes.data as WorkSession) ?? null}
        latestResponse={(responsesRes.data?.[0] as AiResponse) ?? null}
        contextApplied={((responsesRes.data?.[0] as AiResponse & { context_applied?: unknown })?.context_applied as Record<string, unknown>) ?? null}
      />
    </AppShell>
  );
}
