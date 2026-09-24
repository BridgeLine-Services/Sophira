"use client";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label, Badge } from "@/components/ui";
import { Sparkles, MailCheck } from "lucide-react";
import type { Invitation } from "@/lib/types";

function SignUpForm() {
  const router = useRouter();
  const search = useSearchParams();
  const supabase = createClient();
  const token = search.get("invite") || "";
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [checking, setChecking] = useState(true);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needConfirm, setNeedConfirm] = useState(false);

  useEffect(() => {
    if (!token) {
      setChecking(false);
      return;
    }
    (async () => {
      const { data } = await supabase.rpc("get_invitation_by_token", { p_token: token });
      setInvitation((data as Invitation) ?? null);
      setChecking(false);
    })();
  }, [token, supabase]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!invitation) return;
    if (password.length < 8) {
      setError("Please choose a password with at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: invitation.email,
      password,
      options: { data: { display_name: fullName.trim() } },
    });
    if (signUpError) {
      setBusy(false);
      if (signUpError.message.toLowerCase().includes("already registered")) {
        setError("That email already has an account. Try signing in instead, or use the reset-password link if you forgot it.");
      } else {
        setError(signUpError.message);
      }
      return;
    }
    // Mark the invitation used (best effort — failure doesn't block signup).
    fetch("/api/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => undefined);

    if (data.session) {
      router.push("/onboarding");
      router.refresh();
    } else {
      setBusy(false);
      setNeedConfirm(true);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center gap-2 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-white">
          <Sparkles className="h-6 w-6" />
        </span>
        <h1 className="text-xl font-semibold text-ink">Create your Sophira account</h1>
        <Badge tone="accent">Invite-only</Badge>
      </div>

      {checking ? (
        <p className="text-center text-sm text-ink-soft">Checking your invitation…</p>
      ) : !token || !invitation ? (
        <div className="rounded-card border border-ink/10 bg-white p-5 text-center shadow-sm">
          <p className="font-medium text-ink">Sophira is invite-only</p>
          <p className="mt-2 text-sm text-ink-soft">
            Ask the owner to send you a personal invitation link, then open that link to sign up.
            {token ? " This link looks expired or already used — ask for a new one." : ""}
          </p>
          <Link href="/login" className="mt-4 inline-block text-sm text-accent hover:underline">
            I already have an account
          </Link>
        </div>
      ) : needConfirm ? (
        <div className="rounded-card border border-ink/10 bg-white p-5 text-center shadow-sm">
          <MailCheck className="mx-auto h-8 w-8 text-accent" />
          <p className="mt-2 font-medium text-ink">Check your inbox</p>
          <p className="mt-2 text-sm text-ink-soft">
            Confirm your email via the link we sent to {invitation.email}, then sign in.
          </p>
          <Link href="/login" className="mt-4 inline-block text-sm text-accent hover:underline">
            Go to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="rounded-card border border-ink/10 bg-white p-5 shadow-sm" noValidate>
          <p className="mb-4 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
            You were invited as <strong>{invitation.email}</strong>
          </p>
          <div className="space-y-4">
            <div>
              <Label htmlFor="fullname">Your name</Label>
              <Input
                id="fullname"
                className="mt-1.5"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="How should I greet you?"
              />
            </div>
            <div>
              <Label htmlFor="password">Choose a password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                className="mt-1.5"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full" size="lg">
              {busy ? "Creating your account…" : "Create account"}
            </Button>
          </div>
        </form>
      )}

      <p className="mt-5 text-center text-sm">
        <Link href="/login" className="text-accent hover:underline">I already have an account</Link>
      </p>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
