"use client";
import Link from "next/link";
import { SignOutButton } from "./SignOutButton";
import { usePathname, useRouter } from "next/navigation";
import { SyncStatus } from "@/components/app/SyncStatus";
import { purgeOfflineOnLogout } from "@/lib/offline/client";
import { Bell, CloudOff, Database } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { Activity, BookOpen, Brain, Briefcase, ChevronDown, ChartColumn, HardDriveDownload, Home, LogOut, MailQuestion, Menu, NotebookPen, Settings, ShieldCheck, Mic, Sparkles, UserPlus, Users, Wifi, X } from "lucide-react";
import { Gauge, Keyboard } from "lucide-react";
import { SUBJECT_TREE, subjectTools, subjectToolUrl } from "@/lib/courses/engines";
import { ScopeChip } from "@/components/app/ScopeChip";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { usePresenceReporter } from "@/lib/presence/use-presence-reporter";
import { DEFAULT_THRESHOLDS } from "@/lib/presence/thresholds";
import { useNotificationBell } from "@/lib/notifications/use-notification-bell";
import { usePendingRequests } from "@/lib/notifications/use-pending-requests";

// Active subject/course scope indicator (course-aware engines round):
// shows the real subject or course this engine is working within.
const NAV = [
  { href: "/writing/typing", label: "Typing Calibration", icon: Keyboard },
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/courses", label: "Courses", icon: BookOpen },
  { href: "/notebooks", label: "Notebooks", icon: NotebookPen },
  // Lecture studio: the only screen that drives the media pipeline
  // (upload -> transcribe -> study notes -> slides). It was headless until
  // Phase 5, so it is reachable from the main workspace navigation.
  { href: "/lectures", label: "Lectures", icon: Mic },
  { href: "/learning", label: "Learning / Memory", icon: Brain },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/offline", label: "Offline", icon: CloudOff },
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * OWNER NAV (workspace-separation round 2026-10-11): the Owner Dashboard is
 * its OWN environment with its own navigation layout. "My Workspace" is the
 * single intentional exit into the personal academic workspace; the owner
 * view never shows the workspace sections (Courses tree, Notebooks, etc.),
 * and the workspace only links back here through the explicit Owner
 * Dashboard entry and the brand logo.
 */
type NavRole = "user" | "tester" | "co_owner" | "owner";

/**
 * 2026-11-12: every Owner-Dashboard entry declares the LOWEST role that may open it.
 * The list is filtered with the same authority the server enforces, so a Co-Owner never
 * sees a link whose page would bounce them back. Anything not marked "staff" is
 * Owner-only: security, billing, AI providers, integrations, database updates.
 */
const OWNER_NAV_GROUPS: Array<{
  heading: string;
  items: Array<{ href: string; label: string; icon: typeof Home; minimum?: NavRole }>;
}> = [
  {
    heading: "Overview",
    items: [
      { href: "/owner", label: "Dashboard overview", icon: Gauge },
      { href: "/owner/health", label: "System Health", icon: Gauge },
      // 2026-11-11: production drifted nine tables behind with no way to update it
      // from the app. This is that way, labelled in the owner's own words.
      { href: "/owner/database", label: "Database updates", icon: Database },
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
 * The shared application shell (nav spec 2026-10-09): desktop/laptop gets a
 * persistent rail with the expandable Courses hierarchy; tablets keep the
 * top nav row; phones get a slide-out drawer with a working menu button.
 * Every authenticated page renders inside this.
 */

/** Expandable Courses hierarchy: subjects, nested Science, subject tools. */
function CourseTree({ userId, pathname, onNavigate }: {
  userId: string | null;
  pathname: string;
  onNavigate?: () => void;
}) {
  const storageKey = userId ? `sophira:nav-expanded:${userId}` : null;
  const [open, setOpen] = useState<{ [key: string]: boolean }>({ courses: false });
  const [loaded, setLoaded] = useState(false);

  // Restore this user's persisted expansion preference (safe if unavailable).
  useEffect(() => {
    let restored: { [key: string]: boolean } = { courses: false };
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) restored = { ...restored, ...JSON.parse(raw) };
      } catch { /* unavailable storage: default collapsed */ }
    }
    setOpen(restored);
    setLoaded(true);
  }, [storageKey]);

  // Direct URL / history navigation: expand exactly the parents needed to
  // reveal the current route. Unrelated groups stay as the user left them.
  useEffect(() => {
    if (!loaded || !pathname.startsWith("/courses")) return;
    setOpen((prev) => {
      const next: { [key: string]: boolean } = { ...prev, courses: true };
      const rest = pathname.slice("/courses".length);
      for (const node of SUBJECT_TREE) {
        if (rest === "/" + node.slug || rest.startsWith("/" + node.slug + "/")) {
          next[node.key] = true;
          for (const child of node.children ?? []) {
            if (rest === "/" + child.slug || rest.startsWith("/" + child.slug + "/")) {
              next[`${node.key}:${child.key}`] = true;
            }
          }
        }
      }
      return next;
    });
  }, [loaded, pathname]);

  function toggle(key: string) {
    setOpen((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (storageKey) {
        try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
      }
      return next;
    });
  }

  // Query-aware active states: tools with query params (/math?mode=type,
  // /math?mode=teach) must highlight ONLY when the current query matches —
  // read client-side to avoid the useSearchParams/Suspense prerender trap.
  const [search, setSearch] = useState("");
  useEffect(() => {
    try { setSearch(window.location.search); } catch { setSearch(""); }
  }, [pathname]);

  const linkActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const subjectActive = (slug: string) => linkActive(`/courses/${slug}`);
  const rowCls = (active: boolean) =>
    cn("flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium",
      active ? "bg-accent-soft text-accent font-medium shadow-[inset_3px_0_0_rgb(var(--c-accent))]" : "text-ink-soft hover:bg-ink/5 hover:text-ink");

  const chevron = (expanded: boolean, label: string) => (
    <button
      type="button"
      onClick={() => toggle(label)}
      aria-expanded={expanded}
      aria-label={expanded ? `Collapse ${label.replace(/:/g, " ")}` : `Expand ${label.replace(/:/g, " ")}`}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-soft hover:bg-ink/5"
    >
      <ChevronDown aria-hidden className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
    </button>
  );

  const toolRows = (slug: string, engines: (typeof SUBJECT_TREE)[number]["engines"], id: string) => (
    open[id] && (
      <div className="ml-8 space-y-0.5 border-l border-line pl-1">
        {subjectTools(engines).map((tool) => {
          const base = tool.path.split("?")[0];
          const toolParams = new URLSearchParams(tool.path.split("?")[1] ?? "");
          const currentParams = new URLSearchParams(search);
          const active =
            linkActive(base) &&
            Array.from(toolParams.entries()).every(([k, v]) => currentParams.get(k) === v);
          return (
            <Link
              key={tool.label}
              href={subjectToolUrl(tool, slug)}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn("block rounded-md px-2.5 py-2.5 text-[13px]",
                active ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-ink/5 hover:text-ink")}
            >
              {tool.label}
            </Link>
          );
        })}
      </div>
    )
  );

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => toggle("courses")}
        aria-expanded={!!open.courses}
        aria-controls="nav-courses-children"
        className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium",
          pathname.startsWith("/courses") ? "text-accent" : "text-ink-soft hover:bg-ink/5 hover:text-ink")}
      >
        <span className="flex items-center gap-2.5"><BookOpen className="h-4 w-4" aria-hidden /> Courses</span>
        <ChevronDown aria-hidden className={cn("h-4 w-4 transition-transform", open.courses && "rotate-180")} />
      </button>
      {open.courses && (
        <div id="nav-courses-children" className="ml-3 space-y-0.5 border-l border-line pl-2">
          {SUBJECT_TREE.map((node) => (
            <div key={node.key} className="space-y-0.5">
              <div className="flex items-center justify-between gap-1">
                <Link
                  href={`/courses/${node.slug}`}
                  onClick={onNavigate}
                  aria-current={subjectActive(node.slug) ? "page" : undefined}
                  className={cn("flex-1 rounded-lg px-3 py-2 text-sm font-medium",
                    subjectActive(node.slug) ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-ink/5 hover:text-ink")}
                >
                  {node.label}
                </Link>
                {chevron(!!open[node.key], node.key)}
              </div>
              {node.children ? (
                <div className="ml-5 space-y-0.5 border-l border-line pl-1">
                  {node.children.map((child) => (
                    <div key={child.key} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-1">
                        <Link
                          href={`/courses/${child.slug}`}
                          onClick={onNavigate}
                          aria-current={subjectActive(child.slug) ? "page" : undefined}
                          className={cn("flex-1 rounded-lg px-3 py-1.5 text-sm",
                            subjectActive(child.slug) ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-ink/5 hover:text-ink")}
                        >
                          {child.label}
                        </Link>
                        {chevron(!!open[`${node.key}:${child.key}`], `${node.key}:${child.key}`)}
                      </div>
                      {toolRows(child.slug, child.engines, `${node.key}:${child.key}`)}
                    </div>
                  ))}
                </div>
              ) : (
                toolRows(node.slug, node.engines, node.key)
              )}
            </div>
          ))}
          <Link
            href="/courses"
            onClick={onNavigate}
            aria-current={pathname === "/courses" ? "page" : undefined}
            className={cn("block rounded-lg px-3 py-2 text-sm", pathname === "/courses" ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-ink/5")}
          >
            All courses…
          </Link>
        </div>
      )}
    </div>
  );
}

export function AppShell({ title, backHref, actions, variant = "workspace", children }: {
  title: string;
  backHref?: string;
  actions?: ReactNode;
  variant?: "workspace" | "owner";
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [signingOut, setSigningOut] = useState(false);
  const [role, setRole] = useState<NavRole>("user");
  const isOwner = role === "owner";
  /** A Co-Owner runs the member directory but not the settings. */
  const isCoOwner = role === "co_owner";
  const [userId, setUserId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  /** The owner's live presence cadence. Null until it has been read, so nothing is guessed. */
  const [presenceWindow, setPresenceWindow] = useState<{ intervalMs: number; activeWindowMs: number } | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.from("profiles").select("id, role").limit(1).maybeSingle().then(({ data }) => {
      if (alive && data) {
        const value = String(data.role ?? "user");
        setRole(value === "owner" || value === "co_owner" || value === "tester" ? (value as NavRole) : "user");
        setUserId(data.id as string);
      }
    });
    return () => { alive = false; };
  }, [supabase]);

  // Real connectivity indicator (links to /online for live service status).
  useEffect(() => {
    setOnline(navigator.onLine !== false);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  /**
   * EVERY SIGNED-IN MEMBER REPORTS PRESENCE (2026-11-13).
   *
   * This used to live only on the Owner's members screen, so the member directory was fed
   * by one page. The shell is the one component every authenticated screen shares, for all
   * four roles and in both the workspace and owner environments, so it is the right home for
   * the heartbeat. The cadence comes from the owner's own settings, never from a guess; until
   * it has been read, reporting stays off rather than inventing an interval.
   */
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    fetch("/api/network/presence")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { settings?: Record<string, number> | null } | null) => {
        if (!alive) return;
        const settings = body?.settings ?? null;
        setPresenceWindow({
          intervalMs:
            (Number(settings?.heartbeat_interval_seconds) || DEFAULT_THRESHOLDS.heartbeatIntervalSeconds) * 1000,
          activeWindowMs:
            (Number(settings?.active_threshold_seconds) || DEFAULT_THRESHOLDS.activeThresholdSeconds) * 1000,
        });
      })
      .catch(() => {
        // The settings could not be read: fall back to Sophira's own defaults, which the
        // server clamps anyway. A missing setting must not stop people being seen.
        if (alive) {
          setPresenceWindow({
            intervalMs: DEFAULT_THRESHOLDS.heartbeatIntervalSeconds * 1000,
            activeWindowMs: DEFAULT_THRESHOLDS.activeThresholdSeconds * 1000,
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  usePresenceReporter({
    intervalMs: presenceWindow?.intervalMs ?? DEFAULT_THRESHOLDS.heartbeatIntervalSeconds * 1000,
    activeWindowMs: presenceWindow?.activeWindowMs ?? DEFAULT_THRESHOLDS.activeThresholdSeconds * 1000,
    // Off until the member is confirmed, and off the moment they sign out.
    enabled: Boolean(userId) && presenceWindow !== null && !signingOut,
  });

  const { unread, known: unreadKnown } = useNotificationBell(userId);
  /**
   * 2026-11-13: a Co-Owner cannot see the Owner's dashboard, so the sidebar carries the count of
   * invitation requests waiting for a decision. Only staff roles cause the read; a plain member
   * has no such number and never asks for one.
   */
  const { pending: pendingRequests, known: pendingKnown } = usePendingRequests(role);

  // Blank-screen/redirect-loop fix (2026-10-08): if the session dies while
  // the user is inside the app (token revoked, cookie cleared, signed out
  // in another tab), the shell previously kept rendering a broken frame.
  // Route to /login ONCE, on the explicit SIGNED_OUT event only — the
  // server guard still owns the real protection; this is UX, not security.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && !signingOut) router.replace("/login");
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase, router, signingOut]);

  // Drawer behavior: Escape closes, background scroll is locked, focus moves
  // into the dialog and returns to the menu button on close.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setDrawerOpen(false); return; }
      // FOCUS TRAP: while the modal drawer is open, Tab cannot reach the page
      // behind it — focus wraps between the drawer's first/last focusable.
      if (e.key === "Tab" && drawerRef.current) {
        const focusables = drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select, input, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!e.shiftKey && (active === last || !drawerRef.current.contains(active))) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && (active === first || !drawerRef.current.contains(active))) {
          e.preventDefault();
          last.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen]);

  function closeDrawer() {
    setDrawerOpen(false);
    menuBtnRef.current?.focus();
  }

  // Swipe-to-close: track the gesture on the drawer panel; a leftward swipe
  // (the natural "push the drawer away" motion) closes it.
  const swipeStart = useRef<number | null>(null);
  function onDrawerTouchStart(e: React.TouchEvent) {
    swipeStart.current = e.touches[0]?.clientX ?? null;
  }
  function onDrawerTouchEnd(e: React.TouchEvent) {
    const start = swipeStart.current;
    swipeStart.current = null;
    const end = e.changedTouches[0]?.clientX;
    if (start != null && end != null && start - end > 60) closeDrawer();
  }

  async function signOut() {
    setSigningOut(true);
    // Offline logout policy (STEP 12): sign-out deletes ALL local offline
    // data — including any unsynced changes. Warn first when work would be lost.
    try {
      const pending = await purgeOfflineOnLogout();
      if (pending > 0 && !window.confirm(
        `You have ${pending} offline change(s) that have NOT synchronized. Signing out now deletes them permanently. Sign out anyway?`
      )) {
        setSigningOut(false);
        return;
      }
    } catch {
      // offline store unavailable — proceed with server sign-out
    }
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const onlineChip = (inDrawer: boolean) => (
    <Link
      href={variant === "owner" ? "/online?env=owner" : "/online"}
      onClick={inDrawer ? closeDrawer : undefined}
      className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium",
        pathname === "/online" ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-ink/5 hover:text-ink")}
      aria-label={online ? "Online — view live status" : "Offline — view live status"}
      aria-current={pathname === "/online" ? "page" : undefined}
    >
      <Wifi className="h-4 w-4" aria-hidden />
      {online ? "Online" : "Offline"}
    </Link>
  );

  // Owner-environment navigation (workspace-separation round 2026-10-11):
  // the owner layout lists only owner views + the single intentional exit to
  // the personal workspace. No workspace sections leak into this environment.
  // Production nav fix (2026-10-11): section links carry the /owner route so
  // they resolve correctly from EVERY owner page (a hash-only href resolves
  // against the current URL, which is why they did nothing on /owner/health).
  // Active styling is route-aware and never faked for a section link.
  const ownerNavLink = (href: string, label: string, Icon: typeof Home) => {
    const active = !href.includes("#") && pathname === href.split("#")[0].split("?")[0];
    return (
      <Link
        key={href}
        href={href}
        onClick={drawerOpen ? closeDrawer : undefined}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium ${
          active ? "bg-ink/10 text-ink" : "text-ink-soft hover:bg-ink/5 hover:text-ink"
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden />
        {label}
      </Link>
    );
  };

  // Workspace-separation fix (2026-10-11): for the owner, bare /dashboard
  // redirects to the Owner Dashboard (role routing), which would yank the
  // user out of the workspace on every Home click. The workspace Home
  // carries ?view=workspace for owners; the active state compares the
  // base path so the query never breaks highlighting.
  const workspaceHomeHref = isOwner ? "/dashboard?view=workspace" : "/dashboard";

  /**
   * 2026-11-12: one place that decides which Owner-Dashboard sections this person may see.
   * A Co-Owner gets the member directory and nothing else; everything unmarked stays
   * Owner-only. The pages themselves authorise again on the server, so hiding a link is a
   * convenience, never the boundary.
   */
  const rank: Record<NavRole, number> = { user: 0, tester: 1, co_owner: 2, owner: 3 };
  const canSeeNavItem = (minimum?: NavRole) => rank[role] >= rank[minimum ?? "owner"];
  const visibleOwnerGroups = OWNER_NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((item) => canSeeNavItem(item.minimum)) }))
    .filter((g) => g.items.length > 0);

  /** Where "home" is for whoever is signed in. A Co-Owner cannot open /owner. */
  const adminHomeHref = isOwner ? "/owner" : isCoOwner ? "/owner/members" : "/dashboard";

  /** The unread badge is drawn only for a count that was actually read, never for zero. */
  const unreadBadge = unreadKnown && unread > 0 ? unread : 0;
  /** Waiting invitation requests, for the staff who may decide one. Same rule: known and above zero. */
  const requestBadge = pendingKnown && pendingRequests > 0 ? pendingRequests : 0;

  const navLink = (href: string, label: string, Icon: typeof Home) => {
    const base = href.split("?")[0];
    const active = pathname === base || pathname.startsWith(base + "/");
    const badge = href === "/notifications" ? unreadBadge : href === "/owner/requests" ? requestBadge : 0;
    return (
      <Link
        key={href}
        href={href}
        onClick={drawerOpen ? closeDrawer : undefined}
        aria-current={active ? "page" : undefined}
        aria-label={
          href === "/notifications" && badge
            ? `${label}, ${badge} unread`
            : href === "/owner/requests" && badge
              ? `${label}, ${badge} waiting for a decision`
              : undefined
        }
        className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium",
          active ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-ink/5 hover:text-ink")}
      >
        <Icon className="h-4 w-4" aria-hidden />
        {label}
        {badge > 0 && (
          <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-on-accent">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-card focus:px-4 focus:py-3 focus:font-semibold focus:text-ink focus:shadow-lg"
      >
        Skip to main content
      </a>
      {/* PERSISTENT SIDEBAR RAIL (lg+): brand, expandable Courses hierarchy,
          the section list, the online status chip, and sign out. */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-paper/95 backdrop-blur lg:flex"
        aria-label="Primary"
      >
        <Link href={variant === "owner" ? adminHomeHref : adminHomeHref === "/dashboard" ? "/dashboard" : adminHomeHref} className="flex items-center gap-2 px-5 py-5 font-semibold text-ink">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent">S</span>
          Sophira
        </Link>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label={variant === "owner" ? "Owner sections" : "Sections"}>
          {variant === "owner" ? (
            visibleOwnerGroups.map((g) => (
              <div key={g.heading} className="mb-3">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft/80">{g.heading}</p>
                {g.items.map(({ href, label, icon: Icon }) => ownerNavLink(href, label, Icon))}
                {g.heading === "Personal" && (<SignOutButton nav />)}
              </div>
            ))
          ) : (
            <>
              {(isOwner || isCoOwner) && (
                <Link
                  href={adminHomeHref}
                  aria-current={pathname === adminHomeHref ? "page" : undefined}
                  className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium",
                    pathname === "/owner" ? "bg-accent-soft text-accent" : "text-accent hover:bg-accent/5")}
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  Owner Dashboard
                </Link>
              )}
              {navLink(workspaceHomeHref, "Home", Home)}
              <CourseTree userId={userId} pathname={pathname} />
              {NAV.filter((n) => n.href !== "/courses" && n.href !== "/dashboard").map((n) => navLink(n.href, n.label, n.icon))}
            </>
          )}
          {onlineChip(false)}
        </nav>
        <div className="border-t border-line p-3">
          <div className="mb-2 px-2"><SyncStatus /></div>
          <button
            onClick={signOut}
            disabled={signingOut}
            aria-label="Sign out"
            title="Sign out"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-ink/5 hover:text-ink"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur lg:pl-60">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <button
            ref={menuBtnRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft hover:bg-ink/5 lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          {backHref ? (
            <Link
              href={backHref === "/dashboard" && isOwner ? "/dashboard?view=workspace" : backHref}
              aria-label="Back"
              className="-ml-1 flex h-11 items-center rounded-lg px-2 text-ink-soft hover:bg-ink/5"
            >
              ←
            </Link>
          ) : (
            <Link href={variant === "owner" ? adminHomeHref : adminHomeHref === "/dashboard" ? "/dashboard" : adminHomeHref} className="flex items-center gap-2 font-semibold text-ink lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent">S</span>
              <span className="hidden sm:inline">Sophira</span>
            </Link>
          )}
          <h1 className="flex-1 truncate text-[17px] font-semibold text-ink">{title}</h1>
          <ScopeChip />
          <ThemeToggle />
          <span className="mr-1 hidden sm:inline-flex"><SyncStatus /></span>
          {actions}
          <button
            onClick={signOut}
            disabled={signingOut}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft hover:bg-ink/5 lg:hidden"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        <nav className="mx-auto hidden max-w-6xl gap-1 overflow-x-auto px-4 pb-2 md:flex lg:hidden" aria-label="Main">
          {variant === "owner" ? (
            OWNER_NAV_GROUPS.flatMap((g) => g.items).map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={!href.includes("#") && pathname === href.split("#")[0].split("?")[0] ? "page" : undefined}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-ink/5 hover:text-ink"
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            ))
          ) : (
            <>
              {(isOwner || isCoOwner) && (
                <Link
                  href={adminHomeHref}
                  aria-current={pathname === adminHomeHref ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
                    pathname === "/owner" ? "bg-accent-soft text-accent" : "text-accent hover:bg-accent/5"
                  )}
                >
                  <ShieldCheck className="h-4 w-4" />
                  Owner
                </Link>
              )}
              {NAV.map(({ href: navHref, label, icon: Icon }) => (
            <Link
              key={navHref}
              href={navHref === "/dashboard" ? workspaceHomeHref : navHref}
              aria-current={pathname === navHref || pathname.startsWith(navHref + "/") ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
                pathname === navHref || pathname.startsWith(navHref + "/")
                  ? "bg-accent-soft text-accent"
                  : "text-ink-soft hover:bg-ink/5"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
              {navHref === "/notifications" && unreadBadge > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-on-accent">
                  {unreadBadge > 99 ? "99+" : unreadBadge}
                </span>
              )}
            </Link>
          ))}
            </>
          )}
        </nav>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 md:pb-12 lg:pl-60">{children}</main>

      {/* MOBILE SLIDE-OUT DRAWER: the full navigation hierarchy on phones.
          Escape, backdrop tap, and navigation close it; focus is managed. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Main menu">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            tabIndex={-1}
            className="absolute inset-0 h-full w-full cursor-default bg-ink/30"
          />
          <div
            ref={drawerRef}
            tabIndex={-1}
            onTouchStart={onDrawerTouchStart}
            onTouchEnd={onDrawerTouchEnd}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-paper pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-xl outline-none"
          >
            <div className="flex items-center justify-between px-5 py-4">
              <span className="flex items-center gap-2 font-semibold text-ink">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent">S</span>
                Sophira
              </span>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close menu"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft hover:bg-ink/5"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <nav className="flex-1 space-y-0.5 px-3 pb-4" aria-label="Sections">
              {variant === "owner" ? (
                visibleOwnerGroups.map((g) => (
              <div key={g.heading} className="mb-3">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft/80">{g.heading}</p>
                {g.items.map(({ href, label, icon: Icon }) => ownerNavLink(href, label, Icon))}
              </div>
            ))
              ) : (
                <>
                  {(isOwner || isCoOwner) && (
                    <Link href={adminHomeHref} onClick={closeDrawer} className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-accent hover:bg-accent/5">
                      <ShieldCheck className="h-4 w-4" aria-hidden /> {isOwner ? "Owner Dashboard" : "Members"}
                    </Link>
                  )}
                  {navLink(workspaceHomeHref, "Home", Home)}
                  <CourseTree userId={userId} pathname={pathname} onNavigate={closeDrawer} />
                  {NAV.filter((n) => n.href !== "/courses" && n.href !== "/dashboard").map((n) => navLink(n.href, n.label, n.icon))}
                </>
              )}
              {onlineChip(true)}
            </nav>
            <div className="border-t border-line p-3">
              <div className="mb-2 px-2"><SyncStatus /></div>
              <button
                onClick={signOut}
                disabled={signingOut}
                aria-label="Sign out"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-ink/5 hover:text-ink"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE BOTTOM BAR: quick top-level destinations (drawer has the full hierarchy). */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Main"
      >
        <div className="flex h-16 items-stretch gap-1 overflow-x-auto px-2" style={{ scrollbarWidth: "none" }}>
          {NAV.filter((n) => n.href !== "/settings").map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href || pathname.startsWith(href + "/") ? "page" : undefined}
              className={cn(
                "flex min-w-[64px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-medium",
                pathname === href || pathname.startsWith(href + "/") ? "text-accent" : "text-ink-soft"
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {label}
              {href === "/notifications" && unreadBadge > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-on-accent">
                  {unreadBadge > 99 ? "99+" : unreadBadge}
                </span>
              )}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
