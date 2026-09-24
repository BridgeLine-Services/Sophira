"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { BookOpen, GraduationCap, Home, Library, LogOut, PenLine, Settings } from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/courses", label: "Courses", icon: BookOpen },
  { href: "/teachers", label: "Teachers", icon: GraduationCap },
  { href: "/writing", label: "Writing", icon: PenLine },
  { href: "/library", label: "Library", icon: Library },
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * The shared application shell: top bar with title/actions/sign-out,
 * horizontal desktop nav, fixed bottom tab bar on mobile.
 * Every authenticated page renders inside this.
 */
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

  async function signOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-2 px-4">
          {backHref ? (
            <Link
              href={backHref}
              aria-label="Back"
              className="-ml-2 flex h-11 items-center rounded-lg px-2 text-ink-soft hover:bg-ink/5"
            >
              ←
            </Link>
          ) : (
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-ink">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">S</span>
              <span className="hidden sm:inline">Sophira</span>
            </Link>
          )}
          <h1 className="flex-1 truncate text-[17px] font-semibold text-ink">{title}</h1>
          {actions}
          <button
            onClick={signOut}
            disabled={signingOut}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft hover:bg-ink/5"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        <nav className="mx-auto hidden max-w-4xl gap-1 overflow-x-auto px-4 pb-2 md:flex" aria-label="Main">
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

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-28 pt-5 md:pb-12">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Main"
      >
        <div className="grid h-16 grid-cols-5">
          {NAV.filter((n) => n.href !== "/settings").map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 text-[11px] font-medium",
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
