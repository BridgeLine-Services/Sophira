"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { ShieldOff } from "lucide-react";

/**
 * Explicit Access Denied state for revoked members (workflow §3, §23).
 * Middleware redirects every protected route here; API routes answer 403.
 */
export default function AccessDeniedPage() {
  const [busy, setBusy] = useState(false);
  const supabase = createClient();

  async function signOut() {
    setBusy(true);
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-4 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <ShieldOff className="h-7 w-7" />
      </span>
      <h1 className="mt-5 text-xl font-semibold text-ink">Access denied</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        Your access to this Sophira network has been revoked by the owner. You can no longer open the
        dashboard, assignments, or any of your saved academic work.
      </p>
      <p className="mt-3 text-xs leading-relaxed text-ink-soft">
        If you believe this is a mistake, contact the owner directly. Nothing was deleted — your
        access can be restored from the owner dashboard.
      </p>
      <Button className="mt-6" onClick={signOut} disabled={busy}>
        {busy ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}
