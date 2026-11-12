import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { AppShell } from "@/components/app/AppShell";
import { TrendChart } from "@/components/dashboard/TrendChart";
import { dailySeries, weekActivity } from "@/lib/dashboard/overview";
import { readActivityDaily } from "@/lib/dashboard/activity";
import { Badge, Card, CardContent } from "@/components/ui";
import { Briefcase, CheckCircle2, ClipboardList, Users } from "lucide-react";
import { canUseTesterFeatures, canAccessOwnerSecurity } from "@/lib/auth/permissions";
import { isStaff, normalizeRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

const MEMBER_ROLE_LABEL: Record<string, string> = {
  user: "Member",
  tester: "Tester",
  co_owner: "Co-Owner",
  owner: "Owner",
};

/**
 * CO-OWNER WORKSPACE (2026-11-12).
 *
 * The authority here is not invented: src/lib/auth/permissions.ts already defines what a
 * Co-Owner may do (member directory, invitations, access requests, role changes within
 * limits, suspend/remove members and testers) and what stays Owner-only (security, billing,
 * AI providers, integrations, database, ownership transfer). This page renders exactly that -
 * no Owner-only control is linked, and the page itself re-checks server-side.
 */
export default async function CoOwnerPage() {
  const supabase = createClient();
  const user = await requireUser(supabase);
  const { profile } = await readProfileWithRepair(supabase, user.id);
  const role = normalizeRole(profile?.role);
  if (!isStaff(role)) redirect("/dashboard");

  // Real reads only. A query that fails is reported as unavailable, never as zero.
  const [members, invitations, requests, qa, teamAudit, recentSignups] = await Promise.all([
    supabase.from("profiles").select("id, role, status"),
    canUseTesterFeatures(role)
      ? supabase.from("invitations").select("id, status").eq("status", "pending")
      : Promise.resolve({ data: null as Array<{ id: string; status: string }> | null }),
    supabase.from("invitation_requests").select("id, status").eq("status", "pending"),
    supabase.from("qa_reports").select("id, status").eq("status", "open"),
    // Team Activity: the audited staff actions on membership (0048 grants staff read).
    supabase.from("membership_audit").select("id, action, previous_role, new_role, success, created_at").order("created_at", { ascending: false }).limit(8),
    // Member Activity: recent registrations, from the directory staff may read.
    supabase.from("profiles").select("id, display_name, role, created_at").order("created_at", { ascending: false }).limit(5),
  ]);

  const memberRows = members.data ?? null;
  const activeMembers = memberRows ? memberRows.filter((m) => String(m.status ?? "") === "active").length : null;
  const suspended = memberRows ? memberRows.filter((m) => String(m.status ?? "") === "suspended").length : null;
  const tiles = [
    { label: "Active members", value: activeMembers, note: "People with working access", href: "/owner/members", icon: Users },
    { label: "Suspended accounts", value: suspended, note: suspended ? "Access is currently revoked" : "Nobody is suspended", href: "/owner/members", icon: CheckCircle2 },
    { label: "Pending invitations", value: invitations.data ? invitations.data.length : null, note: "Invitations waiting to be accepted", href: "/owner/invitations", icon: ClipboardList },
    { label: "Access requests", value: requests.data ? requests.data.length : null, note: "Waiting for a staff decision", href: "/owner/requests", icon: ClipboardList },
    { label: "Open tester reports", value: qa.data ? qa.data.length : null, note: "Bugs and feedback awaiting triage", href: "/owner/qa", icon: ClipboardList },
  ];

  /*
   * 2026-11-12: only destinations this rank can actually open. The list used to include
   * network analytics, activity and AI operations, all three of which are Owner-only pages
   * that send a Co-Owner straight back to /dashboard - a link that refuses you is worse than
   * no link. Each entry here is gated by requireStaffPage or canUseTesterFeatures, so it
   * opens. Nothing was widened to make this true.
   */
  const areas = [
    { href: "/owner/members", title: "Members", body: "Directory, roles within your limits, suspend or remove members and testers." },
    { href: "/owner/invitations", title: "Invitations", body: "Issue invitations and review the ones already sent." },
    { href: "/owner/requests", title: "Access requests", body: "Decide who may join the network." },
    { href: "/owner/qa", title: "QA triage", body: "Work through tester bug reports and feedback." },
    { href: "/owner/announcements", title: "Announcements", body: "Write and publish updates for everyone in the network." },
  ];

  // 2026-11-12: `?? []` here meant an announcements table that could not be read (or has not
  // been created yet) was rendered as "write the first announcement" - a confident empty
  // state on a table that may already hold posts. The error is now carried and shown.
  const { data: announcementRows, error: announcementError } = await supabase
    .from("announcements")
    .select("id, title, body, status, published_at")
    .order("created_at", { ascending: false })
    .limit(4);
  const announcements = announcementRows ?? [];
  const announcementsUnreadable = Boolean(announcementError) || !announcementRows;

    /*
   * YOUR TEAM'S WEEK (2026-11-12). The reference's bar chart, drawn from the same membership
   * audit rows the team feed reads: seven days, real counts, an empty day is an empty bar.
   */
  const weekSince = new Date(Date.now() - 6 * 86_400_000).toISOString();
  const { data: weekRows, error: weekError } = await supabase
    .from("membership_audit")
    .select("created_at")
    .gte("created_at", weekSince)
    .limit(1000);
  const teamWeek = weekActivity(
    (weekRows ?? []).map((row) => ({ at: String(row.created_at ?? "") })),
    new Date(),
    7,
  );

  /*
   * The Co-Owner runs the same network, so they get the same read: accounts created against
   * study sessions, from the staff-gated network_activity_daily(). Counts only - no member's
   * work is exposed to draw it, and a failed read says so instead of drawing zeros.
   */
  const activityRead = await readActivityDaily(supabase, 14);
  const signupSeries = dailySeries(activityRead.rows, "signups", new Date(), 14);
  const studySeries = dailySeries(activityRead.rows, "study_sessions", new Date(), 14);

return (
    /*
   * 2026-11-12: this page is the Co-Owner's administrative HOME, so it renders inside the
   * administrative environment (variant="owner") with the role-filtered staff sidebar - the
   * same environment as the Owner's, minus everything the Co-Owner may not open. The rank
   * is passed to the shell so the menu is right on the first paint instead of after a round
   * trip, and the shell's "My Workspace" entry is the one deliberate way back to their own
   * academic workspace.
   */
  <AppShell title="Co-Owner Dashboard" variant="owner" role={role}>
        <div className="dash-page">
          <div className="dash-stack">
            <div className="dash-hero">
              <p className="dash-eyebrow">Co-Owner Dashboard</p>
              <h2 className="dash-hero-title mt-1">The network you help run</h2>
              <p className="dash-hero-sub mt-2 max-w-2xl">Your areas, member activity and QA work, read live from the database. Anything unreadable says so.</p>
            </div>
            <TrendChart
              title="Your team this week"
              subtitle="Membership events in the last seven days, so you can see where the work actually landed."
              variant="bars"
              series={teamWeek}
              unreadable={Boolean(weekError)}
              unit="membership events"
              sourceNote="Read from membership_audit. A day with no events is drawn as an empty bar."
            />
            <TrendChart
              title="Growth and study"
              subtitle="Accounts created and study sessions started, day by day, over the last 14 days."
              variant="line"
              series={signupSeries}
              compare={{ label: "study sessions", series: studySeries }}
              unreadable={activityRead.unreadable}
              hint={
                activityRead.needsDatabaseUpdate
                  ? "This panel needs the latest database update. Nothing is wrong: the owner can press Update database on their dashboard and it will fill in."
                  : undefined
              }
              unit="accounts created"
              sourceNote="Counted by network_activity_daily() from profiles, work_sessions and responses - counts only, so no member's work is exposed to make the chart."
            />

      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="accent">Co-Owner</Badge>
          <p className="text-sm text-ink-soft">
            You look after the people and day-to-day running of the network. The areas below are exactly what your role covers.
          </p>
        </div>

        <section aria-labelledby="co-tiles-h">
          <h2 id="co-tiles-h" className="mb-3 meta-strong">At a glance</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tiles.map((t) => {
              const Icon = t.icon;
              return (
                <Link key={t.label} href={t.href} className="block">
                  <Card><CardContent className="p-4">
                    <p className="flex items-center gap-2 meta-strong">
                      <Icon className="h-4 w-4 text-accent" aria-hidden /> {t.label}
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-ink">{t.value === null ? "unavailable" : t.value}</p>
                    <p className="mt-0.5 text-sm text-ink-soft">{t.note}</p>
                  </CardContent></Card>
                </Link>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="co-member-activity-h">
          <h2 id="co-member-activity-h" className="mb-3 meta-strong">Member activity</h2>
          <Card><CardContent className="p-4">
            {recentSignups.data && recentSignups.data.length > 0 ? (
              <ul className="divide-y divide-line">
                {recentSignups.data.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-ink">{m.display_name || "A member"}</span>
                    <span className="text-ink-soft">
                      {MEMBER_ROLE_LABEL[String(m.role ?? "user")] ?? "Member"} · joined {new Date(m.created_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">
                {recentSignups.data ? "No members have joined yet." : "Member activity could not be read just now."}
              </p>
            )}
          </CardContent></Card>
        </section>

        <section aria-labelledby="co-qa-h">
          <h2 id="co-qa-h" className="mb-3 meta-strong">QA command center</h2>
          <Card><CardContent className="p-4">
            <p className="text-sm text-ink-soft">
              {qa.data
                ? `${qa.data.length} tester report${qa.data.length === 1 ? "" : "s"} waiting for triage. Bugs, feedback and ideas from testers land here.`
                : "Tester reports could not be read just now."}
            </p>
            <Link href="/owner/qa" className="mt-2 inline-block text-sm text-accent hover:underline">Open QA triage &rarr;</Link>
          </CardContent></Card>
        </section>

        <section aria-labelledby="co-team-h">
          <h2 id="co-team-h" className="mb-3 meta-strong">Team activity</h2>
          <Card><CardContent className="p-4">
            {teamAudit.data && teamAudit.data.length > 0 ? (
              <ul className="divide-y divide-line">
                {teamAudit.data.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-ink">
                      {String(a.action).replace(/_/g, " ")}
                      {a.new_role ? ` → ${MEMBER_ROLE_LABEL[String(a.new_role)] ?? a.new_role}` : ""}
                    </span>
                    <span className={a.success ? "text-ink-soft" : "text-danger"}>
                      {a.success ? "Recorded" : "Failed"} · {new Date(a.created_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">
                {teamAudit.data ? "No staff actions recorded yet." : "Team activity could not be read just now."}
              </p>
            )}
          </CardContent></Card>
        </section>

        <section aria-labelledby="co-courses-h">
          <h2 id="co-courses-h" className="mb-3 meta-strong">Course oversight</h2>
          <Card><CardContent className="p-4">
            <p className="text-sm text-ink-soft">
              Every member&apos;s courses belong to their own private workspace, so network-wide course lists are never shown here. Counts about the network (members, invitations, requests, tester reports) are in the tiles above, and they are counts only.
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              The deeper network analytics page belongs to the Owner. Ask them if you need a figure it reports.
            </p>
          </CardContent></Card>
        </section>

        <section aria-labelledby="co-announce-h">
          <h2 id="co-announce-h" className="mb-3 meta-strong">Network announcements</h2>
          {announcementsUnreadable ? (
            <Card><CardContent className="p-4">
              <p className="text-sm text-ink-soft">
                Announcements couldn&apos;t be read just now, so this list may be incomplete. Nothing has
                been lost.
              </p>
              <Link href="/owner/announcements" className="mt-2 inline-block text-sm text-accent hover:underline">
                Open announcements &rarr;
              </Link>
            </CardContent></Card>
          ) : announcements.length === 0 ? (
            <Card><CardContent className="p-4">
              <p className="text-sm text-ink-soft">
                Nothing announced yet. Published announcements appear here and in every member&apos;s notifications.
              </p>
              <Link href="/owner/announcements" className="mt-2 inline-block text-sm text-accent hover:underline">
                Write the first announcement &rarr;
              </Link>
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {announcements.map((a) => (
                <Card key={a.id}><CardContent className="p-4">
                  <p className="font-medium text-ink">{a.title}</p>
                  {a.body && <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-ink-soft">{a.body}</p>}
                  <p className="mt-1 text-xs text-ink-soft">
                    {a.status === "published" ? "Published" : "Draft"} {a.published_at ? `· ${new Date(a.published_at).toLocaleDateString()}` : ""}
                  </p>
                </CardContent></Card>
              ))}
              <Link href="/owner/announcements" className="inline-block text-sm text-accent hover:underline">Manage announcements &rarr;</Link>
            </div>
          )}
        </section>

        <section aria-labelledby="co-tasks-h">
          <h2 id="co-tasks-h" className="mb-3 meta-strong">My responsibilities</h2>
          <Card><CardContent className="p-4">
            <ul className="space-y-2 text-sm text-ink-soft">
              <li><strong className="text-ink">Members.</strong> Keep the directory accurate, help with account problems, suspend when needed - within your limits.</li>
              <li><strong className="text-ink">Invitations and requests.</strong> {invitations.data || requests.data ? `${(invitations.data?.length ?? 0) + (requests.data?.length ?? 0)} waiting for action.` : "Could not be read just now."}</li>
              <li><strong className="text-ink">QA.</strong> Triage tester reports and confirm fixes before closing them.</li>
              <li><strong className="text-ink">Analytics.</strong> The figures at the top of this page are yours to watch - how many members are active, suspended, invited or waiting. The network-wide analytics page is Owner-only, so anything that needs it goes to the Owner.</li>
              <li><strong className="text-ink">Operations.</strong> Coordinate with teachers and staff, and escalate owner-level problems (billing, security, providers) to the Owner.</li>
            </ul>
          </CardContent></Card>
        </section>

        <section aria-labelledby="co-areas-h">
          <h2 id="co-areas-h" className="mb-3 meta-strong">Your areas</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {areas.map((a) => (
              <Link key={a.href} href={a.href} className="block">
                <Card><CardContent className="p-4">
                  <p className="flex items-center gap-2 font-medium text-ink">
                    <Briefcase className="h-4 w-4 text-accent" aria-hidden /> {a.title}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">{a.body}</p>
                </CardContent></Card>
              </Link>
            ))}
          </div>
        </section>

        {!canAccessOwnerSecurity(role) && (
          <Card><CardContent className="p-4">
            <p className="font-medium text-ink">Owner-only areas</p>
            <p className="mt-1 text-sm text-ink-soft">
              Security, billing, AI providers, integrations, database updates and ownership transfer belong to the Owner.
              If you need something changed there, ask the Owner - this page can&apos;t open them for you.
            </p>
          </CardContent></Card>
        )}
      </div>
    
          </div>
        </div>
</AppShell>
  );
}
