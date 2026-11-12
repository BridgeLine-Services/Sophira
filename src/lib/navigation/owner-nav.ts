/**
 * STAFF NAVIGATION REGISTRY (server-safe single source of truth).
 *
 * WHY THIS FILE EXISTS (2026-11-12 production incident):
 * The registry used to live inside src/components/app/AppShell.tsx, which is a
 * "use client" module. src/components/owner/OwnerAreaGrid.tsx is a SERVER
 * Component and imported the array from it. When a Server Component imports a
 * module marked "use client", Next does not hand over the real value: it hands
 * over a client-reference proxy. `OWNER_NAV_GROUPS.map(...)` therefore threw
 * `TypeError: h.OWNER_NAV_GROUPS.map is not a function` and /owner rendered the
 * error boundary. The build was clean; only a real render caught it.
 *
 * The rule this file encodes: shared DATA used by both Server and Client
 * Components must live in a module with no "use client" directive and no
 * client-only dependencies. Both AppShell (client) and OwnerAreaGrid (server)
 * now import from here, so the value is a genuine array on both sides.
 *
 * KEEP THIS MODULE PURE DATA: no "use client", no React hooks, no state, no
 * browser APIs, no Supabase client, no fetch. Icons are the plain Lucide
 * components, which render on the server and on the client.
 *
 * ROLE SEPARATION (2026-11-12, second pass)
 * The four ranks now have four dashboards - /owner, /co-owner, /tester and the
 * member workspace - resolved in src/lib/navigation/role-home.ts. This registry
 * is the ADMINISTRATIVE environment only, and each entry states who may see it:
 *
 *   - no `minimum` and no `roles`  -> Owner only (the default, never inherited);
 *   - `minimum: "co_owner"`        -> Owner and Co-Owner;
 *   - `roles: [...]`               -> exactly those ranks, no ranking involved.
 *
 * That is how the Co-Owner Dashboard entry stays out of the Owner's menu (he has
 * his own) while still being the Co-Owner's home, and how a Tester never sees any
 * of it. Hiding an entry is a convenience, never the boundary: every destination
 * authorises again on the server (src/lib/owner/page-context.ts).
 */
