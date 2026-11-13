import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import { ProposalsPanel } from "@/components/app/ProposalsPanel";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui";
import { TeacherProfileEditor } from "./TeacherProfileEditor";
import { TeacherPreferences } from "@/components/app/TeacherPreferences";
import type { StudentMemory } from "@/lib/memory/engine";

export const dynamic = "force-dynamic";

export default async function TeacherDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: teacher } = await supabase.from("teachers").select("*").eq("id", id).single();
  if (!teacher) notFound();

  const [{ data: profile }, { data: courses }, { data: teacherMemories }] = await Promise.all([
    supabase.from("teacher_profiles").select("*").eq("teacher_id", teacher.id).single(),
    supabase.from("courses").select("id, name").eq("teacher_id", teacher.id),
    // SCOPE 4 (2026-11-13): only this teacher's preferences, read with the member's own
    // request-scoped client. user_id + teacher_id + RLS: never another member's rows, and
    // never a preference attached to a different teacher.
    supabase
      .from("student_memories")
      .select("*")
      .eq("user_id", user.id)
      .eq("teacher_id", teacher.id)
      .neq("status", "forgotten")
      .order("last_observed", { ascending: false }),
  ]);

  return (
    <AppShell
      subtitle="This teacher's preferences, and the courses and work they are attached to." title={teacher.name} backHref="/teachers">
      <div className="space-y-6">
        <ProposalsPanel targetType="teacher" targetId={profile?.id} />
        {courses && courses.length > 0 && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 p-4">
              <span className="text-sm text-ink-soft">Teaches:</span>
              {courses.map((c) => (
                <Badge key={c.id} tone="accent">{c.name}</Badge>
              ))}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Teacher profile</CardTitle>
          </CardHeader>
          <CardContent>
            <TeacherProfileEditor teacher={teacher} profile={profile ?? null} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <TeacherPreferences
              teacherId={teacher.id}
              teacherName={teacher.name}
              initialMemories={(teacherMemories ?? []) as StudentMemory[]}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
