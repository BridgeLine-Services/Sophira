import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { subjectBySlug, subjectTools, classifyEngine, subjectToolUrl } from "@/lib/courses/engines";
import { Wrench, ChevronRight } from "lucide-react";

/**
 * SUBJECT WORKSPACE (nav spec 2026-10-09): each subject opens a real
 * workspace — its engine, its spec-listed tools, and the user's own
 * courses for the subject. Pure navigation over existing pages; nothing
 * here duplicates an engine or stores data.
 */
export async function SubjectWorkspace({ slug }: { slug: string }) {
  const node = subjectBySlug(slug);
  if (!node) notFound();

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: courses } = await supabase
    .from("courses")
    .select("id, name, subject")
    .order("name");
  const groupCourses = (courses ?? []).filter(
    (c: { id: string; name: string; subject: string | null }) =>
      node.engines.includes(classifyEngine(c.subject))
  );

  // Science renders a landing page: the parent relationship is preserved,
  // and its three child workspaces are the destinations.
  if (node.children) {
    return (
      <AppShell title={node.label} backHref="/courses">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">Science</Badge>
            <Badge tone="neutral">Parent subject</Badge>
          </div>
          <p className="max-w-2xl text-ink-soft">
            Scientific reasoning, formulas, calculations, units, graphs, and data
            interpretation — the Science engine uses the mathematical capabilities
            required for science coursework. Biology, Chemistry, and Physics each
            keep their own workspace, library, memory, and changes below Science.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {node.children.map((child) => (
              <Card key={child.key}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    {child.label}
                    <ChevronRight className="h-4 w-4 text-ink-soft" aria-hidden />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-ink-soft">
                    Workspace, library, memory, and changes scoped to {child.label}.
                  </p>
                  <Link href={`/courses/${child.slug}`} className="mt-3 inline-flex items-center rounded-md bg-accent px-3 py-2 text-sm font-medium text-white">
                    Open {child.label}
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  // Union across the node's engines: the Science parent shows the combined
  // Biology + Chemistry + Physics tools (incl. Scientific Calculations).
  const tools = subjectTools(node.engines);

  return (
    <AppShell title={node.label} backHref="/courses">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{node.label}</Badge>
          <Badge tone="neutral">Subject workspace</Badge>
        </div>
        {slug === "foreign-language" && <LanguageNote />}

        <section aria-labelledby="subject-tools" className="space-y-3">
          <h2 id="subject-tools" className="flex items-center gap-2 text-lg font-semibold text-ink">
            <Wrench className="h-5 w-5" aria-hidden /> {node.label} tools
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tools.map((tool) => (
              <Card key={tool.label}>
                <CardHeader>
                  <CardTitle>{tool.label}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-ink-soft">{tool.description}</p>
                  <Link href={subjectToolUrl(tool, node.slug)} className="inline-flex items-center rounded-md bg-accent px-3 py-2 text-sm font-medium text-white">
                    {tool.label}
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section aria-labelledby="subject-courses" className="space-y-3">
          <h2 id="subject-courses" className="text-lg font-semibold text-ink">
            Your {node.label} courses
          </h2>
          {groupCourses.length === 0 ? (
            <p className="rounded-lg border border-ink/10 bg-paper p-4 text-sm text-ink-soft">
              You have no {node.label.toLowerCase()} courses yet. The tools above work
              without one — add a course on the{" "}
              <Link href="/courses" className="text-accent underline">Courses page</Link>{" "}
              to keep assignments, teachers, and materials for this subject together.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {groupCourses.map((c: { id: string; name: string; subject: string | null }) => (
                <Card key={c.id}>
                  <CardHeader>
                    <CardTitle>{c.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {c.subject ? <Badge tone="neutral">{c.subject}</Badge> : null}
                    <Link href={`/courses/${c.id}`} className="inline-flex items-center rounded-md border border-ink/15 px-3 py-2 text-sm font-medium text-ink">
                      Open course workspace
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function LanguageNote() {
  return (
    <p className="max-w-2xl text-ink-soft">
      Choose your target language on the{" "}
      <Link href="/courses/foreign-language/language-selector" className="text-accent underline">
        Language Selector
      </Link>{" "}
      — the selection is saved to your account and applied to the language tools.
    </p>
  );
}
