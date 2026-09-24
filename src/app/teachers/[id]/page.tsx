import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import { ProposalsPanel } from "@/components/app/ProposalsPanel";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui";
import { TeacherProfileEditor } from "./TeacherProfileEditor";

export default async function TeacherDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: teacher } = await supabase.from("teachers").select("*").eq("id", params.id).single();
  if (!teacher) notFound();

  const [{ data: profile }, { data: courses }] = await Promise.all([
    supabase.from("teacher_profiles").select("*").eq("teacher_id", teacher.id).single(),
    supabase.from("courses").select("id, name").eq("teacher_id", teacher.id),
  ]);

  return (
    <AppShell title={teacher.name} backHref="/teachers">
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
      </div>
    </AppShell>
  );
}
