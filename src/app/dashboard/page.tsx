import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, EmptyState } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { BookOpen, FileText, GraduationCap, HelpCircle, Library, PenLine, Settings, Smartphone } from "lucide-react";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/login");
  if (!profile.onboarded) redirect("/onboarding");

  const [{ data: courses }, { data: teachers }, { data: writingProfile }, { data: assignments }] = await Promise.all([
    supabase.from("courses").select("*").order("created_at", { ascending: false }),
    supabase.from("teachers").select("id, name, notes").order("created_at", { ascending: false }),
    supabase.from("writing_profiles").select("*").order("created_at", { ascending: false }).limit(1),
    supabase.from("assignments").select("id, title, mode, status, updated_at").order("updated_at", { ascending: false }).limit(5),
  ]);

  const teacherName = (id: string | null) =>
    id ? (teachers?.find((t) => t.id === id)?.name ?? null) : null;
  const wp = writingProfile?.[0] ?? null;
  const greetingName = profile.display_name ? `, ${profile.display_name.split(" ")[0]}` : "";

  return (
    <AppShell title={`Welcome${greetingName}`}>
      <div className="space-y-8">
        {/* Primary actions */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/assignments/new"
            className="flex min-h-24 flex-col justify-center gap-1 rounded-card bg-accent p-4 text-white shadow-sm transition active:scale-[0.99]"
          >
            <span className="flex items-center gap-2 font-semibold">
              <FileText className="h-5 w-5" /> Start an assignment
            </span>
            <span className="text-sm text-white/80">Upload it, paste it, or photograph it — I&apos;ll follow your teacher&apos;s rules.</span>
          </Link>
          <Link
            href="/assignments/new?mode=learn"
            className="flex min-h-24 flex-col justify-center gap-1 rounded-card border border-ink/10 bg-white p-4 shadow-sm transition active:scale-[0.99]"
          >
            <span className="flex items-center gap-2 font-semibold text-ink">
              <HelpCircle className="h-5 w-5 text-accent" /> Ask a question
            </span>
            <span className="text-sm text-ink-soft">Any subject, any level — explained the way you like.</span>
          </Link>
        </div>

        {/* My courses */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">My Courses</h2>
            {(courses?.length ?? 0) > 0 && (
              <Link href="/courses" className="text-sm text-accent hover:underline">All courses</Link>
            )}
          </div>
          {courses?.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {courses.slice(0, 3).map((c) => (
                <Link key={c.id} href={`/courses/${c.id}`} className="block">
                  <Card className="transition hover:border-accent/40">
                    <CardContent className="p-4">
                      <p className="font-medium text-ink">{c.name}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {c.subject && <Badge>{c.subject}</Badge>}
                        {c.academic_level && <Badge>{c.academic_level}</Badge>}
                        {c.teacher_id && teacherName(c.teacher_id) && (
                          <span className="text-xs text-ink-soft">· {teacherName(c.teacher_id)}</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<BookOpen className="h-6 w-6" />}
              title="No courses yet"
              description="Courses tell Sophira which subject, level, and teacher rules to use."
              action={<Link href="/courses/new"><Button size="sm">Add your first course</Button></Link>}
            />
          )}
        </section>

        {/* My teachers */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">My Teachers</h2>
            {(teachers?.length ?? 0) > 0 && (
              <Link href="/teachers" className="text-sm text-accent hover:underline">All teachers</Link>
            )}
          </div>
          {teachers?.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {teachers.slice(0, 3).map((t) => (
                <Link key={t.id} href={`/teachers/${t.id}`} className="block">
                  <Card className="transition hover:border-accent/40">
                    <CardContent className="flex items-center gap-3 p-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                        <GraduationCap className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{t.name}</p>
                        {t.notes && <p className="truncate text-xs text-ink-soft">{t.notes}</p>}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<GraduationCap className="h-6 w-6" />}
              title="No teachers yet"
              description="A teacher profile saves exactly how each teacher wants work done."
              action={<Link href="/teachers/new"><Button size="sm">Add a teacher</Button></Link>}
            />
          )}
        </section>

        {/* Writing profile */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">My Writing Profile</h2>
          <Card>
            <CardContent className="flex items-start gap-3 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                <PenLine className="h-5 w-5" />
              </span>
              {wp?.status === "approved" && wp.guidance ? (
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="success">Approved</Badge>
                    <span className="text-xs text-ink-soft">Version {wp.version}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm text-ink-soft">{wp.guidance}</p>
                  <Link href="/writing" className="mt-2 inline-block text-sm text-accent hover:underline">View &amp; manage</Link>
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">I don&apos;t know your writing style yet</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    I won&apos;t guess your voice. Add a few writing samples and approve a Writing Profile — then writing tasks sound like you.
                  </p>
                  <Link href="/writing" className="mt-2 inline-block text-sm text-accent hover:underline">Add writing samples</Link>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Recent assignments */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">Recent assignments</h2>
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
              icon={<FileText className="h-6 w-6" />}
              title="Nothing yet — start your first assignment"
              description="Your recent work and conversations will show up here."
            />
          )}
        </section>

        {/* Footer links */}
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink/10 pt-5 text-sm text-ink-soft">
          <Link href="/library" className="flex items-center gap-1.5 hover:text-accent"><Library className="h-4 w-4" /> Library</Link>
          <Link href="/settings" className="flex items-center gap-1.5 hover:text-accent"><Settings className="h-4 w-4" /> Settings</Link>
          <Link href="/install" className="flex items-center gap-1.5 hover:text-accent"><Smartphone className="h-4 w-4" /> Install on your phone</Link>
        </nav>
      </div>
    </AppShell>
  );
}
