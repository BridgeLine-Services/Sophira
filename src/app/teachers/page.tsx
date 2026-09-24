"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Button, Card, CardContent, EmptyState } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { GraduationCap } from "lucide-react";
import type { Teacher } from "@/lib/types";

export default function TeachersPage() {
  const supabase = createClient();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase
      .from("teachers")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setTeachers(data ?? []);
        setLoaded(true);
      });
  }, [supabase]);

  return (
    <AppShell
      title="Teachers"
      actions={
        <Link href="/teachers/new">
          <Button size="sm">+ Add teacher</Button>
        </Link>
      }
    >
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
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
