import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import { Workspace } from "./Workspace";
import CanvasAssignmentContext from "@/components/app/CanvasAssignmentContext";
import { AssignmentNotes } from "@/components/app/AssignmentNotes";
import { loadCanvasContext } from "@/lib/integrations/canvas-rubric";
import type { AiResponse, Assignment, Course, Teacher, WorkSession } from "@/lib/types";
import type { StudentMemory } from "@/lib/memory/engine";

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

  // SCOPE 5 (2026-11-14): only this assignment's notes, read with the member's own
  // request-scoped client. user_id + assignment_id + RLS: never another member's rows,
  // and never a note attached to a different assignment.
  const { data: assignmentNotes } = await supabase
    .from("student_memories")
    .select("*")
    .eq("user_id", user.id)
    .eq("assignment_id", assignment.id)
    .neq("status", "forgotten")
    .order("last_observed", { ascending: false });

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
      <section className="mt-6">
        <AssignmentNotes
          assignmentId={assignment.id}
          assignmentTitle={assignment.title}
          initialMemories={(assignmentNotes ?? []) as StudentMemory[]}
        />
      </section>
    </AppShell>
  );
}
