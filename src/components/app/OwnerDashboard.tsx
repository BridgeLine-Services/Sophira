/**
 * Owner Dashboard (workflow §4, §5, §22; directive 4.10).
 *
 * 2026-11-03: this is now an OVERVIEW, not the whole admin surface. Every management workflow
 * moved to its own page under /owner, and each card here links to it:
 *
 *   /owner/members      /owner/invitations   /owner/requests   /owner/activity
 *   /owner/status       /owner/health        /owner/security   /owner/ai-providers
 *
 * The numbers below are the same real records as before - counts and timestamps only, never
 * another member's academic content. Nothing is estimated, and a tile with no data says so.
 *
 * 2026-11-12 (reskin): presentation only. Same five inputs, same counts, same links, same
 * sentences. The tiles moved onto the shared .stat vocabulary and the twelve management
 * destinations became a grouped list of .panel rows, which reads as an administration
 * console rather than a grid of twelve identical boxes.
 */
import Link from "next/link";
import {
  Activity,
  ChartColumn,
  Gauge,
  HardDriveDownload,
  MailQuestion,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";
import { buildTrends } from "@/lib/owner-trends";
import { buildStatusRows, statusIsHealthy, type StatusInput } from "@/lib/owner-status";
import type { Invitation, InvitationRequest, NetworkMemberStats } from "@/lib/types";

export function OwnerDashboard({ initialMembers, initialInvitations, initialRequests, status }: {
  initialMembers: NetworkMemberStats[];
  initialInvitations: Invitation[];
  initialRequests: InvitationRequest[];
  siteUrl: string;
  status: StatusInput;
}) {
  const members = initialMembers;
  const invitations = initialInvitations;
  const requests = initialRequests;
  const activeMembers = members.filter((m) => m.status === "active");
  const pendingInvites = invitations.filter((i) => i.status === "pending");
  const pendingRequests = requests.filter((r) => r.status === "pending");
  const trends = buildTrends({ members, invitations, requests });
  const rows = buildStatusRows(status);
  const attention = rows.filter((r) => r.state === "attention");
  const healthy = statusIsHealthy(rows);

  const tiles = [
    { label: "Total members", value: members.length, note: trends.members, href: "/owner/members" },
    { label: "Active members", value: activeMembers.length, note: trends.active, href: "/owner/members" },
    { label: "Pending invitations", value: pendingInvites.length, note: trends.invitations, href: "/owner/invitations" },
    { label: "Invite requests", value: pendingRequests.length, note: trends.requests, href: "/owner/requests" },
  ];

  const pages = [
    { href: "/owner/members", title: "Members", body: "See who is in, add their phone number, and revoke or restore access.", icon: Users },
    { href: "/owner/invitations", title: "Invite someone", body: "Send an invitation by email or text, or copy the link yourself.", icon: UserPlus },
    { href: "/owner/requests", title: "Invitation requests", body: "Approve or reject the people your members suggested.", icon: MailQuestion },
    { href: "/owner/activity", title: "Recent activity", body: "Who joined, who was revoked, which invitations were accepted.", icon: Activity },
    { href: "/owner/status", title: "System status", body: "What is working, what needs attention, what is not set up yet.", icon: Gauge },
    { href: "/owner/security", title: "Security and billing", body: "Confirm that Sophira cannot run up charges.", icon: ShieldCheck },
    { href: "/owner/ai-providers", title: "AI providers", body: "Which writing assistant is in use and what it can do.", icon: Sparkles },
    { href: "/owner/health", title: "System health", body: "Deeper checks on storage, sign-in and the database.", icon: Settings2 },
    // 2026-11-13: the four operational views, each answering a question in the owner's words.
    { href: "/owner/features", title: "Feature health", body: "Sixteen capabilities, and which ones are waiting on you.", icon: Sparkles },
    { href: "/owner/ai-operations", title: "AI operations", body: "How fast the AI answers, what fails, and what it costs.", icon: Gauge },
    { href: "/owner/analytics", title: "Network analytics", body: "How your network is growing, week by week.", icon: ChartColumn },
    { href: "/owner/backup", title: "Backup and recovery", body: "Whether your network could be brought back, proven step by step.", icon: HardDriveDownload },
  ];

  return (
    <div className="mt-6 space-y-6">
      <section aria-labelledby="owner-dashboard-numbers" className="panel p-4 sm:p-5">
        <div className="section-head mb-3">
          <h2 id="owner-dashboard-numbers" className="section-title">Your network at a glance</h2>
          <p className="meta">Counts only. Another member&apos;s work is never shown here.</p>
        </div>
        <div className="stat-grid">
          {tiles.map((t) => (
            <Link key={t.label} href={t.href} className="stat stat-hover block">
              <p className="stat-label">{t.label}</p>
              <p className="stat-value">{t.value}</p>
              <p className="stat-note">{t.note}</p>
            </Link>
          ))}
        </div>
      </section>

      <p className="mt-4 flex items-start gap-2 text-sm text-ink-soft">
        <span className={"dot mt-1.5 " + (healthy ? "dot-ok" : attention.length > 0 ? "dot-warn" : "dot-idle")} aria-hidden />
        <span>
          {healthy
            ? "Everything essential is working."
            : attention.length > 0
              ? `${attention.length} ${attention.length === 1 ? "item needs" : "items need"} your attention. The other features still work.`
              : "Some checks have not run yet."}{" "}
          <Link href="/owner/status" className="font-medium text-accent underline-offset-4 hover:underline">See system status</Link>
        </span>
      </p>

      <section aria-labelledby="owner-dashboard-manage" className="panel p-4 sm:p-5">
        <div className="section-head mb-3">
          <h2 id="owner-dashboard-manage" className="section-title">Manage Sophira</h2>
          <p className="meta">Twelve destinations, each one page of its own</p>
        </div>
        <nav aria-label="Manage Sophira" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pages.map((p) => {
            const Icon = p.icon;
            return (
              <Link
                key={p.href}
                href={p.href}
                className="group rounded-xl border border-line bg-card flex items-start gap-3 p-4 transition-colors hover:border-accent/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-on-accent">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-semibold text-ink">{p.title}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-ink-soft">{p.body}</span>
                </span>
              </Link>
            );
          })}
        </nav>
      </section>

      <p className="callout">
        You can manage membership without ever opening a member&apos;s assignments, writing or
        documents. Sophira keeps each person&apos;s work private, including from you.
      </p>
    </div>
  );
}
