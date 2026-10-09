import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Button } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { CourseEditor } from "./CourseEditor";
import { classifyEngine, ENGINES, ENGINE_TOOLS, toolUrl } from "@/lib/courses/engines";
import { Wrench } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CourseDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: course } = await supabase.from("courses").select("*").eq("id", params.id).single();
  if (!course) notFound();

  const [{ data: teachers }, { data: teacher }, { data: assignments }] = await Promise.all([
    supabase.from("teachers").select("id, name").order("name"),
    course.teacher_id
      ? supabase.from("teachers").select("id, name").eq("id", course.teacher_id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("assignments")
      .select("id, title, mode, status, updated_at")
      .eq("course_id", course.id)
      .order("updated_at", { ascending: false }),
  ]);

  const engineId = classifyEngine(course.subject);
  const engine = ENGINES[engineId];
  const tools = ENGINE_TOOLS[engineId];

  return (
    <AppShell title={course.name} backHref="/courses">
      <div className="space-y-6">
        {/* Course workspace header: name, subject, selected teacher, engine */}
        <div className="flex flex-wrap items-center gap-2">
          {course.subject ? (
            <Badge tone="neutral">{course.subject}</Badge>
          ) : (
            <Badge tone="neutral">No subject set</Badge>
          )}
          <Badge tone="accent">{engine.label}</Badge>
        </div>

        {/* Course workspace: subject-appropriate tools */}
        <section aria-label="Course workspace">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-ink"><Wrench className="h-4 w-4 text-accent" /> {engine.label}</h2>
          <p className="mb-3 text-sm text-ink-soft">{engine.description}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tools.map((tool) => (
              <Link
                key={tool.label}
                href={toolUrl(tool, course.id)}
                className="group rounded-card border border-ink/10 bg-white p-4 transition hover:border-accent/40 hover:bg-accent/[0.03]"
              >
                <p className="font-medium text-ink group-hover:text-accent">{tool.label}</p>
                <p className="mt-1 text-xs text-ink-soft">{tool.description}</p>
              </Link>
            ))}
          </div>
          {!teacher && (
            <p className="mt-3 text-xs text-ink-soft" role="note">
              No teacher selected for this course yet. Teacher-specific instructions will apply
              automatically once you choose one — nothing is invented before that.
            </p>
          )}
        </section>

        {teacher && (
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium text-ink-soft">Teacher</p>
                <p className="font-medium text-ink">{teacher.name}</p>
              </div>
              <Link href={`/teachers/${teacher.id}`}>
                <Button variant="secondary" size="sm">View teacher profile</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <CourseEditor course={course} teachers={teachers ?? []} />
          </CardContent>
        </Card>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">Assignments in this course</h2>
          <p className="sr-only">Assignments opened from this course keep its course and teacher context attached.</p>
          {assignments?.length ? (
            <div className="divide-y divide-ink/5 rounded-card border border-ink/10 bg-white">
              {assignments.map((a) => (
                <Link key={a.id} href={`/assignments/${a.id}`} className="flex items-center justify-between gap-3 p-4 transition hover:bg-ink/[0.02]">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{a.title}</p>
                    <p className="text-xs text-ink-soft">{fmtDate(a.updated_at)}</p>
                  </div>
                  <Badge tone={a.status === "active" ? "accent" : "neutral"}>{a.status}</Badge>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No assignments started in this course yet"
              description="Start one and its course rules apply automatically."
              action={
                <Link href={`/assignments/new?course_id=${course.id}`}>
                  <Button size="sm">Start an assignment</Button>
                </Link>
              }
            />
          )}
        </section>
      </div>
    </AppShell>
  );
}
