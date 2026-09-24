"use client";
import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      if (error.message.toLowerCase().includes("invalid login")) {
        setError("That email or password is not right. Please try again.");
      } else if (error.message.toLowerCase().includes("email not confirmed")) {
        setError("Please check your inbox and confirm your email first.");
      } else {
        setError(error.message);
      }
      return;
    }
    const next = search.get("next");
    router.push(next && next.startsWith("/") ? next : "/dashboard");
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
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full" size="lg">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      </form>

      <div className="mt-5 space-y-2 text-center text-sm">
        <p>
          <Link href="/reset-password" className="text-accent hover:underline">Forgot your password?</Link>
        </p>
        <p className="text-ink-soft">
          Have an invitation?{" "}
          <Link href="/signup" className="text-accent hover:underline">Create your account</Link>
        </p>
        <p>
          <Link href="/install" className="text-ink-soft hover:underline">Install the app</Link>
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
