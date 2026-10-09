"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, EmptyState } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { BookOpen } from "lucide-react";
import type { Course, Teacher } from "@/lib/types";
import { classifyEngine, COURSE_GROUPS, ENGINES, type EngineId } from "@/lib/courses/engines";

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
        <div className="space-y-6">
          {COURSE_GROUPS.map((group) => {
            const grouped = courses.filter((c) => group.engines.includes(classifyEngine(c.subject)));
            if (grouped.length === 0) return null;
            const isScience = group.key === "science";
            return (
              <section key={group.key} aria-label={group.label}>
                <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-ink">
                  {group.label}
                  {isScience && <span className="text-xs font-normal text-ink-soft">parent course — subjects nested below</span>}
                </h2>
                {isScience ? (
                  /* Science: a parent card containing one nested section per subject. */
                  <Card>
                    <CardContent className="space-y-4 p-4">
                      {group.engines.map((eid: EngineId) => {
                        const subjectCourses = grouped.filter((c) => classifyEngine(c.subject) === eid);
                        return (
                          <div key={eid} className="rounded-card border border-ink/10 p-3">
                            <p className="text-sm font-medium text-ink">{ENGINES[eid].label}</p>
                            <ul className="mt-2 space-y-2">
                              {subjectCourses.length === 0 && (
                                <li className="text-xs text-ink-soft">
                                  No {ENGINES[eid].label} course yet —{" "}
                                  <Link href="/courses/new" className="text-accent underline">add one</Link>.
                                </li>
                              )}
                              {subjectCourses.map((c) => (
                                <li key={c.id}>
                                  <Link href={`/courses/${c.id}`} className="block rounded-lg p-2 transition hover:bg-accent/[0.04]">
                                    <p className="text-sm font-medium text-ink">{c.name}</p>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                      {c.subject && <Badge>{c.subject}</Badge>}
                                      {c.academic_level && <Badge>{c.academic_level}</Badge>}
                                      {c.term && <Badge>{c.term}</Badge>}
                                    </div>
                                    <p className="mt-1 text-xs text-ink-soft">
                                      {c.teacher_id && teacherName(c.teacher_id) ? `${teacherName(c.teacher_id)} · ` : ""}
                                      Added {fmtDate(c.created_at)}
                                    </p>
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {grouped.map((c) => (
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
              </section>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
