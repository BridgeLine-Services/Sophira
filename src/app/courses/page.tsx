"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, EmptyState } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { BookOpen } from "lucide-react";
import type { Course, Teacher } from "@/lib/types";

export default function CoursesPage() {
  const supabase = createClient();
  const [courses, setCourses] = useState<Course[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("courses").select("*").order("created_at", { ascending: false }),
      supabase.from("teachers").select("*").order("created_at", { ascending: false }),
    ]).then(([c, t]) => {
      setCourses(c.data ?? []);
      setTeachers(t.data ?? []);
      setLoaded(true);
    });
  }, [supabase]);

  const teacherName = (id: string | null) =>
    id ? teachers.find((t) => t.id === id)?.name ?? null : null;

  return (
    <AppShell
      title="Courses"
      actions={
        <Link href="/courses/new">
          <Button size="sm">+ Add course</Button>
        </Link>
      }
    >
      {loaded && courses.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title="No courses yet"
          description="Courses tell Sophira which subject, level, and teacher rules to use."
          action={<Link href="/courses/new"><Button size="sm">Add a course</Button></Link>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {courses.map((c) => (
            <Link key={c.id} href={`/courses/${c.id}`} className="block">
              <Card className="transition hover:border-accent/40">
                <CardContent className="p-4">
                  <p className="font-medium text-ink">{c.name}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {c.subject && <Badge>{c.subject}</Badge>}
                    {c.academic_level && <Badge>{c.academic_level}</Badge>}
                    {c.term && <Badge>{c.term}</Badge>}
                  </div>
                  <p className="mt-2 text-xs text-ink-soft">
                    {c.teacher_id && teacherName(c.teacher_id) ? `${teacherName(c.teacher_id)} · ` : ""}
                    Added {fmtDate(c.created_at)}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
