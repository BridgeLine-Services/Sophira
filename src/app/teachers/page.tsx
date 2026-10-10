"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, EmptyState } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { GraduationCap } from "lucide-react";
import { subjectBySlug, classifyEngine } from "@/lib/courses/engines";
import type { Teacher } from "@/lib/types";

export default function TeachersPage() {
  const supabase = createClient();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [subjectSlug, setSubjectSlug] = useState<string | null>(null);
  const [subjectTeachers, setSubjectTeachers] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const slug = params.get("subject");
      setSubjectSlug(slug);
      const node = slug ? subjectBySlug(slug) : null;
      const [teacherRows, courseRows] = await Promise.all([
        supabase.from("teachers").select("*").order("created_at", { ascending: false }),
        node
          ? supabase.from("courses").select("teacher_id, subject")
          : Promise.resolve(null),
      ]);
      setTeachers((teacherRows.data as Teacher[]) ?? []);
      // Subject view: tag the teachers who teach the user's own courses in
      // this subject group. No teacher is hidden — data is only annotated.
      if (node && courseRows) {
        const ids = new Set<string>();
        for (const c of ((courseRows as { data?: { teacher_id: string | null; subject: string | null }[] }).data ?? [])) {
          if (c.teacher_id && c.subject && node.engines.includes(classifyEngine(c.subject))) ids.add(c.teacher_id);
        }
        setSubjectTeachers(ids);
      }
      setLoaded(true);
    })();
  }, [supabase]);

  const node = subjectSlug ? subjectBySlug(subjectSlug) : null;

  return (
    <AppShell
      title={node ? `Teachers — ${node.label}` : "Teachers"}
      backHref={node ? `/courses/${node.slug}` : undefined}
      actions={
        <Link href="/teachers/new">
          <Button size="sm">+ Add teacher</Button>
        </Link>
      }
    >
      {node && (
        <p className="mb-4 rounded-lg border border-ink/10 bg-paper p-3 text-sm text-ink-soft">
          Subject workspace view — {node.label}. Teachers who teach your {node.label} courses are
          tagged below; every teacher profile stays available because a teacher can mark work in
          more than one subject.
        </p>
      )}
      {loaded && teachers.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="h-6 w-6" />}
          title="No teachers yet"
          description="A teacher profile saves exactly how each teacher wants work done — methods, steps, notation, formats."
          action={<Link href="/teachers/new"><Button size="sm">Add a teacher</Button></Link>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {teachers.map((t) => (
            <Link key={t.id} href={`/teachers/${t.id}`} className="block">
              <Card className="transition hover:border-accent/40">
                <CardContent className="flex items-center gap-3 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <GraduationCap className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{t.name}</p>
                    {t.notes && <p className="truncate text-xs text-ink-soft">{t.notes}</p>}
                    <p className="mt-0.5 text-xs text-ink-soft">Added {fmtDate(t.created_at)}</p>
                  </div>
                  {node && subjectTeachers.has(t.id) && <Badge tone="accent">{node.label}</Badge>}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
