"use client";
import { Suspense, useState, type FormEvent, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { classifyAuthError } from "@/lib/auth-errors";
import { Button, Input, Label } from "@/components/ui";
import { Sparkles } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // First-owner path (2026-10-06): the CTA appears ONLY when the SERVER says
  // no owner exists yet (/api/setup-status ownerCreation - the same secure
  // server-side status used by /create-owner). Never a browser-only flag;
  // when the status cannot be checked the CTA simply stays hidden (fail
  // closed - /create-owner itself still gates honestly).
  const [ownerCreationOpen, setOwnerCreationOpen] = useState(false);
  // ?error=auth arrives from /auth/callback when a confirmation/recovery
  // link was expired, already used, or tampered with. It must be SHOWN -
  // previously it was silently ignored (the user just saw the login form).
  const [callbackError, setCallbackError] = useState<string | null>(null);
  // Plain-language database-connection notice (C is never confused with A/B):
  // shown only when the SERVER says the database cannot be reached - never
  // when an owner exists, and never with technical variable names or secrets.
  const [databaseUnreachable, setDatabaseUnreachable] = useState(false);
  useEffect(() => {
    fetch("/api/setup-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { ownerCreation?: { possible: boolean | null }; probe?: { database?: string } } | null) => {
        setOwnerCreationOpen(d?.ownerCreation?.possible === true);
        // null = cannot check (missing config / unreachable) — distinct from
        // "an owner exists", which sets possible=false and shows no notice.
        setDatabaseUnreachable(d?.ownerCreation?.possible === null && d?.probe?.database !== "checked");
      })
      .catch(() => {
        setOwnerCreationOpen(false);
        setDatabaseUnreachable(false);
      });
  }, []);

  useEffect(() => {
    if (search.get("error")) setCallbackError(
      "That sign-in link is not valid anymore - it may have expired or been used already. Sign in with your email and password below, or request a new link."
    );
  }, [search]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      // Classify honestly (src/lib/auth-errors.ts): invalid credentials stay
      // generic (never reveal account existence); unconfirmed email gets
      // confirmation guidance; transport/config failures are reported as
      // configuration problems, NOT as "wrong password".
      const classified = classifyAuthError({
        code: (error as { code?: string }).code ?? null,
        message: error.message,
        status: (error as { status?: number }).status ?? null,
      });
      setError(classified.userMessage);
      return;
    }
    const next = search.get("next");
    if (next && next.startsWith("/")) {
      router.push(next);
      router.refresh();
      return;
    }
    // Role routing (2026-10-07): the OWNER signs in to /owner, everyone
    // else to their /dashboard. (The dashboard also redirects owners, so
    // deep links keep working - this is the direct, expected landing.)
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user?.id ?? "")
      .single();
    router.push(profile?.role === "owner" ? "/owner" : "/dashboard");
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Link href="/install" className="mb-8 flex flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-white">
          <Sparkles className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-ink">Sophira</h1>
          <p className="text-sm text-ink-soft">Your private academic assistant</p>
        </div>
      </Link>

      <form onSubmit={onSubmit} className="rounded-card border border-ink/10 bg-white p-5 shadow-sm" noValidate>
        <div className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1.5"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1.5"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
            />
          </div>
          {callbackError && !error && (
            <p className="text-sm text-danger" role="alert">{callbackError}</p>
          )}
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full" size="lg">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      </form>

      {databaseUnreachable && (
        <div className="mt-5 rounded-lg border border-warn/30 bg-warn/5 p-4 text-center text-sm">
          <p className="text-ink-soft">
            Sophira is not connected to its database yet. An administrator needs to finish the server
            configuration — nothing is wrong with your account.{" "}
            <a href="/setup" className="text-accent hover:underline">See the setup status</a>
          </p>
        </div>
      )}

      {ownerCreationOpen && (
        <div className="mt-5 rounded-lg border border-success/30 bg-success/5 p-4 text-center">
          <p className="text-sm text-ink-soft">This Sophira has no owner yet.</p>
          <Link href="/create-owner" className="mt-2 inline-block rounded-lg bg-accent px-5 py-2.5 font-medium text-white">
            Create Owner Account
          </Link>
        </div>
      )}

      <div className="mt-5 space-y-2 text-center text-sm">
        <p>
          <Link href="/reset-password" className="text-accent hover:underline">Forgot your password?</Link>
        </p>
        <p className="text-ink-soft">
          Have an invitation?{" "}
          <Link href="/signup" className="text-accent hover:underline">Create your account</Link>
        </p>
        <p>
          <span className="flex items-center gap-3"><Link href="/install" className="text-ink-soft hover:underline">Install the app</Link><Link href="/terms" className="text-ink-soft hover:underline">Terms</Link><Link href="/privacy" className="text-ink-soft hover:underline">Privacy</Link></span>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
