import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { SignOutButton } from "@/components/app/SignOutButton";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, EmptyState } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { LearningGoals } from "@/components/dashboard/LearningGoals";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { buildActivityEvents } from "@/lib/activity/feed";
import {
  buildMilestones,
  buildProgress,
  buildRecommendations,
  buildResumeItems,
  buildUpcoming,
  countRows,
  overallProgress,
  readCount,
  readList,
  weekActivity,
  type StudySessionRow,
} from "@/lib/dashboard/overview";
import { Bell, BookOpen, ClipboardCheck, FileText, GraduationCap, HelpCircle, Library, PenLine, Settings, Smartphone, Sparkles, AlertTriangle } from "lucide-react";
import { safeLink } from "@/lib/notifications/store";
import LocalDateTime from "@/components/app/LocalDateTime";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const supabase = createClient();
  // Shared session validation (redirect-loop fix): a dead session is
  // cleared ONCE and sent to /login — it can never bounce back.
  const user = await requireUser(supabase);

  const { profile, reason: profileReason } = await readProfileWithRepair(supabase, user.id);
  if (!profile) {
    // LOOP-PROOF (fix #2, 2026-10-08): a VALID session with an unresolvable
    // profile previously redirected to /login — which the middleware
    // bounced right back to a guarded page, forever, rendering nothing
    // (the reported "blank dashboard" + endless reload). A valid session is
    // NEVER sent back to /login: the user gets an explicit, visible error
    // and a way out instead of a redirect war.
    return (
      <AppShell title="Account problem">
        <div className="mx-auto max-w-md space-y-3 py-10 text-center">
          <h1 className="text-xl font-semibold text-ink">Your account could not be loaded</h1>
          <p className="text-sm text-ink-soft">
            You are signed in, but your profile record could not be read. This
            is not a password problem — do not keep refreshing. Sign out and
            sign back in; if it persists, the account needs the operator&apos;s
            attention.
          </p>
          {profileReason && (
            <p className="text-xs text-ink-soft" role="note">
              Reason: {profileReason}
            </p>
          )}
          <SignOutButton />
        </div>
      </AppShell>
    );
  }
  if (profile.status === "revoked") redirect("/access-denied");
  // Role routing (workflow §23): owners land on the Owner Dashboard.
  // ?view=workspace lets the owner open their own personal workspace.
  const view = (await searchParams).view;
  if (profile.role === "owner" && view !== "workspace") redirect("/owner");
  if (!profile.onboarded) redirect("/onboarding");

  // Activity tracking for privacy-safe aggregate owner analytics.
  await supabase.from("profiles").update({ last_active_at: new Date().toISOString() }).eq("id", user.id).then(() => undefined);

  // RECENT ACTIVITY (owner-approved definition): derived from real rows only -
  // no click log, no surveillance - read through the RLS-scoped client.
  const [{ data: actAssignments }, actResponsesResult, { data: actNotebooks }, { data: actNotes }, actGoalsResult, { data: actCourses }, { data: actWriting }, { data: actNotifications }, { data: actFeedback }] = await Promise.all([
    supabase.from("assignments").select("id, title, status, mode, updated_at").order("updated_at", { ascending: false }).limit(12),
    // A conversation is a `responses` row; the assignment it belongs to is its destination,
    // so the assignment title and status travel with it (no second lookup, no invented thread).
    supabase.from("responses").select("id, assignment_id, created_at, assignments ( title, status )").order("created_at", { ascending: false }).limit(40),
    supabase.from("notebooks").select("id, title, created_at").order("created_at", { ascending: false }).limit(6),
    supabase.from("notebook_notes").select("id, notebook_id, created_at").order("created_at", { ascending: false }).limit(40),
    supabase.from("learning_goals").select("id, title, status, progress, target_date, updated_at").order("updated_at", { ascending: false }).limit(6),
    supabase.from("courses").select("id, name, created_at").order("created_at", { ascending: false }).limit(4),
    supabase.from("writing_profiles").select("updated_at, created_at").order("created_at", { ascending: false }).limit(1),
    supabase.from("member_notifications").select("id, title, body, link, created_at").eq("category", "account").order("created_at", { ascending: false }).limit(6),
    supabase.from("feedback").select("id, kind, created_at").order("created_at", { ascending: false }).limit(6),
  ]);
  // 2026-11-12: the goals rows serve the activity feed AND the progress/recommendation
  // logic, and a failed read must be visible rather than silently zero.
  const actGoals = actGoalsResult.data;
  const actResponses = actResponsesResult.data;
  const activityEvents = buildActivityEvents({
    assignments: actAssignments ?? [],
    responses: actResponses ?? [],
    assignmentTitles: Object.fromEntries((actAssignments ?? []).map((a) => [a.id, a.title ?? ""])),
    notebooks: actNotebooks ?? [],
    notebookNotes: actNotes ?? [],
    notebookTitles: Object.fromEntries((actNotebooks ?? []).map((n) => [n.id, n.title ?? ""])),
    goals: actGoals ?? [],
    courses: actCourses ?? [],
    writingProfileAt: actWriting?.[0]?.updated_at ?? null,
    notifications: actNotifications ?? [],
    feedback: actFeedback ?? [],
  });

  const now = new Date();
  /*
   * HONESTY (2026-11-12): these results are kept whole, not destructured down to `data`.
   * The dashboard used to write `courses?.length ?? 0`, so a query that FAILED rendered as a
   * confident zero - "you have no courses", "nothing in progress" - on the one screen whose
   * job is to tell someone where they stand. Each read is now turned into a `ready` or
   * `unavailable` value below (see src/lib/dashboard/overview.ts), and the two are never
   * shown the same way.
   */
  const [
    coursesResult,
    teachersResult,
    writingProfileResult,
    assignmentsResult,
    proposalsResult,
    recentFeedbackResult,
    patternsResult,
    notebooksResult,
    datedAssignmentsResult,
    activeCountResult,
    completedCountResult,
    lecturesResult,
    studyPlansResult,
  ] = await Promise.all([
    supabase.from("courses").select("*").order("created_at", { ascending: false }),
    supabase.from("teachers").select("id, name, notes").is("archived_at", null).order("created_at", { ascending: false }),
    supabase.from("writing_profiles").select("*").order("created_at", { ascending: false }).limit(1),
    supabase.from("assignments").select("id, title, mode, status, due_at, updated_at").order("updated_at", { ascending: false }).limit(6),
    supabase.from("profile_update_proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("feedback")
      .select("id, kind, comment, created_at, assignments ( title )")
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("learning_patterns")
      .select("id", { count: "exact", head: true })
      .in("status", ["candidate", "active", "recurring", "temporary"]),
    // Command center (2026-11-12): notebooks + deadlines, straight from the
    // user's own rows - never invented, and honest empty states below.
    supabase.from("notebooks").select("id, title, updated_at").is("archived_at", null).order("updated_at", { ascending: false }).limit(3),
    // Every dated assignment that is not finished, overdue included: "upcoming work" that
    // quietly drops what you already missed is not honest about your week.
    supabase.from("assignments").select("id, title, due_at, urgency, status").not("due_at", "is", null).neq("status", "completed").order("due_at", { ascending: true }).limit(10),
    supabase.from("assignments").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("assignments").select("id", { count: "exact", head: true }).eq("status", "completed"),
    // Lecture studio recordings: a "continue" link is only offered for one that can be
    // reopened there, so the row is read from the member's own media assets.
    supabase.from("media_assets").select("id, original_filename, status, updated_at").order("updated_at", { ascending: false }).limit(4),
    // Persisted study plans (work_schedules). This is the only scheduling record Sophira has:
    // there is no calendar, no reminder table and no events feed, so Upcoming Work claims
    // nothing beyond real deadlines and real plans.
    supabase
      .from("work_schedules")
      .select("id, assignment_id, deadline, status, assignments ( title )")
      .in("status", ["planned", "running", "paused"])
      .order("deadline", { ascending: true })
      .limit(10),
  ]);

  const courses = coursesResult.data;
  const teachers = teachersResult.data;
  const writingProfile = writingProfileResult.data;
  const assignments = assignmentsResult.data;
  const pendingProposals = proposalsResult.count;
  const recentFeedback = recentFeedbackResult.data;
  const activePatterns = patternsResult.count;

  /**
   * The four decisions this page makes, taken in ONE place so they can be tested:
   * how the progress tiles read, what can be resumed, what is due, and what to do next.
   * Every one of them distinguishes "you have none" from "we could not read it".
   */
  const notebooksRead = { ...readList(notebooksResult), capped: true };
  const goalsRead = readList(actGoalsResult);
  const completedRead = readCount(completedCountResult);
  const activeRead = readCount(activeCountResult);

  /**
   * A conversation's destination is the assignment it was held in, so the assignment title is
   * needed to name it. It arrives embedded with the response row; a response with no
   * assignment is a one-off question that has no screen to restore, and is simply not offered.
   */
  type ConversationRow = {
    id: string;
    assignment_id: string | null;
    created_at: string | null;
    assignments?: { title?: string | null; status?: string | null } | Array<{ title?: string | null; status?: string | null }> | null;
  };
  const conversationRows = (actResponses ?? []) as ConversationRow[];
  const conversationTitles: Record<string, string> = {};
  for (const row of conversationRows) {
    const related = Array.isArray(row.assignments) ? row.assignments[0] : row.assignments;
    if (row.assignment_id && related?.title) conversationTitles[row.assignment_id] = related.title;
  }

  type PlanRow = {
    id: string;
    assignment_id: string | null;
    deadline: string | null;
    status: string | null;
    assignments?: { title?: string | null } | Array<{ title?: string | null }> | null;
  };
  const planRows = ((studyPlansResult.data ?? []) as PlanRow[]).map((plan) => {
    const related = Array.isArray(plan.assignments) ? plan.assignments[0] : plan.assignments;
    return { ...plan, title: related?.title ?? null } satisfies StudySessionRow;
  });

  const progress = buildProgress({
    completed: completedRead,
    active: activeRead,
    courses: countRows(coursesResult),
    teachers: countRows(teachersResult),
    notebooks: notebooksRead,
    goals: goalsRead,
  });
  const overall = overallProgress(completedRead, activeRead);
  const milestones = buildMilestones({
    completed: completedRead,
    notebooks: notebooksRead,
    lectures: readList(lecturesResult),
    goals: goalsRead,
    courses: countRows(coursesResult),
  });
  const week = weekActivity(activityEvents, now);
  const weekMax = Math.max(1, ...week.map((d) => d.count));
  const weekTotal = week.reduce((total, d) => total + d.count, 0);
  const resume = buildResumeItems(
    {
      assignments: readList(assignmentsResult),
      notebooks: notebooksRead,
      lectures: readList(lecturesResult),
      goals: goalsRead,
      responses: readList(actResponsesResult),
      assignmentTitles: conversationTitles,
    },
    4,
  );
  const upcoming = buildUpcoming(readList(datedAssignmentsResult), now, 4, {
    state: studyPlansResult.error ? "unavailable" : "ready",
    rows: planRows,
  });
  const recommendations = buildRecommendations({
    now,
    assignments: readList(assignmentsResult),
    notebooks: readList(notebooksResult),
    lectures: readList(lecturesResult),
    goals: goalsRead,
    courses: readList(coursesResult),
    writingProfileApproved: writingProfile?.[0]?.status === "approved",
  });

  /**
   * MY NOTIFICATIONS AT A GLANCE (2026-11-13).
   *
   * Only this member's own rows are read, and RLS says the same thing, so nothing here can
   * describe anyone else's invitation, role or account. Read separately because a deployment
   * without migration 0042 must not break the dashboard: if the table is missing the page says
   * it could not check, which is different from "nothing new".
   */
  const [{ count: unreadNotices, error: unreadError }, { data: latestNotice, error: latestError }] = await Promise.all([
    supabase.from("member_notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    supabase
      .from("member_notifications")
      .select("id, title, created_at, link")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const notificationsReadable = !unreadError && !latestError;
  const latest = latestNotice?.[0] ?? null;
  const latestHref = latest ? safeLink(latest.link) : null;

  const teacherName = (id: string | null) =>
    id ? (teachers?.find((t) => t.id === id)?.name ?? null) : null;
  const wp = writingProfile?.[0] ?? null;
  const greetingName = profile.display_name ? `, ${profile.display_name.split(" ")[0]}` : "";

  return (
    <AppShell title={`Welcome${greetingName}`} role={profile.role}>
      <div className="dash-page">
        {/* HERO (2026-11-12): the owner's purple reference. Who you are, where your learning
            stands, and the two things you can start right now - before any navigation. */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="dash-eyebrow">Your learning home</p>
            <h1 className="dash-hero-title mt-1">Welcome back{greetingName}!</h1>
            <p className="dash-hero-sub mt-2 max-w-xl">{overall.detail}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/assignments/new" className="dash-cta">
              <FileText className="h-4 w-4" aria-hidden /> Start an assignment
            </Link>
            <Link href="/assignments/new?mode=learn" className="dash-cta-quiet">
              <HelpCircle className="h-4 w-4" aria-hidden /> Ask a question
            </Link>
          </div>
        </header>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          {/* Your learning path: the documented calculation, drawn. */}
          <div className="dash-glass p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="dash-eyebrow">Your learning path</p>
              <p className="dash-path-value">
                {overall.percent === null ? "Nothing to measure yet" : `${overall.percent}% of assignments finished`}
              </p>
            </div>
            <div
              className="dash-path-track mt-3"
              role="img"
              aria-label={
                overall.percent === null
                  ? "Overall learning progress is not available yet"
                  : `Overall learning progress: ${overall.percent} percent of assignments finished`
              }
            >
              <div className="dash-path-fill" style={{ width: `${overall.percent ?? 0}%` }} />
            </div>
            <p className="dash-path-basis mt-2">{overall.basis}</p>
          </div>

          {/* This week: seven days of the same events the activity feed shows. */}
          <div className="dash-glass p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="dash-eyebrow">This week</p>
              <p className="dash-note">
                {weekTotal === 0 ? "No activity recorded yet" : `${weekTotal} thing${weekTotal === 1 ? "" : "s"} recorded`}
              </p>
            </div>
            <div
              className="dash-bars mt-3"
              role="img"
              aria-label={`Recorded activity over the last seven days: ${week.map((day) => `${day.label} ${day.count}`).join(", ")}`}
            >
              {week.map((day) => (
                <div key={day.key} className="dash-bar-col">
                  <div
                    className="dash-bar"
                    data-on={day.count > 0}
                    style={{ height: `${day.count === 0 ? 4 : Math.max(8, Math.round((day.count / weekMax) * 44))}px` }}
                  />
                  <p className="dash-bar-day">{day.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* MY PROGRESS: the summary cards. Each tile carries its own state, so "you have none
            yet" and "we could not read it" can never look the same. */}
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {progress.map((stat) => (
            <div key={stat.key} className="dash-glass p-4">
              <p className="dash-stat-label">{stat.label}</p>
              <p
                className="dash-stat-value mt-1"
                aria-label={stat.state === "unavailable" ? `${stat.label}: not available right now` : `${stat.label}: ${stat.value}`}
              >
                {stat.value}
              </p>
              <p className="dash-stat-note mt-1">{stat.note}</p>
            </div>
          ))}
        </div>

        {/* MILESTONES: counters over real rows, each showing how far along it is. */}
        <section className="dash-panel mt-3" aria-labelledby="dashboard-milestones-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="dashboard-milestones-heading" className="dash-panel-title">Learning milestones</h2>
            <p className="text-xs text-ink-soft">
              {milestones.state === "ready"
                ? `${milestones.achieved} of ${milestones.total} reached`
                : "We couldn't check every milestone just now, so this list may be short."}
            </p>
          </div>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {milestones.items.map((milestone) => (
              <li
                key={milestone.id}
                className={
                  milestone.achieved
                    ? "rounded-xl border border-accent/30 bg-accent-soft/50 p-3"
                    : "rounded-xl border border-line bg-card-elevated/40 p-3"
                }
              >
                <p className="flex items-start gap-1.5 text-sm font-medium text-ink">
                  <span aria-hidden className={milestone.achieved ? "text-accent" : "text-ink-soft"}>
                    {milestone.achieved ? "★" : "☆"}
                  </span>
                  <span className="min-w-0">{milestone.label}</span>
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">{milestone.detail}</p>
              </li>
            ))}
          </ul>
          {milestones.next && (
            <p className="mt-3 text-xs text-ink-soft">
              Next up: <span className="font-medium text-ink">{milestones.next.label}</span> ({milestones.next.detail}).
            </p>
          )}
        </section>
        {/* CONTINUE WHERE YOU LEFT OFF (2026-11-12): only destinations that genuinely
            reopen, newest first, with an honest note when a source could not be read. */}
        <section aria-labelledby="dashboard-resume-heading" className="dash-panel">
          <h2 id="dashboard-resume-heading" className="dash-panel-title">Continue where you left off</h2>
          <p className="dash-panel-sub mb-3 mt-1">The work you were last in, newest first. Each one opens the screen it belongs to.</p>
          {resume.items.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {resume.items.map((item) => (
                <Link key={item.id} href={item.href} className="block">
                  <Card className="transition hover:border-accent/40">
                    <CardContent className="flex items-center gap-3 p-4">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                        {item.kind === "assignment" ? <FileText className="h-4 w-4" />
                          : item.kind === "notebook" ? <BookOpen className="h-4 w-4" />
                            : item.kind === "lecture" ? <Library className="h-4 w-4" />
                              : <ClipboardCheck className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink">{item.title}</p>
                        <p className="text-xs text-ink-soft">{item.detail} · updated {fmtDate(item.at)}</p>
                      </div>
                      <span className="shrink-0 text-sm text-accent">{item.action} →</span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-4 text-sm text-ink-soft">
                Nothing to resume yet. Start an assignment above and it will appear here, ready to
                pick up where you stopped.
              </CardContent>
            </Card>
          )}
          {resume.unreadable.length > 0 && (
            <p className="mt-2 text-xs text-ink-soft">
              Sophira couldn&apos;t read your {resume.unreadable.join(" or ")} just now, so something
              recent may be missing from this list. Nothing has been lost.
            </p>
          )}
        </section>


        {/* UPCOMING WORK (2026-11-12): real deadlines only, overdue first, in plain words. */}
        <section aria-labelledby="dashboard-upcoming-heading" className="dash-panel">
          <h2 id="dashboard-upcoming-heading" className="dash-panel-title">Upcoming work</h2>
          <p className="dash-panel-sub mb-3 mt-1">Deadlines and saved study plans, most urgent first, with anything overdue at the top.</p>
          {upcoming.unreadable ? (
            <Card>
              <CardContent className="p-4 text-sm text-ink-soft">
                Sophira couldn&apos;t read your deadlines just now, so this list may be incomplete.
                Nothing has been lost — try again in a moment.
              </CardContent>
            </Card>
          ) : upcoming.items.length > 0 ? (
            <Card>
              <CardContent className="divide-y divide-line p-0">
                {upcoming.items.map((a) => (
                  <Link key={a.id} href={a.href} className="flex items-center gap-3 p-4 transition hover:bg-accent-soft/40">
                    <span
                      className={
                        a.tone === "overdue"
                          ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger"
                          : "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"
                      }
                    >
                      <AlertTriangle className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{a.title}</p>
                      <p className="text-xs text-ink-soft">{a.when}</p>
                    </div>
                    <span className="shrink-0 text-xs text-ink-soft">{fmtDate(a.due_at)}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-4 text-sm text-ink-soft">
                No deadlines on file. Set a due date when you start an assignment and it will show
                up here.
              </CardContent>
            </Card>
          )}
          {upcoming.studyUnreadable && (
            <p className="mt-2 text-xs text-ink-soft">
              Sophira couldn&apos;t read your saved study plans just now, so a planned session may be
              missing from this list. Nothing has been lost.
            </p>
          )}
        </section>


        {/* SOPHIRA'S RECOMMENDATIONS (2026-11-12): worked out from this member's own rows,
            never from an AI guess, and each one says WHY it is being suggested. */}
        <section aria-labelledby="dashboard-recommendations-heading" className="dash-panel">
          <h2 id="dashboard-recommendations-heading" className="dash-panel-title flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Sophira&apos;s Recommendations
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            What to work on next, based on what is actually in your workspace.
          </p>
          {recommendations.items.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {recommendations.items.map((rec) => (
                <li key={rec.id}>
                  <Card className="transition hover:border-accent/40">
                    <CardContent className="flex flex-wrap items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-ink">{rec.title}</p>
                        <p className="text-sm text-ink-soft">{rec.reason}</p>
                      </div>
                      <Link
                        href={rec.href}
                        className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-accent hover:border-accent/60 hover:bg-accent-soft/40"
                      >
                        {rec.action}
                      </Link>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            <Card className="mt-3">
              <CardContent className="p-4 text-sm text-ink-soft">{recommendations.note}</CardContent>
            </Card>
          )}
          <p className="mt-2 text-xs text-ink-soft">
            These come from your own assignments, notebooks and goals. Sophira does not guess at
            what you find difficult, and nothing here needs the AI to be available.
          </p>
        </section>


        <div id="learning-goals" className="dash-panel">
          <LearningGoals />
        </div>


<div className="dash-panel">
        <RecentActivity events={activityEvents} />

        </div>

        <div className="dash-panel">
        {/* Primary actions */}
        <section aria-labelledby="dashboard-start-heading">
          <h2 id="dashboard-start-heading" className="dash-panel-title">Ways to work</h2>
          <p className="dash-panel-sub mb-3 mt-1">Start with an assignment or ask a question. Your courses and teacher preferences stay in context.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <Link
              href="/assignments/new"
              className="group flex min-h-24 flex-col justify-center gap-1.5 rounded-card bg-gradient-to-br from-accent to-accent-deep p-5 text-on-accent shadow-[0_12px_24px_rgba(81,69,232,0.18)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(81,69,232,0.24)] active:scale-[0.99]"
            >
              <span className="flex items-center gap-2 font-semibold">
                <FileText className="h-5 w-5" /> Start an assignment
              </span>
              <span className="text-sm text-on-accent/85">Upload, paste, or photograph your instructions. Sophira will follow your teacher&apos;s rules.</span>
            </Link>
            <Link
              href="/assignments/new?mode=learn"
              className="flex min-h-24 flex-col justify-center gap-1.5 rounded-card border border-line bg-card p-5 shadow-[0_1px_3px_rgba(37,43,58,0.05)] transition duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-md active:scale-[0.99]"
            >
              <span className="flex items-center gap-2 font-semibold text-ink">
                <HelpCircle className="h-5 w-5 text-accent" /> Ask a question
              </span>
              <span className="text-sm text-ink-soft">Any subject, any level — explained the way you like.</span>
            </Link>
          </div>
        </section>

        </div>

        <div className="dash-panel">
        {/* More ways to work — quick launch (all modes are real, from MODES) */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            { id: "check", label: "Check my work" },
            { id: "writing", label: "Writing" },
            { id: "study", label: "Study" },
            { id: "explain", label: "Explain simply" },
            { id: "custom", label: "Custom help" },
          ].map((m) => (
            <Link
              key={m.id}
              href={`/assignments/new?mode=${m.id}`}
              className="flex min-h-16 items-center justify-center rounded-card border border-line bg-card p-2 text-center text-sm font-medium text-ink shadow-sm transition active:scale-[0.99] hover:border-accent/40"
            >
              {m.label}
            </Link>
          ))}
        </div>

        </div>

        {/* YOUR WORKSPACE: everything that keeps the learning running. Deliberately below the
            journey, because these are settings, not progress. */}
        <div className="pt-2">
          <p className="dash-eyebrow">Your workspace</p>
          <p className="dash-hero-sub mt-1">Courses, teachers, your writing voice and notifications.</p>
        </div>
        <div className="dash-panel">
        {/* Your own notifications: a summary, not an administrative feed. */}
        <section aria-labelledby="dashboard-notifications-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="dashboard-notifications-heading"
              className="flex items-center gap-2 text-base font-semibold text-ink"
            >
              <Bell className="h-4 w-4 text-accent" aria-hidden /> Notifications
            </h2>
            <Link href="/notifications" className="text-sm font-medium text-accent hover:underline">
              See all notifications
            </Link>
          </div>
          <div className="mt-3 rounded-card border border-line bg-card p-4">
            {!notificationsReadable ? (
              <p className="text-sm text-ink-soft">
                Sophira couldn&apos;t check your notifications just now. Nothing has been lost — open
                your notifications to try again.
              </p>
            ) : (unreadNotices ?? 0) === 0 && !latest ? (
              <p className="text-sm text-ink-soft">
                Nothing yet. Invitation news, role changes and Canvas updates will appear here.
              </p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-ink">
                  {(unreadNotices ?? 0) > 0
                    ? `${unreadNotices} unread notification${unreadNotices === 1 ? "" : "s"}`
                    : "No unread notifications"}
                </p>
                {latest && (
                  <p className="text-sm text-ink-soft">
                    Most recent:{" "}
                    {latestHref ? (
                      <Link href={latestHref} className="font-medium text-accent hover:underline">
                        {latest.title}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">{latest.title}</span>
                    )}
                    {" · "}
                    <LocalDateTime iso={latest.created_at} />
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        </div>

        <div className="dash-panel">
        {/* What I remember — real counts from your data (workflow §6) */}
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">What I remember</h2>
        <p className="text-sm text-ink-soft">
          Working from <strong className="text-ink">{courses?.length ?? 0} course{(courses?.length ?? 0) === 1 ? "" : "s"}</strong>,{" "}
          <strong className="text-ink">{teachers?.length ?? 0} teacher{(teachers?.length ?? 0) === 1 ? "" : "s"}</strong> with their profiles,{" "}
          {wp
            ? <>your <Link href="/writing" className="text-accent hover:underline">approved Writing Profile</Link>, and</>
            : <>no <Link href="/writing" className="text-accent hover:underline">Writing Profile</Link> yet, and</>}{" "}
          <strong className="text-ink">{activePatterns ?? 0} learned pattern{(activePatterns ?? 0) === 1 ? "" : "s"}</strong>{" "}
          (<Link href="/learning" className="text-accent hover:underline">corrections &amp; methods</Link>).
        </p>

        </div>

        <div className="dash-panel">
        {/* Pending profile changes */}
        {(pendingProposals ?? 0) > 0 && (
          <Link href="/proposals" className="block">
            <Card className="border-accent/40 bg-accent-soft/40 transition hover:border-accent">
              <CardContent className="flex items-center gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
                  <ClipboardCheck className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {pendingProposals} proposed profile update{pendingProposals === 1 ? "" : "s"} waiting for you
                  </p>
                  <p className="text-xs text-ink-soft">Nothing changes until you approve or reject.</p>
                </div>
                <span className="text-sm text-accent">Review →</span>
              </CardContent>
            </Card>
          </Link>
        )}

        </div>

        <div className="dash-panel">
        {/* Learning & corrections shortcut */}
        {(activePatterns ?? 0) > 0 && (
          <Link href="/learning" className="block">
            <Card className="transition hover:border-accent/40">
              <CardContent className="flex items-center gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink/5 text-accent">
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {activePatterns} learned pattern{(activePatterns ?? 0) === 1 ? "" : "s"} being applied to your work
                  </p>
                  <p className="text-xs text-ink-soft">Recurring mistakes, methods, and corrections — review or correct them any time.</p>
                </div>
                <span className="text-sm text-accent">Review →</span>
              </CardContent>
            </Card>
          </Link>
        )}

        </div>

        <div className="dash-panel">
        <div className="grid gap-6 xl:grid-cols-2">
        {/* My courses */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">My Courses</h2>
            {(courses?.length ?? 0) > 0 && (
              <Link href="/courses" className="text-sm text-accent hover:underline">All courses</Link>
            )}
          </div>
          {courses?.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
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
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
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

        </div>
        </div>

        <div className="dash-panel">
        {/* Writing profile */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">My Writing Profile</h2>
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

        </div>

        <div className="dash-panel">
        {/* Recent assignments */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">Recent assignments</h2>
          {assignments?.length ? (
            <div className="divide-y divide-ink/5 rounded-card border border-line bg-card">
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

        </div>

        <div className="dash-panel">
        {/* Recent feedback */}
        {recentFeedback && recentFeedback.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">Recent feedback</h2>
            <div className="divide-y divide-ink/5 rounded-card border border-line bg-card">
              {recentFeedback.map((f) => (
                <div key={f.id} className="p-4">
                  <p className="truncate text-sm text-ink">{f.comment}</p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {fmtDate(f.created_at)}
                    {Array.isArray(f.assignments) && f.assignments[0]?.title ? ` · ${f.assignments[0].title}` : ""}
                    {typeof f.assignments === "object" && !Array.isArray(f.assignments) && (f.assignments as { title?: string })?.title ? ` · ${(f.assignments as { title?: string }).title}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        </div>

        {/* Footer links */}
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-5 text-sm text-ink-soft">
          <Link href="/library" className="flex items-center gap-1.5 hover:text-accent"><Library className="h-4 w-4" /> Library</Link>
          <Link href="/settings" className="flex items-center gap-1.5 hover:text-accent"><Settings className="h-4 w-4" /> Settings</Link>
          <Link href="/install" className="flex items-center gap-1.5 hover:text-accent"><Smartphone className="h-4 w-4" /> Install on your phone</Link>
        </nav>
      </div>
    </AppShell>
  );
}
