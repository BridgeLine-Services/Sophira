"use client";
import Link from "next/link";
import { SignOutButton } from "./SignOutButton";
import { usePathname, useRouter } from "next/navigation";
import { SyncStatus } from "@/components/app/SyncStatus";
import { purgeOfflineOnLogout } from "@/lib/offline/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
// 2026-11-12: the owner-navigation icons moved to src/lib/navigation/owner-nav.ts with the
// registry. Only the workspace/shell icons this component draws itself remain imported here.
import { BookOpen, ChevronDown, Home, LogOut, Menu, ShieldCheck, Wifi, X } from "lucide-react";
import { SUBJECT_TREE, subjectTools, subjectToolUrl } from "@/lib/courses/engines";
import { ScopeChip } from "@/components/app/ScopeChip";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { usePresenceReporter } from "@/lib/presence/use-presence-reporter";
import { DEFAULT_THRESHOLDS } from "@/lib/presence/thresholds";
import { useNotificationBell } from "@/lib/notifications/use-notification-bell";
import { usePendingRequests } from "@/lib/notifications/use-pending-requests";
import { ownerNavGroupsFor, type NavRole } from "@/lib/navigation/owner-nav";
// 2026-11-12: the rank -> dashboard answer and the workspace menu now live in shared,
// server-safe modules. The shell no longer decides either one for itself, and every
// navigation variant reads the same list.
import { adminHomeFor, dashboardForRole, roleLabelFor } from "@/lib/navigation/role-home";
import { workspaceNavFor } from "@/lib/navigation/workspace-nav";
import { normalizeRole, type Role } from "@/lib/roles";

/**
 * The academic workspace navigation lives in src/lib/navigation/workspace-nav.ts (2026-11-12).
 *
 * It used to be a `const NAV` here, and each of the four render paths (desktop rail,
 * tablet row, phone drawer, phone bottom bar) was hand-written beside it. That is how the
 * tablet row ended up ignoring the role filter, why Home was second in the list, and why
 * a Tester had no dashboard entry anywhere. One list, one role rule, four renderers.
 */

/**
 * The owner navigation registry lives in src/lib/navigation/owner-nav.ts.
 *
 * It used to be defined here, in this "use client" module. The Owner Dashboard's
 * server-rendered area grid imported it from here, and a Server Component cannot
 * read a value out of a Client Component: it receives a client reference, so
 * `.map` was not a function and /owner died inside the error boundary
 * (2026-11-12 production incident, digest 3954906548). The shared module makes
 * the registry a real array for the sidebar (client) and the grid (server) alike.
 * One registry, two consumers, no second copy.
 */

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
    cn("flex w-full items-center rounded-xl px-3 py-2 text-sm font-medium",
      active ? "bg-accent-soft text-accent font-semibold shadow-[inset_3px_0_0_rgb(var(--c-accent))]" : "text-ink-soft hover:bg-ink/[0.06] hover:text-ink");

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

