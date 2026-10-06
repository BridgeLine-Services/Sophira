"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, CardContent, CardHeader, CardTitle, Spinner } from "@/components/ui";

/**
 * Sophira Downloads (release spec §15).
 *
 * Honest by design:
 * - WEB/PWA is always listed — install instructions link to /install.
 * - NATIVE sections list ONLY assets the current GitHub release actually
 *   contains, fetched live from the public GitHub API. No release / no
 *   artifact -> the page says so; it never shows a download button for an
 *   artifact that doesn't exist.
 * - SHA-256 hashes are read from the release's checksum file when fetchable;
 *   otherwise the checksum file itself is offered as the download (with
 *   verification instructions).
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

type Platform = "ios" | "android" | "windows" | "macos" | "linux";

const PLATFORMS: { key: Platform; label: string; note: string; match: RegExp }[] = [
  { key: "ios", label: "iPhone / iPad", note: "iOS app (.ipa) — Apple signing rules apply (ad-hoc for registered devices, or App Store). The PWA needs none of that.", match: /\.(ipa)$/i },
  { key: "android", label: "Android", note: "Android app (.apk) — installs directly, no Google Play required (allow installs from your chosen source in Android settings).", match: /\.(apk)$/i },
  { key: "windows", label: "Windows", note: "Windows installer (.msi) — runs the standard installer.", match: /\.(msi|exe)$/i },
  { key: "macos", label: "macOS", note: "macOS app (.dmg) — drag Sophira to Applications from the disk image.", match: /\.(dmg)$/i },
  { key: "linux", label: "Linux", note: "Linux app — .AppImage runs anywhere (make it executable); .deb for Debian/Ubuntu.", match: /\.(AppImage|deb|rpm)$/i },
];

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return Math.round(bytes / 1024) + " KB";
}

export default function DownloadsPage() {
  const [release, setRelease] = useState<GhRelease | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none">("loading");
  const [checksums, setChecksums] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("https://api.github.com/repos/BridgeLine-Services/Sophira/releases/latest")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no release"))))
      .then(async (data: GhRelease) => {
        if (!data?.tag_name) throw new Error("no release");
        if (cancelled) return;
        setRelease(data);
        setState("ready");
        // Best effort: read per-artifact SHA-256 lines from the release's
        // checksum file. If CORS or the network blocks it, we degrade
        // gracefully to linking the checksum file itself.
        const cs = data.assets.find((a) => /checksums/i.test(a.name));
        if (cs) {
          try {
            const txt = await fetch(cs.browser_download_url).then((r) => (r.ok ? r.text() : null));
            if (txt && !cancelled) {
              const map: Record<string, string> = {};
              for (const line of txt.split("\n")) {
                const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(\S+)/);
                if (m) map[m[2]] = m[1];
              }
              setChecksums(map);
            }
          } catch {
            /* graceful fallback below */
          }
        }
      })
      .catch(() => !cancelled && setState("none"));
    return () => {
      cancelled = true;
    };
  }, []);

  const assets = release?.assets ?? [];
  const appAssets = assets.filter((a) => /\.(ipa|apk|msi|exe|dmg|AppImage|deb|rpm)$/i.test(a.name));
  const checksumAsset = assets.find((a) => /checksums/i.test(a.name));
  const version = release ? release.tag_name.replace(/^v/, "") : null;
  const date = release ? new Date(release.published_at).toLocaleDateString() : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Download Sophira</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One app, every platform. The web/PWA is always available; native packages appear here the moment a release
          actually contains them.
        </p>
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
            <strong> not</strong> an App Store or Google Play download, and it never requires one. Works on every
            platform below, and stays your fallback if a native package is ever unavailable.
          </p>
          <ul className="grid gap-2 sm:grid-cols-3">
            <li><Link href="/install" className="underline">Install on iPhone</Link></li>
            <li><Link href="/install" className="underline">Install on Android</Link></li>
            <li><Link href="/install" className="underline">Install on desktop</Link></li>
          </ul>
          <p className="text-muted-foreground">Or simply keep using Sophira in your browser — nothing is held back.</p>
        </CardContent>
      </Card>

      {/* NATIVE — only what actually exists in the release */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Native apps
            {version && date && <Badge tone="accent">v{version} · {date}</Badge>}
            <Badge tone="warn">TEST BUILD</Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Test Build: these artifacts come from the test/private channel and may not be production-signed.
            Unsigned artifacts are labeled honestly and their install requirements are stated.
          </p>
        </CardHeader>
        <CardContent>
          {state === "loading" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Checking the current release…
            </div>
          )}

          {state === "none" && (
            <div className="rounded-lg bg-muted/40 p-4 text-sm">
              <p className="font-medium">No native release has been published yet.</p>
              <p className="mt-1 text-muted-foreground">
                Native packages (.apk, .ipa, Windows/macOS/Linux installers) appear here automatically once the release
                pipeline publishes a GitHub release. Until then, the PWA above is the fully supported way to use
                Sophira on every device — nothing is missing from it.
              </p>
            </div>
          )}

          {state === "ready" && appAssets.length === 0 && (
            <div className="rounded-lg bg-muted/40 p-4 text-sm">
              <p className="font-medium">Release v{version} has no native packages attached.</p>
              <p className="mt-1 text-muted-foreground">
                The release exists, but no native artifact was attached to it. The PWA above is the supported install.
              </p>
            </div>
          )}

          {state === "ready" && appAssets.length > 0 && (
            <div className="space-y-5">
              {PLATFORMS.map((pl) => {
                const mine = appAssets.filter((a) => pl.match.test(a.name));
                if (mine.length === 0 && pl.key !== "ios") return null;
                if (mine.length === 0) {
                  // iOS honesty: no .ipa in this release — never claim an
                  // unsigned archive installs like a normal app.
                  return (
                    <div key={pl.key} className="rounded-lg bg-muted/40 p-3 text-sm">
                      <p className="font-medium">iPhone / iPad — no installable .ipa in this release</p>
                      <p className="mt-1 text-muted-foreground">
                        Apple devices cannot install an unsigned app, and iOS has no &quot;install unknown apps&quot;
                        switch — that is Apple&apos;s rule, not a missing download. The supported paths are:
                      </p>
                      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                        <li>PWA now: open Sophira in Safari, Share → Add to Home Screen (no Apple signing needed).</li>
                        <li>Development/ad-hoc: configure the Apple signing secrets in the repository, then the
                          release pipeline exports a real signed .ipa installable on registered devices via Xcode
                          or Apple Configurator.</li>
                        <li>TestFlight: upload the signed build to App Store Connect and invite testers — Apple
                          then handles distribution and device trust.</li>
                      </ul>
                    </div>
                  );
                }
                return (
                  <div key={pl.key}>
                    <p className="mb-2 text-sm font-semibold">{pl.label}</p>
                    <ul className="divide-y rounded-lg border">
                      {mine.map((a) => {
                        const unsigned = /unsigned/i.test(a.name);
                        const hash = checksums?.[a.name];
                        return (
                          <li key={a.name} className="space-y-1 p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {a.name}
                                  {/\.apk$/i.test(a.name) && (
                                    <Badge tone={unsigned ? "warn" : "accent"} className="ml-2">
                                      {unsigned ? "UNSIGNED APK" : "SIGNED APK"}
                                    </Badge>
                                  )}
                                  {/\.ipa$/i.test(a.name) && (
                                    <Badge tone="accent" className="ml-2">SIGNED IPA</Badge>
                                  )}
                                  {!/\.(apk|ipa)$/i.test(a.name) && unsigned && (
                                    <Badge tone="warn" className="ml-2">unsigned</Badge>
                                  )}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  v{version} · {date} · {fmtSize(a.size)}
                                </p>
                              </div>
                              <a
                                href={a.browser_download_url}
                                className="inline-flex h-8 shrink-0 items-center rounded-lg border border-ink/15 bg-white px-3 text-sm font-medium text-ink transition-colors hover:bg-accent/5"
                              >
                                Download
                              </a>
                            </div>
                            {hash ? (
                              <p className="break-all font-mono text-[11px] text-muted-foreground">
                                SHA-256: {hash}
                              </p>
                            ) : (
                              <p className="text-[11px] text-muted-foreground">
                                SHA-256:{" "}
                                {checksumAsset ? (
                                  <a href={checksumAsset.browser_download_url} className="underline">
                                    in {checksumAsset.name}
                                  </a>
                                ) : (
                                  "see the release page"
                                )}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">{pl.note}</p>
                            {unsigned && /\.apk$/i.test(a.name) && (
                              <p className="text-xs text-amber-700">
                                Installation requirements: this APK has no release signature. Install it with{" "}
                                <code>adb install Sophira-release-unsigned.apk</code> from Android platform-tools, or
                                sign it first with your own key (<code>apksigner</code>) and then enable
                                &quot;install unknown apps&quot; for your chosen source. Android will refuse to install
                                an unsigned APK by tapping it.
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}

              <p className="border-t pt-4 text-xs text-muted-foreground">
                Verify a download: <code className="rounded bg-muted px-1 py-0.5">sha256sum Sophira-release.apk</code>{" "}
                and compare with the hash above or in the release&apos;s checksum files. Full release notes:{" "}
                <a href={release!.html_url} className="underline" target="_blank" rel="noreferrer">{release!.html_url}</a>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
