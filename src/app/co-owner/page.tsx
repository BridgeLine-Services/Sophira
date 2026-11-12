import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Card, CardContent } from "@/components/ui";
import { Briefcase, CheckCircle2, ClipboardList, Users } from "lucide-react";
import { canUseTesterFeatures, canAccessOwnerSecurity } from "@/lib/auth/permissions";
import { isStaff, normalizeRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

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
  const [members, invitations, requests, qa] = await Promise.all([
    supabase.from("profiles").select("id, role, status"),
    canUseTesterFeatures(role)
      ? supabase.from("invitations").select("id, status").eq("status", "pending")
      : Promise.resolve({ data: null as Array<{ id: string; status: string }> | null }),
    supabase.from("invitation_requests").select("id, status").eq("status", "pending"),
    supabase.from("qa_reports").select("id, status").eq("status", "open"),
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

  const areas = [
    { href: "/owner/members", title: "Members", body: "Directory, roles within your limits, suspend or remove members and testers." },
    { href: "/owner/invitations", title: "Invitations", body: "Issue invitations and review the ones already sent." },
    { href: "/owner/requests", title: "Access requests", body: "Decide who may join the network." },
    { href: "/owner/qa", title: "QA triage", body: "Work through tester bug reports and feedback." },
    { href: "/owner/analytics", title: "Network analytics", body: "Usage and learning activity across the network." },
    { href: "/owner/activity", title: "Activity", body: "What has happened recently in the network." },
    { href: "/owner/ai-operations", title: "AI operations", body: "Whether AI requests are succeeding and how quickly." },
  ];

  return (
    <AppShell title="Co-Owner workspace">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="accent">Co-Owner</Badge>
          <p className="text-sm text-ink-soft">
            You look after the people and day-to-day running of the network. The areas below are exactly what your role covers.
          </p>
        </div>

        <section aria-labelledby="co-tiles-h">
          <h2 id="co-tiles-h" className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">At a glance</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tiles.map((t) => {
              const Icon = t.icon;
              return (
                <Link key={t.label} href={t.href} className="block">
                  <Card><CardContent className="p-4">
                    <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-soft">
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

        <section aria-labelledby="co-areas-h">
          <h2 id="co-areas-h" className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">Your areas</h2>
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
    </AppShell>
  );
}
