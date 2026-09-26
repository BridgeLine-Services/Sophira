"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, CardContent, CardHeader, CardTitle, Spinner } from "@/components/ui";

/**
 * Sophira Downloads (workflow PART 11).
 *
 * Honest by design:
 * - The WEB/PWA section is always real — install instructions link to /install.
 * - The NATIVE section lists ONLY what the current GitHub release actually
 *   contains, fetched live from the public GitHub API. If there is no release
 *   (or an artifact has not been built yet), the page says so — it never
 *   claims an artifact that doesn't exist.
 * - Checksums are shown from the release's ALL-CHECKSUMS.txt when present.
 */

interface GhAsset {
  name: string;
  size: number;
  browser_download_url: string;
}
interface GhRelease {
  tag_name: string;
  published_at: string;
  assets: GhAsset[];
  html_url: string;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return Math.round(bytes / 1024) + " KB";
}

const NATIVE_KINDS: { match: RegExp; label: string; note: string }[] = [
  { match: /\.apk$/i, label: "Android app", note: "Install directly — no Google Play required (enable installs from your source in Android settings)." },
  { match: /\.ipa$/i, label: "iOS app", note: "Requires Apple's signing/provisioning rules (ad-hoc or App Store). The PWA needs none of that." },
  { match: /\.msi$/i, label: "Windows app", note: "Runs the standard Windows installer." },
  { match: /\.exe$/i, label: "Windows app", note: "Runs the standard Windows installer." },
  { match: /\.dmg$/i, label: "macOS app", note: "Drag to Applications from the disk image." },
  { match: /\.AppImage$/i, label: "Linux app", note: "Make executable and run — no installation needed." },
  { match: /\.deb$/i, label: "Linux app", note: "Standard Debian/Ubuntu package." },
];

export default function DownloadsPage() {
  const [release, setRelease] = useState<GhRelease | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none" | "error">("loading");

  useEffect(() => {
    fetch("https://api.github.com/repos/BridgeLine-Services/Sophira/releases/latest")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no release"))))
      .then((data: GhRelease) => {
        if (!data || !data.tag_name) throw new Error("no release");
        setRelease(data);
        setState("ready");
      })
      .catch(() => setState("none"));
  }, []);

  const nativeAssets = (release?.assets ?? []).filter((a) =>
    NATIVE_KINDS.some((k) => k.match.test(a.name)) && !/SHA256/i.test(a.name)
  );
  const checksumAsset = release?.assets.find((a) => /checksums/i.test(a.name));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Download Sophira</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One app, every platform. The web/PWA is always available; native packages appear here the moment a release contains them.
          </p>
        </div>
      </div>

      {/* WEB / PWA — always available, never store-gated */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Web / PWA
            <Badge tone="success">Always available — no app store needed</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Sophira is a Progressive Web App: open the site, sign in, and install it directly from the browser. It is
            <strong> not</strong> an App Store or Google Play download, and it never requires one.
          </p>
          <ul className="grid gap-2 sm:grid-cols-3">
            <li><Link href="/install" className="underline">Install on iPhone</Link></li>
            <li><Link href="/install" className="underline">Install on Android</Link></li>
            <li><Link href="/install" className="underline">Install on desktop</Link></li>
          </ul>
        </CardContent>
      </Card>

      {/* NATIVE — only what actually exists in the release */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Native apps
            {state === "ready" && release && (
              <Badge tone="accent">v{release.tag_name.replace(/^v/, "")} · {new Date(release.published_at).toLocaleDateString()}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {state === "loading" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Checking the current release…</div>
          )}

          {state === "none" && (
            <div className="rounded-lg bg-muted/40 p-4 text-sm">
              <p className="font-medium">No native release has been published yet.</p>
              <p className="mt-1 text-muted-foreground">
                Native packages (.apk, .ipa, Windows/macOS/Linux installers) appear here automatically once a GitHub
                release is created by the release pipeline. Until then, the PWA above is the fully supported way to use
                Sophira on every device — nothing is missing from it.
              </p>
            </div>
          )}

          {state === "error" && (
            <div className="rounded-lg bg-muted/40 p-4 text-sm">
              <p className="font-medium">Couldn&apos;t check the current release.</p>
              <p className="mt-1 text-muted-foreground">
                GitHub couldn&apos;t be reached just now. Try again in a moment — the PWA above works regardless.
              </p>
            </div>
          )}

          {state === "ready" && nativeAssets.length === 0 && (
            <div className="rounded-lg bg-muted/40 p-4 text-sm">
              <p className="font-medium">Release v{release!.tag_name.replace(/^v/, "")} has no native packages yet.</p>
              <p className="mt-1 text-muted-foreground">
                The release exists, but no native artifact was attached to it. The PWA above is the supported install.
              </p>
            </div>
          )}

          {state === "ready" && nativeAssets.length > 0 && (
            <ul className="divide-y">
              {nativeAssets.map((a) => {
                const kind = NATIVE_KINDS.find((k) => k.match.test(a.name))!;
                return (
                  <li key={a.name} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">{kind.label} <span className="font-normal text-muted-foreground">({a.name})</span></p>
                      <p className="text-xs text-muted-foreground">{fmtSize(a.size)} · {kind.note}</p>
                    </div>
                    <a
                      href={a.browser_download_url}
                      className="inline-flex h-8 shrink-0 items-center rounded-lg border border-ink/15 bg-white px-3 text-sm font-medium text-ink transition-colors hover:bg-accent/5"
                    >
                      Download
                    </a>
                  </li>
                );
              })}
            </ul>
          )}

          {state === "ready" && checksumAsset && (
            <p className="mt-4 text-xs text-muted-foreground">
              SHA-256 checksums:{" "}
              <a href={checksumAsset.browser_download_url} className="underline">{checksumAsset.name}</a>
              <br />
              Verify after download: <code className="rounded bg-muted px-1 py-0.5">sha256sum -c</code> against the file list.
            </p>
          )}

          {state === "ready" && (
            <p className="mt-4 text-xs text-muted-foreground">
              Full release notes on GitHub:{" "}
              <a href={release!.html_url} className="underline" target="_blank" rel="noreferrer">{release!.html_url}</a>
            </p>
          )}

          <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
            Notes: the PWA never requires App Store or Google Play. The Android APK installs directly wherever your
            device settings allow it. iOS .ipa distribution follows Apple&apos;s signing/provisioning rules (ad-hoc for
            registered devices, or App Store) — the PWA is the no-requirements path. Desktop apps are independent
            downloads and get their updates from the same release pipeline.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