import {
  Activity,
  Briefcase,
  ChartColumn,
  Database,
  FlaskConical,
  Gauge,
  HardDriveDownload,
  MailQuestion,
  Megaphone,
  Settings,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";
// Relative on purpose: this module must be importable by the test runner (plain node)
// as well as by the app, exactly like the other pure libs in src/lib.
import { roleRank } from "../roles";
import type { Role } from "../roles";

/**
 * The four Sophira roles, as navigation understands them. Identical to
 * src/lib/roles.ts (kept as an alias so call sites read naturally).
 */
export type NavRole = Role;

export type OwnerNavItem = {
  href: string;
  label: string;
  icon: typeof Gauge;
  /** The LOWEST role that may open this item. Absent means Owner-only. */
  minimum?: NavRole;
  /**
   * An EXACT audience, for entries that are one rank's own home rather than a
   * capability ordered by rank. Takes precedence over `minimum`.
   */
  roles?: NavRole[];
};

export type OwnerNavGroup = {
  heading: string;
  items: OwnerNavItem[];
};

/**
 * STAFF NAV (workspace-separation round 2026-10-11): the administrative
 * environment has its own navigation layout. "My Workspace" is the single
 * intentional exit into the personal academic workspace; the administrative
 * view never shows the workspace sections (Courses tree, Notebooks, etc.),
 * and the workspace only links back through the explicit dashboard entry and
 * the brand logo.
 *
 * 2026-11-12: every entry declares who may open it. The list is filtered with
 * the same authority the server enforces, so a Co-Owner never sees a link whose
 * page would bounce them back. Anything not marked staff is Owner-only:
 * security, billing, AI providers, integrations, database updates, analytics.
 */
export const OWNER_NAV_GROUPS: OwnerNavGroup[] = [
  {
    heading: "Overview",
    items: [
      // The Owner's own home. It is the ONLY place this label appears.
      { href: "/owner", label: "Owner Dashboard", icon: Gauge },
      { href: "/owner/health", label: "System Health", icon: Gauge },
      // 2026-11-11: production drifted nine tables behind with no way to update it
      // from the app. This is that way, labelled in the owner's own words.
      { href: "/owner/database", label: "Database updates", icon: Database },
      // The Co-Owner's own home (2026-11-12). Listed for the Co-Owner ONLY: the
      // Owner has /owner and must not be offered a second rank's dashboard.
      { href: "/co-owner", label: "Co-Owner Dashboard", icon: Briefcase, roles: ["co_owner"] },
      { href: "/owner/announcements", label: "Announcements", icon: Megaphone, minimum: "co_owner" },
    ],
  },
  {
    heading: "Network Management",
    items: [
      { href: "/owner/members", label: "Members", icon: Users, minimum: "co_owner" },
      { href: "/owner/invitations", label: "Invite someone", icon: UserPlus, minimum: "co_owner" },
      { href: "/owner/requests", label: "Invitation requests", icon: MailQuestion, minimum: "co_owner" },
      // Tester reports (2026-11-12): filing lives in /tester; deciding lives here, and
      // the page accepts a Co-Owner, so the link is offered to a Co-Owner.
      { href: "/owner/qa", label: "QA triage", icon: FlaskConical, minimum: "co_owner" },
      // Counts only, never a member's coursework: see lib/owner/analytics.ts for what is
      // refused. The page itself is Owner-only (requireOwnerPage), so the entry is too -
      // a link that bounces a Co-Owner back to their dashboard is worse than no link.
      { href: "/owner/analytics", label: "Network analytics", icon: ChartColumn },
    ],
  },
  {
    heading: "Monitoring",
    items: [
      { href: "/owner/activity", label: "Recent activity", icon: Activity },
      { href: "/owner/status", label: "System status", icon: ShieldCheck },
      // 2026-11-13: the owner asked to be able to answer "which parts work?", "is the AI slow?"
      // and "could we come back from a disaster?" without reading a log or a dashboard of jargon.
      { href: "/owner/features", label: "Feature health", icon: Sparkles },
      { href: "/owner/ai-operations", label: "AI operations", icon: Gauge },
      { href: "/owner/backup", label: "Backup and recovery", icon: HardDriveDownload },
      // 2026-11-11: "is the app ready to go out?" had no single answer. The page reuses the
      // release gate's own results; it is not a second gate.
      { href: "/owner/release-readiness", label: "Release readiness", icon: ShieldCheck },
    ],
  },
  {
    heading: "Configuration",
    items: [
      { href: "/owner/security", label: "Security and billing", icon: ShieldCheck },
      { href: "/owner/ai-providers", label: "AI providers and models", icon: Gauge },
      { href: "/owner/integrations", label: "Integrations", icon: Settings },
    ],
  },
  {
    heading: "Personal",
    items: [
      // Every staff rank (and a Tester, if they ever stand in this environment) keeps one
      // deliberate way back to their own academic workspace. A member has no entry here at
      // all, because a member has no administrative environment.
      { href: "/dashboard?view=workspace", label: "My Workspace", icon: Briefcase, roles: ["owner", "co_owner", "tester"] },
    ],
  },
];

/**
 * May this role see this entry? Ranked entries use `minimum` (default: Owner only);
 * entries with an explicit `roles` list use it exactly.
 *
 * An unrecognised role is normalised to the lowest privilege by roleRank, so it can never
 * match a ranked entry above `user`, and it never matches an exact list either.
 */
export function canSeeNavItem(role: Role | string | null | undefined, item: OwnerNavItem): boolean {
  if (role === null || role === undefined) return false;
  if (item.roles) {
    return (item.roles as string[]).includes(String(role));
  }
  return roleRank(role) >= roleRank(item.minimum ?? "owner");
}

/**
 * The groups and items this role may see, in registry order, with empty groups dropped.
 * This is the SAME rule the sidebar applies and the same authority the pages enforce
 * server-side; it is shared so the two can never drift.
 */
export function ownerNavGroupsFor(role: Role | string | null | undefined): OwnerNavGroup[] {
  return OWNER_NAV_GROUPS.map((group) => ({
    heading: group.heading,
    items: group.items.filter((item) => canSeeNavItem(role, item)),
  })).filter((group) => group.items.length > 0);
}
