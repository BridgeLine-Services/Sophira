/**
 * OWNER NAVIGATION REGISTRY (server-safe single source of truth).
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
 */
import {
  Activity,
  Briefcase,
  ChartColumn,
  Database,
  FlaskConical,
  Gauge,
  HardDriveDownload,
  Home,
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
  icon: typeof Home;
  /** The LOWEST role that may open this item. Absent means Owner-only. */
  minimum?: NavRole;
};

export type OwnerNavGroup = {
  heading: string;
  items: OwnerNavItem[];
};

/**
 * OWNER NAV (workspace-separation round 2026-10-11): the Owner Dashboard is
 * its OWN environment with its own navigation layout. "My Workspace" is the
 * single intentional exit into the personal academic workspace; the owner
 * view never shows the workspace sections (Courses tree, Notebooks, etc.),
 * and the workspace only links back here through the explicit Owner
 * Dashboard entry and the brand logo.
 *
 * 2026-11-12: every Owner-Dashboard entry declares the LOWEST role that may open it.
 * The list is filtered with the same authority the server enforces, so a Co-Owner never
 * sees a link whose page would bounce them back. Anything not marked "staff" is
 * Owner-only: security, billing, AI providers, integrations, database updates.
 */
export const OWNER_NAV_GROUPS: OwnerNavGroup[] = [
  {
    heading: "Overview",
    items: [
      { href: "/owner", label: "Dashboard overview", icon: Gauge },
      { href: "/owner/health", label: "System Health", icon: Gauge },
      // 2026-11-11: production drifted nine tables behind with no way to update it
      // from the app. This is that way, labelled in the owner's own words.
      { href: "/owner/database", label: "Database updates", icon: Database },
      // Tester workspace (2026-11-12): the tester role gets its own home for
      // filing and following QA reports. Minimum role "tester" means members
      // and guests never see it, and the page re-checks server-side.
      { href: "/tester", label: "Testing workspace", icon: FlaskConical, minimum: "tester" },
      // Co-Owner workspace (2026-11-12): the people-facing home for the co_owner role,
      // rendered from the authority already defined in src/lib/auth/permissions.ts.
      { href: "/co-owner", label: "Co-Owner workspace", icon: Briefcase, minimum: "co_owner" },
      { href: "/owner/announcements", label: "Announcements", icon: Megaphone, minimum: "co_owner" },
    ],
  },
  {
    heading: "Network Management",
    items: [
      { href: "/owner/members", label: "Members", icon: Users, minimum: "co_owner" },
      { href: "/owner/invitations", label: "Invite someone", icon: UserPlus, minimum: "co_owner" },
      { href: "/owner/requests", label: "Invitation requests", icon: MailQuestion, minimum: "co_owner" },
      // Counts only, never a member's coursework: see lib/owner/analytics.ts for what is refused.
      { href: "/owner/analytics", label: "Network analytics", icon: ChartColumn, minimum: "co_owner" },
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
  { heading: "Personal", items: [{ href: "/dashboard?view=workspace", label: "My Workspace", icon: Briefcase }] },
];

/**
 * The groups and items this role may see, in registry order, with empty groups
 * dropped. This is the SAME rule the sidebar applies and the same authority the
 * pages enforce server-side; it is shared so the two can never drift.
 *
 * A hidden link is a convenience, never the boundary: every destination
 * authorises again on the server.
 */
export function ownerNavGroupsFor(role: Role | string | null | undefined): OwnerNavGroup[] {
  return OWNER_NAV_GROUPS.map((group) => ({
    heading: group.heading,
    items: group.items.filter((item) => roleRank(role) >= roleRank(item.minimum ?? "owner")),
  })).filter((group) => group.items.length > 0);
}
