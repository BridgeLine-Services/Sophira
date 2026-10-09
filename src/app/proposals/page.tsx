import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import { ProposalsPanel } from "@/components/app/ProposalsPanel";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { ClipboardCheck } from "lucide-react";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * CHANGES (spec 2026-10-09 §4/§7): the global destination for the user's
 * change history, and — with ?course_id= — the SUBJECT-specific Changes
 * record. Pending profile updates still wait for the student's decision
 * here. Nothing is ever changed without approval, and a change in one
 * subject never rewrites another subject's memories.
 */
export default async function ProposalsPage({
  searchParams,
}: {
  searchParams?: { course_id?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Optional course context (subject-scoped Changes view).
  let course: { id: string; name: string; subject: string | null } | null = null;
  if (searchParams?.course_id) {
    const { data } = await supabase
      .from("courses")
      .select("id, name, subject")
      .eq("id", searchParams.course_id)
      .single();
    course = (data as { id: string; name: string; subject: string | null } | null) ?? null;
  }
  const subject = course?.subject ?? null;

  const [{ data: pending }, { data: decisions }, { data: patterns }, { data: memories }] =
    await Promise.all([
      supabase.from("profile_update_proposals").select("*").eq("status", "pending"),
      supabase
        .from("profile_update_proposals")
        .select("id, target_type, change_summary, status, created_at, decided_at, context")
        .neq("status", "pending")
        .order("decided_at", { ascending: false })
        .limit(30),
      supabase
        .from("learning_patterns")
        .select("id, kind, description, scope, subject, status, source, first_observed, last_observed")
        .order("last_observed", { ascending: false })
        .limit(30),
      supabase
        .from("student_memories")
        .select("id, category, statement, subject, status, origin, source, first_observed, last_observed, updated_at")
        .neq("status", "forgotten")
        .order("updated_at", { ascending: false })
        .limit(30),
    ]);

  const inScope = (item: { subject: string | null }) =>
    !subject || (item.subject ?? "").toLowerCase().includes(subject.toLowerCase()) || !item.subject;

  // Profile-update proposals target teacher/writing profiles and carry their
  // course context in `context`; in a subject view only show the ones that
  // belong to that course (honest scoping — never guess).
  const scopedDecisions = (decisions ?? []).filter((d) => {
    if (!course) return true;
    const ctx = (d as { context?: Record<string, unknown> | null }).context ?? {};
    return ctx.course_id === course.id || ctx.subject === subject;
  });
  const scopedPatterns = (patterns ?? []).filter((p) => inScope(p));
  const scopedMemories = (memories ?? []).filter((m) => inScope(m));

  return (
    <AppShell title={course ? `Changes — ${course.name}` : "Changes"} backHref={course ? `/courses/${course.id}` : "/dashboard"}>
      <div className="mb-4 space-y-1">
        <p className="text-sm text-ink-soft">
          A chronological record of meaningful changes to your learning profile — proposed updates,
          approved or rejected corrections, learning patterns, and memory updates. Keystrokes and
          temporary variation are never treated as permanent changes.
        </p>
        {subject && (
          <p className="text-xs text-ink-soft">
            Subject view: showing changes for {subject}. A change here never rewrites another
            subject&apos;s memories. <Link href="/proposals" className="font-medium text-accent underline">All changes</Link>
          </p>
        )}
      </div>

      {/* Pending: nothing changes until the student approves */}
      {(pending?.length ?? 0) === 0 ? (
        <Card className="mb-4">
          <CardContent className="p-4">
            <p className="text-sm text-ink-soft">
              No pending changes. When Sophira learns something from your feedback or documents,
              proposed profile updates appear here first — nothing changes without your approval.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="mb-6 space-y-3">
          <p className="text-sm text-ink-soft">{pending?.length} proposed update{pending?.length === 1 ? "" : "s"} awaiting your decision:</p>
          <ProposalsPanel />
        </div>
      )}

      {/* Decided proposals — the global profile-change history */}
      <section aria-label="Profile update decisions" className="mb-6">
        <h2 className="mb-2 text-base font-semibold text-ink">Profile update history</h2>
        {scopedDecisions.length === 0 ? (
          <p className="text-sm text-ink-soft">No decided profile updates yet.</p>
        ) : (
          <ul className="space-y-2">
            {scopedDecisions.map((d) => (
              <li key={d.id} className="rounded-card border border-ink/10 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={d.status === "approved" ? "success" : "neutral"}>{d.status}</Badge>
                  <span className="text-sm font-medium text-ink">{d.target_type} profile</span>
                  <span className="text-xs text-ink-soft">{fmtDate(d.decided_at ?? d.created_at)}</span>
                </div>
                <p className="mt-1 text-xs text-ink-soft">{d.change_summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Learning patterns timeline (subject-aware) */}
      <section aria-label="Learning pattern changes" className="mb-6">
        <h2 className="mb-2 text-base font-semibold text-ink">Learning patterns</h2>
        {scopedPatterns.length === 0 ? (
          <p className="text-sm text-ink-soft">No learning patterns recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {scopedPatterns.map((p) => (
              <li key={p.id} className="rounded-card border border-ink/10 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {p.subject && <Badge tone="accent">{p.subject}</Badge>}
                  <Badge tone="neutral">{p.scope}</Badge>
                  <Badge tone={p.status === "active" ? "success" : "neutral"}>{p.status}</Badge>
                  <span className="text-xs text-ink-soft">last observed {fmtDate(p.last_observed)}</span>
                </div>
                <p className="mt-1 text-sm text-ink">{p.description}</p>
                <p className="mt-0.5 text-xs text-ink-soft">Kind: {p.kind} · Source: {p.source}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Memory update timeline (subject-aware) */}
      <section aria-label="Memory changes" className="mb-6">
        <h2 className="mb-2 text-base font-semibold text-ink">Memory updates</h2>
        {scopedMemories.length === 0 ? (
          <p className="text-sm text-ink-soft">No memory updates yet.</p>
        ) : (
          <ul className="space-y-2">
            {scopedMemories.map((m) => (
              <li key={m.id} className="rounded-card border border-ink/10 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {m.subject && <Badge tone="accent">{m.subject}</Badge>}
                  <Badge tone="neutral">{m.category}</Badge>
                  <Badge tone={m.status === "active" ? "success" : "warn"}>{m.status}</Badge>
                  <span className="text-xs text-ink-soft">updated {fmtDate(m.updated_at)}</span>
                </div>
                <p className="mt-1 text-sm text-ink">{m.statement}</p>
                <p className="mt-0.5 text-xs text-ink-soft">Origin: {m.origin}{m.source ? ` · ${m.source}` : ""}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-soft">
          Manage and correct individual memories in{" "}
          <Link href={course ? `/learning?course_id=${course.id}` : "/learning"} className="text-accent underline">Learning / Memory</Link>.
        </p>
      </section>
    </AppShell>
  );
}
