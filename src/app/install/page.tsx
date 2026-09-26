"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from "@/components/ui";
import { Apple, Download, Smartphone, Check, Monitor } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function InstallCard() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setOutcome("installed");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (window.matchMedia("(display-mode: standalone)").matches) setInstalled(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    setOutcome(outcome);
    if (outcome === "accepted") setInstalled(true);
  }

  const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const [nativeLabel, setNativeLabel] = useState<string | null>(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    if (/iphone|ipad|ipod/i.test(ua)) setNativeLabel("the iOS app (.ipa — Apple signing rules apply)");
    else if (/android/i.test(ua)) setNativeLabel("the Android app (.apk — installs directly, no Google Play)");
    else if (/windows/i.test(ua)) setNativeLabel("the Windows app");
    else if (/mac os x/i.test(ua)) setNativeLabel("the macOS app");
    else if (/linux/i.test(ua)) setNativeLabel("the Linux app");
  }, []);

  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-accent" />
          <CardTitle>Install Sophira on this device</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {installed ? (
          <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm text-success">
            <Check className="h-4 w-4" /> Sophira is installed — you&apos;re running it as an app right now.
          </div>
        ) : promptEvent ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">Your browser supports one-tap installation.</p>
            <Button onClick={install}>
              <Download className="h-4 w-4" /> Install app
            </Button>
            {outcome === "dismissed" && <p className="text-sm text-ink-soft">No problem — you can install any time from this page.</p>}
          </div>
        ) : (
          <p className="text-sm text-ink-soft">
            {isIOS
              ? "Your browser doesn't show a one-tap install button, but the steps below take under a minute."
              : "Your browser hasn't offered one-tap install yet — use the steps below."}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-ink/10 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
              <Apple className="h-4 w-4" /> iPhone / iPad (Safari)
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
              <li>Open this page in <strong>Safari</strong>.</li>
              <li>Tap the <strong>Share</strong> button (the square with an arrow).</li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
              <li>Tap <strong>Add</strong>. Sophira now has its own icon, like any app.</li>
            </ol>
          </div>
          <div className="rounded-lg border border-ink/10 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
              <Smartphone className="h-4 w-4" /> Android (Chrome)
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
              <li>Open this page in <strong>Chrome</strong>.</li>
              <li>Tap the <strong>⋮ menu</strong> (top right).</li>
              <li>Tap <strong>Install app</strong> (or &quot;Add to Home screen&quot;).</li>
              <li>Confirm. Sophira now has its own icon, like any app.</li>
            </ol>
          </div>
        </div>

        <div className="rounded-lg border border-ink/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
            <Monitor className="h-4 w-4" /> Desktop (Chrome, Edge, Safari)
          </div>
          <p className="text-sm text-ink-soft">
            No installation needed — Sophira runs in the browser at full functionality. Chrome and Edge also offer{" "}
            <strong>Install</strong> / <strong>Add shortcut</strong> from the address-bar icon for an app-like window.
            Your sign-in persists like any website login.
          </p>
        </div>

        <p className="text-xs leading-relaxed text-ink-soft">
          This installs Sophira as a Progressive Web App — it gets its own icon and full-screen window and keeps you signed
          in, but it is not an App Store / Google Play download. App stores are not required to use Sophira.
        </p>
      </CardContent>
    </Card>

    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Prefer a native app?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-ink-soft">
          {nativeLabel ? (
            <>
              For your device, the native option is <strong>{nativeLabel}</strong>. Native packages are optional — the
              web app above is the same Sophira with nothing held back.
            </>
          ) : (
            <>Native packages exist for iPhone, iPad, Android, Windows, macOS and Linux. The web app above is the same Sophira with nothing held back.</>
          )}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={install}>
            <Download className="h-4 w-4" /> Install web app
          </Button>
          <Link href="/downloads">
            <Button variant="secondary">Download native apps</Button>
          </Link>
        </div>
        <p className="text-xs text-ink-soft">
          The downloads page lists only packages the current release actually contains — if a native build hasn&apos;t
          been published yet, it will say so honestly. The PWA is always available and never requires a store account.
        </p>
      </CardContent>
    </Card>
    </>
  );
}

export default function InstallPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-ink">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">S</span>
          Sophira
        </Link>
        <Badge tone="accent">Private academic assistant</Badge>
      </div>
      <InstallCard />
      <p className="mt-6 text-center text-sm">
        <Link href="/dashboard" className="text-accent hover:underline">Back to Sophira</Link>
      </p>
    </div>
  );
}
