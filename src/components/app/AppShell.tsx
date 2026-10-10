"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SyncStatus } from "@/components/app/SyncStatus";
import { purgeOfflineOnLogout } from "@/lib/offline/client";
import { CloudOff } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { BookOpen, Brain, ChevronDown, GraduationCap, Home, Library, LogOut, Menu, NotebookPen, PenLine, Settings, ClipboardCheck, ShieldCheck, Sigma, FileText, Wifi, X } from "lucide-react";
import { SUBJECT_TREE, ENGINE_TOOLS, subjectToolUrl } from "@/lib/courses/engines";

const NAV = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/courses", label: "Courses", icon: BookOpen },
  { href: "/notebooks", label: "Notebooks", icon: NotebookPen },
  { href: "/learning", label: "Learning / Memory", icon: Brain },
  { href: "/offline", label: "Offline", icon: CloudOff },
  { href: "/settings", label: "Settings", icon: Settings },
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

  const linkActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const subjectActive = (slug: string) => linkActive(`/courses/${slug}`);
  const rowCls = (active: boolean) =>
    cn("flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium",
      active ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-ink/5 hover:text-ink");

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
      <div className="ml-8 space-y-0.5 border-l border-ink/10 pl-1">
        {ENGINE_TOOLS[engines[0]].map((tool) => {
          const base = tool.path.split("?")[0];
          const active = !tool.path.includes("?") && linkActive(base);
          return (
            <Link
              key={tool.label}
              href={subjectToolUrl(tool, slug)}
              onClick={onNavigate}
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
        <div id="nav-courses-children" className="ml-3 space-y-0.5 border-l border-ink/10 pl-2">
          {SUBJECT_TREE.map((node) => (
            <div key={node.key} className="space-y-0.5">
              <div className="flex items-center justify-between gap-1">
                <Link
                  href={`/courses/${node.slug}`}
                  onClick={onNavigate}
                  className={cn("flex-1 rounded-lg px-3 py-2 text-sm font-medium",
                    subjectActive(node.slug) ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-ink/5 hover:text-ink")}
                >
                  {node.label}
                </Link>
                {chevron(!!open[node.key], node.key)}
              </div>
              {node.children ? (
                <div className="ml-5 space-y-0.5 border-l border-ink/10 pl-1">
                  {node.children.map((child) => (
                    <div key={child.key} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-1">
                        <Link
                          href={`/courses/${child.slug}`}
                          onClick={onNavigate}
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
            className={cn("block rounded-lg px-3 py-2 text-sm", pathname === "/courses" ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-ink/5")}
          >
            All courses…
          </Link>
        </div>
      )}
    </div>
  );
}

export function AppShell({ title, backHref, actions, children }: {
  title: string;
  backHref?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [signingOut, setSigningOut] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    supabase.from("profiles").select("id, role").limit(1).then(({ data }) => {
      if (alive && data?.[0]) {
        if (data[0].role === "owner") setIsOwner(true);
        setUserId(data[0].id as string);
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
      href="/online"
      onClick={inDrawer ? closeDrawer : undefined}
      className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium",
        pathname === "/online" ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-ink/5 hover:text-ink")}
      aria-label={online ? "Online — view live status" : "Offline — view live status"}
    >
      <Wifi className="h-4 w-4" aria-hidden />
      {online ? "Online" : "Offline"}
    </Link>
  );

  const navLink = (href: string, label: string, Icon: typeof Home) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    return (
      <Link
        key={href}
        href={href}
        onClick={drawerOpen ? closeDrawer : undefined}
        className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium",
          active ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-ink/5 hover:text-ink")}
      >
        <Icon className="h-4 w-4" aria-hidden />
        {label}
      </Link>
    );
  };

  return (
    <div className="flex min-h-dvh flex-col">
      {/* PERSISTENT SIDEBAR RAIL (lg+): brand, expandable Courses hierarchy,
          the section list, the online status chip, and sign out. */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-ink/10 bg-paper/95 backdrop-blur lg:flex"
        aria-label="Primary"
      >
        <Link href="/dashboard" className="flex items-center gap-2 px-5 py-5 font-semibold text-ink">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">S</span>
          Sophira
        </Link>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Sections">
          {isOwner && (
            <Link
              href="/owner"
              className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium",
                pathname === "/owner" ? "bg-accent-soft text-accent" : "text-accent hover:bg-accent/5")}
            >
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Owner Dashboard
            </Link>
          )}
          {navLink("/dashboard", "Home", Home)}
          <CourseTree userId={userId} pathname={pathname} />
          {NAV.filter((n) => n.href !== "/courses" && n.href !== "/dashboard").map((n) => navLink(n.href, n.label, n.icon))}
          {onlineChip(false)}
        </nav>
        <div className="border-t border-ink/10 p-3">
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

      <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/95 backdrop-blur lg:pl-60">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-2 px-4">
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
              href={backHref}
              aria-label="Back"
              className="-ml-1 flex h-11 items-center rounded-lg px-2 text-ink-soft hover:bg-ink/5"
            >
              ←
            </Link>
          ) : (
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-ink lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">S</span>
              <span className="hidden sm:inline">Sophira</span>
            </Link>
          )}
          <h1 className="flex-1 truncate text-[17px] font-semibold text-ink">{title}</h1>
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
        <nav className="mx-auto hidden max-w-4xl gap-1 overflow-x-auto px-4 pb-2 md:flex lg:hidden" aria-label="Main">
          {isOwner && (
            <Link
              href="/owner"
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
                pathname === "/owner" ? "bg-accent-soft text-accent" : "text-accent hover:bg-accent/5"
              )}
            >
              <ShieldCheck className="h-4 w-4" />
              Owner
            </Link>
          )}
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
                pathname === href || pathname.startsWith(href + "/")
                  ? "bg-accent-soft text-accent"
                  : "text-ink-soft hover:bg-ink/5"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-28 pt-5 md:pb-12 lg:pl-60">{children}</main>

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
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-ink/10 bg-paper pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-xl outline-none"
          >
            <div className="flex items-center justify-between px-5 py-4">
              <span className="flex items-center gap-2 font-semibold text-ink">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">S</span>
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
              {isOwner && (
                <Link href="/owner" onClick={closeDrawer} className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-accent hover:bg-accent/5">
                  <ShieldCheck className="h-4 w-4" aria-hidden /> Owner Dashboard
                </Link>
              )}
              {navLink("/dashboard", "Home", Home)}
              <CourseTree userId={userId} pathname={pathname} onNavigate={closeDrawer} />
              {NAV.filter((n) => n.href !== "/courses" && n.href !== "/dashboard").map((n) => navLink(n.href, n.label, n.icon))}
              {onlineChip(true)}
            </nav>
            <div className="border-t border-ink/10 p-3">
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
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Main"
      >
        <div className="flex h-16 items-stretch gap-1 overflow-x-auto px-2" style={{ scrollbarWidth: "none" }}>
          {NAV.filter((n) => n.href !== "/settings").map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex min-w-[64px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-medium",
                pathname === href || pathname.startsWith(href + "/") ? "text-accent" : "text-ink-soft"
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