export function AppShell({ title, subtitle, backHref, actions, variant = "workspace", role: initialRole, children }: {
  title: string;
  /**
   * One plain-language sentence saying what this screen is for. Optional and additive
   * (2026-11-12 phase 2): it gives every route the same quiet explanation under its
   * title, so a first-time member never has to guess from the heading alone.
   */
  subtitle?: string;
  backHref?: string;
  actions?: ReactNode;
  variant?: "workspace" | "owner";
  /**
   * The SERVER-VERIFIED rank of the signed-in member, when the page already read it.
   * Passing it means the correct menu is drawn on the first paint, with no round trip and
   * no moment where the wrong dashboard could appear. When a page cannot supply it, the
   * shell reads its OWN profile row and nothing else. Never pass a browser-supplied value.
   */
  role?: Role | string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [signingOut, setSigningOut] = useState(false);
  /**
   * 2026-11-12: `null` means "not known yet". Nothing rank-specific is drawn until the real
   * role arrives, so the sidebar can never show an Owner Dashboard to a member - or another
   * rank's dashboard to a Co-Owner - while the profile is still loading. Unknown or
   * unreadable fails closed: no administrative entry at all.
   */
  const [role, setRole] = useState<NavRole | null>(
    initialRole === undefined ? null : normalizeRole(initialRole),
  );
  /** True once the rank is settled, so a later failed re-read keeps the known role. */
  const roleSettled = useRef(initialRole !== undefined);
  const [roleCheck, setRoleCheck] = useState(0);
  const isOwner = role === "owner";
  /**
   * 2026-11-12: the side panel now NAMES the rank. It used to identify an account only by
   * which pages happened to appear, so a Tester and a Co-Owner looked identical. Null while
   * the rank is unknown - the panel claims nothing rather than guessing one.
   */
  const rankLabel = roleLabelFor(role);
  const [userId, setUserId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  /** The owner's live presence cadence. Null until it has been read, so nothing is guessed. */
  const [presenceWindow, setPresenceWindow] = useState<{ intervalMs: number; activeWindowMs: number } | null>(null);

  /**
   * WHO AM I (rewritten 2026-11-12).
   *
   * Two things were wrong here. `select(...).limit(1)` asked for "one profile row" without
   * asking WHICH row: under a directory policy that lets staff read other people it could
   * return a colleague, so the sidebar could draw someone else's rank. And a failed read
   * left the role at its initial guess, which is exactly the value a role check must never
   * invent.
   *
   * It now reads the signed-in identity first and asks for that one row by id. The first
   * failed read leaves the rank UNKNOWN (no administrative navigation); a later failed
   * re-read keeps the last known rank instead of collapsing the menu. Re-reading on focus
   * means a rank change made by another staff member appears without a hard refresh.
   */
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!alive) return;
      const uid = auth.user?.id ?? null;
      setUserId(uid);

      // The page already told us, from the server. That is authoritative: no guess, no flash.
      if (initialRole !== undefined) {
        setRole(normalizeRole(initialRole));
        roleSettled.current = true;
        return;
      }
      if (!uid) {
        if (!roleSettled.current) setRole(null);
        roleSettled.current = true;
        return;
      }
      const { data, error } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
      if (!alive) return;
      if (error || !data) {
        if (!roleSettled.current) setRole(null); // fail closed, never "owner by default"
      } else {
        setRole(normalizeRole(data.role));
      }
      roleSettled.current = true;
    })();
    return () => { alive = false; };
  }, [supabase, initialRole, roleCheck]);

  // A rank change made elsewhere (promotion, demotion, suspension) shows up as soon as the
  // member comes back to this tab, without a sign-out.
  useEffect(() => {
    const bump = () => setRoleCheck((n) => n + 1);
    window.addEventListener("focus", bump);
    window.addEventListener("online", bump);
    return () => {
      window.removeEventListener("focus", bump);
      window.removeEventListener("online", bump);
    };
  }, []);

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
      className={cn("nav-item", pathname === "/online" && "nav-item-active")}
      aria-label={online ? "Online — view live status" : "Offline — view live status"}
      aria-current={pathname === "/online" ? "page" : undefined}
    >
      <span className={cn("dot", online ? "dot-ok" : "dot-idle")} aria-hidden />
      <Wifi className={cn("h-[17px] w-[17px] shrink-0", online ? "block" : "hidden")} aria-hidden />
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
        className={cn("nav-item", active && "nav-item-active")}
      >
        <Icon className="h-[17px] w-[17px] shrink-0" aria-hidden />
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
   * 2026-11-12: one place that decides which administrative sections this person may see.
   * A Co-Owner gets their own dashboard, the member-facing areas and QA triage; everything
   * unmarked stays Owner-only. The pages themselves authorise again on the server, so
   * hiding a link is a convenience, never the boundary.
   */
  const visibleOwnerGroups = ownerNavGroupsFor(role);

  /**
   * The workspace menu for this rank: its OWN dashboard first (if it has one), then Home,
   * then the academic sections in their existing order.
   */
  const workspaceLinks = workspaceNavFor(role);
  const dashboardLink = dashboardForRole(role);
  const sectionLinks = workspaceLinks.filter(
    (n) => n.kind === "section" && n.href !== "/courses" && n.href !== "/dashboard",
  );

  /**
   * Where "home" is for whoever is signed in: the rank's own dashboard, or the personal
   * workspace for a member. Resolved in src/lib/navigation/role-home.ts, so the logo, the
   * back button and every staff page agree about it.
   */
  const adminHomeHref = adminHomeFor(role);

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
        className={cn("nav-item", active && "nav-item-active")}
      >
        <Icon className="h-[17px] w-[17px] shrink-0" aria-hidden />
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
        className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-sidebar lg:flex"
        aria-label="Primary"
      >
        <Link href={adminHomeHref} className="flex items-center gap-3 px-5 pb-3 pt-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-[15px] font-bold text-on-accent shadow-e1">
            S
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold leading-none tracking-[-0.015em] text-ink">Sophira</span>
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">Academic AI</span>
          </span>
        </Link>
        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label={variant === "owner" ? "Owner sections" : "Sections"}>
          {variant === "owner" ? (
            role === null ? (
              // The rank is not known yet: say so plainly instead of drawing a menu that
              // might belong to someone else.
              <p className="px-3 py-2 text-sm text-ink-soft" role="status">Loading your menu…</p>
            ) : (
              visibleOwnerGroups.map((g) => (
                <div key={g.heading}>
                  <p className="nav-group-label">{g.heading}</p>
                  <div className="space-y-0.5">
                    {g.items.map(({ href, label, icon: Icon }) => ownerNavLink(href, label, Icon))}
                    {g.heading === "Personal" && (<SignOutButton nav />)}
                  </div>
                </div>
              ))
            )
          ) : (
            <>
              <p className="nav-group-label">Your workspace</p>
              {dashboardLink && (
                <Link
                  href={dashboardLink.href}
                  aria-current={pathname === dashboardLink.href ? "page" : undefined}
                  className={cn("nav-item", pathname === dashboardLink.href ? "nav-item-active" : "text-accent hover:bg-accent-soft/60 hover:text-accent")}
                >
                  <ShieldCheck className="h-[17px] w-[17px] shrink-0" aria-hidden />
                  {dashboardLink.label}
                </Link>
              )}
              {navLink(workspaceHomeHref, "Home", Home)}
              <CourseTree userId={userId} pathname={pathname} />
              {sectionLinks.map((n) => navLink(n.href, n.label, n.icon))}
            </>
          )}
          {onlineChip(false)}
        </nav>
        <div className="border-t border-line px-3 py-3">
          {rankLabel && (
            <p
              className="mb-2 flex items-center gap-2 rounded-xl bg-card/80 px-3 py-2 text-xs text-ink-soft ring-1 ring-inset ring-line"
              data-rank={role}
            >
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
              <span className="min-w-0">
                Signed in as <span className="font-semibold text-ink">{rankLabel}</span>
              </span>
            </p>
          )}
          <div className="mb-1 px-1"><SyncStatus /></div>
          <button
            onClick={signOut}
            disabled={signingOut}
            aria-label="Sign out"
            title="Sign out"
            className="nav-item w-full disabled:opacity-50"
          >
            <LogOut className="h-[17px] w-[17px] shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 border-b border-line bg-topbar/90 backdrop-blur-md lg:pl-64">
        <div className="mx-auto flex h-14 max-w-content items-center gap-2 px-4 sm:px-6">
          <button
            ref={menuBtnRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft hover:bg-ink/[0.06] hover:text-ink lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          {backHref ? (
            <Link
              href={backHref === "/dashboard" && isOwner ? "/dashboard?view=workspace" : backHref}
              aria-label="Back"
              className="-ml-1 flex h-11 items-center rounded-xl px-2 text-ink-soft hover:bg-ink/[0.06] hover:text-ink"
            >
              ←
            </Link>
          ) : (
            <Link href={adminHomeHref} className="flex items-center gap-2 font-semibold text-ink lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-[13px] font-bold text-on-accent">S</span>
              <span className="hidden sm:inline">Sophira</span>
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[16px] font-semibold tracking-[-0.01em] text-ink sm:text-[17px]">{title}</h1>
            {subtitle && (
              <p className="mt-0.5 hidden truncate text-[12px] leading-tight text-ink-soft sm:block" title={subtitle}>
                {subtitle}
              </p>
            )}
          </div>
          <ScopeChip />
          <ThemeToggle />
          <span className="mr-1 hidden sm:inline-flex"><SyncStatus /></span>
          {actions}
          <button
            onClick={signOut}
            disabled={signingOut}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft hover:bg-ink/[0.06] hover:text-ink lg:hidden"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        <nav className="mx-auto hidden max-w-content gap-1 overflow-x-auto px-4 pb-2 sm:px-6 md:flex lg:hidden" aria-label="Main">
          {variant === "owner" ? (
            // 2026-11-12: this branch rendered the UNFILTERED registry (every group's items,
            // with no role filter), so the tablet row showed a Co-Owner every Owner-only page.
            // It now uses the same role-filtered groups as the rail and the drawer.
            role === null ? null : visibleOwnerGroups.flatMap((g) => g.items).map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={!href.includes("#") && pathname === href.split("#")[0].split("?")[0] ? "page" : undefined}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[13.5px] font-medium text-ink-soft hover:bg-ink/[0.06] hover:text-ink aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent"
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            ))
          ) : (
            <>
              {dashboardLink && (
                <Link
                  href={dashboardLink.href}
                  aria-current={pathname === dashboardLink.href ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[13.5px] font-medium",
                    pathname === dashboardLink.href ? "bg-accent-soft text-accent" : "text-accent hover:bg-accent-soft/60"
                  )}
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  {dashboardLink.label}
                </Link>
              )}
              {workspaceLinks.map(({ href: navHref, label, icon: Icon }) => (
            <Link
              key={navHref}
              href={navHref === "/dashboard" ? workspaceHomeHref : navHref}
              aria-current={pathname === navHref || pathname.startsWith(navHref + "/") ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[13.5px] font-medium",
                pathname === navHref || pathname.startsWith(navHref + "/")
                  ? "bg-accent-soft text-accent"
                  : "text-ink-soft hover:bg-ink/[0.06] hover:text-ink"
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

      <main id="main-content" tabIndex={-1} className="w-full flex-1 pb-28 md:pb-12 lg:pl-64">
        {/* One rhythm for every screen: children stack at the shared 24px gap, so a page
            body never has to remember to add its own top-level spacing. */}
        <div className="page-stack mx-auto w-full max-w-content px-4 pt-6 pb-10 sm:px-6 sm:pt-7">{children}</div>
      </main>

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
            className="absolute inset-y-0 left-0 flex w-80 max-w-[86vw] flex-col overflow-y-auto border-r border-line bg-sidebar pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-e3 outline-none"
          >
            <div className="flex items-center justify-between px-5 pb-3 pt-5">
              <span className="flex items-center gap-3 font-semibold text-ink">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-[15px] font-bold text-on-accent">S</span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] leading-none tracking-[-0.015em]">Sophira</span>
                  <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">Academic AI</span>
                </span>
              </span>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close menu"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft hover:bg-ink/[0.06] hover:text-ink"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <nav className="flex-1 px-3 pb-4" aria-label="Sections">
              {variant === "owner" ? (
                role === null ? (
                  <p className="px-3 py-2 text-sm text-ink-soft" role="status">Loading your menu…</p>
                ) : (
                  visibleOwnerGroups.map((g) => (
                    <div key={g.heading}>
                      <p className="nav-group-label">{g.heading}</p>
                      <div className="space-y-0.5">
                        {g.items.map(({ href, label, icon: Icon }) => ownerNavLink(href, label, Icon))}
                      </div>
                    </div>
                  ))
                )
              ) : (
                <>
                  {dashboardLink && (
                    <Link
                      href={dashboardLink.href}
                      onClick={closeDrawer}
                      aria-current={pathname === dashboardLink.href ? "page" : undefined}
                      className="nav-item text-accent hover:bg-accent-soft/60 hover:text-accent"
                    >
                      <ShieldCheck className="h-[17px] w-[17px] shrink-0" aria-hidden /> {dashboardLink.label}
                    </Link>
                  )}
                  {navLink(workspaceHomeHref, "Home", Home)}
                  <CourseTree userId={userId} pathname={pathname} onNavigate={closeDrawer} />
                  {sectionLinks.map((n) => navLink(n.href, n.label, n.icon))}
                </>
              )}
              {onlineChip(true)}
            </nav>
            <div className="border-t border-line px-3 py-3">
              {rankLabel && (
                <p
                  className="mb-2 flex items-center gap-2 rounded-xl bg-card/80 px-3 py-2 text-xs text-ink-soft ring-1 ring-inset ring-line"
                  data-rank={role}
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  <span className="min-w-0">
                    Signed in as <span className="font-semibold text-ink">{rankLabel}</span>
                  </span>
                </p>
              )}
              <div className="mb-1 px-1"><SyncStatus /></div>
              <button
                onClick={signOut}
                disabled={signingOut}
                aria-label="Sign out"
                className="nav-item w-full disabled:opacity-50"
              >
                <LogOut className="h-[17px] w-[17px] shrink-0" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE BOTTOM BAR: quick top-level destinations (drawer has the full hierarchy). */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-topbar/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
        aria-label="Main"
      >
        <div className="flex h-16 items-stretch gap-0.5 overflow-x-auto px-1.5" style={{ scrollbarWidth: "none" }}>
          {workspaceLinks.filter((n) => n.href !== "/settings").map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href === "/dashboard" ? workspaceHomeHref : href}
              aria-current={pathname === href || pathname.startsWith(href + "/") ? "page" : undefined}
              className={cn(
                "flex min-w-[62px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 text-[11px] font-medium transition-colors",
                pathname === href || pathname.startsWith(href + "/")
                  ? "bg-accent-soft font-semibold text-accent"
                  : "text-ink-soft active:bg-ink/[0.06]"
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
