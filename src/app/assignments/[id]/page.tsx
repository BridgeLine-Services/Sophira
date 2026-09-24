import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import { Workspace } from "./Workspace";
import type { AiResponse, Assignment, Course, Teacher, WorkSession } from "@/lib/types";

export default async function AssignmentWorkspacePage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: assignment } = await supabase
    .from("assignments")
    .select("*")
    .eq("id", params.id)
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

  return (
    <AppShell title={assignment.title} backHref="/dashboard">
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
