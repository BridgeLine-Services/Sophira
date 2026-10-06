"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/**
 * FIRST-OWNER REGISTRATION (migration 0025).
 *
 * The owner experience: open Sophira, create the owner account with an
 * email and a password of their choosing - no database editing, no API
 * keys, no deployment secrets. The DATABASE decides ownership: the first
 * completed registration atomically claims the single owner slot and
 * owner creation closes permanently afterwards.
 *
 * Honesty contract (never fake anything):
 *  - if an owner already exists, say so - never offer a second one;
 *  - if the owner slot was claimed while this page was open (a lost
 *    race), say so plainly instead of claiming success;
 *  - no technical variable names, no secrets, no invented states.
 */

interface SetupStatus {
  ownerCreation: { possible: boolean | null; reason: string; url: string };
  probe: { ownerAccount?: string };
}

export default function CreateOwnerPage() {
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/setup-status", { cache: "no-store" });
      if (r.ok) setStatus(await r.json());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  const ownerExists = status?.probe?.ownerAccount === "active" || status?.probe?.ownerAccount === "revoked";
  const mayCreate = status?.ownerCreation?.possible === true;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Please choose a password of at least 8 characters."); return; }
    if (password !== confirm) { setError("The two passwords do not match."); return; }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        // The database rejects a lost race and any non-invited signup with
        // the honest invitation message - surface it plainly, never fake success.
        setError(signUpError.message.includes("invitation")
          ? "Owner creation is no longer available - an owner account may have just been created, or this email needs an invitation."
          : signUpError.message);
        await refreshStatus();
        return;
      }
      setDone(true);
      await refreshStatus();
      router.push("/owner");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">Create your owner account</h1>
      <p className="mt-2 text-ink-soft">
        This is your private Sophira. The first account created here becomes the owner - you pick your own password,
        and no technical setup is needed. After this, owner creation closes permanently and new people join by invitation only.
      </p>

      {ownerExists && (
        <div className="mt-6 rounded-lg border border-warn/30 bg-warn/5 p-4 text-sm">
          An owner account already exists, so a second one cannot be created. If it is yours,
          {" "}<Link href="/login" className="text-accent hover:underline">sign in here</Link>. If that is unexpected, see the{" "}
          <Link href="/setup" className="text-accent hover:underline">technical diagnostics</Link>.
        </div>
      )}

      {!ownerExists && !mayCreate && status && (
        <div className="mt-6 rounded-lg border border-warn/30 bg-warn/5 p-4 text-sm">
          {status.ownerCreation.reason}
        </div>
      )}

      {!ownerExists && (mayCreate || status === null) && !done && (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">
            Your email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink/15 px-3 py-2" autoComplete="email" />
          </label>
          <label className="block text-sm font-medium">
            Choose a password
            <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink/15 px-3 py-2" autoComplete="new-password" />
          </label>
          <label className="block text-sm font-medium">
            Repeat the password
            <input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink/15 px-3 py-2" autoComplete="new-password" />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-white disabled:opacity-60">
            {busy ? "Creating..." : "Create owner account"}
          </button>
        </form>
      )}

      {done && (
        <div className="mt-6 rounded-lg border border-success/30 bg-success/5 p-4 text-sm">
          Your account is ready. Taking you to the owner dashboard - from there you can invite people by email.
        </div>
      )}
    </main>
  );
}
