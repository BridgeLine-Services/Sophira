"use client";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Standalone sign-out button for error states (2026-10-08): when a signed-in
 * user hits an account problem, the page offers an explicit way out instead
 * of a redirect war. Uses the SAME sign-out path as AppShell: session
 * destroyed, offline mirror purged, then /login — once.
 */
export function SignOutButton({ nav = false }: { nav?: boolean } = {}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      try {
        await import("@/lib/offline/client").then((m) => m.purgeOfflineOnLogout());
      } catch {
        // offline store unavailable — proceed with the server sign-out
      }
      await supabase.auth.signOut();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition active:scale-[0.99] disabled:opacity-60 ${
        nav ? "text-ink-soft hover:bg-ink/5 hover:text-ink" : "rounded-button bg-accent px-4 py-2 text-white shadow-sm"
      }`}
    >
      {nav && <LogOut className="h-4 w-4" aria-hidden />}
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
