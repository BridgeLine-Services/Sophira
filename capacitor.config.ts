import type { CapacitorConfig } from "@capacitor/cli";
import { resolveNativeServerUrl } from "./src/lib/native-url";

/**
 * Sophira native shell configuration (iOS + Android via Capacitor).
 *
 * ARCHITECTURE: the Next.js app uses server-side rendering and server API
 * routes (Supabase auth, AI, learning), so it cannot be bundled as a static
 * site. The native apps therefore load the DEPLOYED Sophira web app through
 * `server.url` — the web app remains the single canonical implementation
 * (workflow rule: do not fork core logic between desktop/native and web).
 * Everything (auth, uploads, camera/photo input, PWA workflows) runs inside
 * the native WebView exactly as in the browser.
 *
 * NO SILENT FALLBACK (2026-10-05): the old placeholder fallback
 * (https://sophira.example.com) was REMOVED. URL resolution is validated by
 * src/lib/native-url.ts (unit-tested in tests/run.ts §21):
 *
 *   - RELEASE builds (SOPHIRA_NATIVE_RELEASE=1, used by android:build and
 *     the release workflow): SOPHIRA_APP_URL must be defined, valid, https,
 *     and NOT a placeholder — otherwise this file THROWS and the build fails.
 *   - DEVELOPMENT builds (cap:sync / android:debug): SOPHIRA_APP_URL wins
 *     when provided (strictly validated); otherwise the explicit
 *     development configuration is used (SOPHIRA_DEV_URL →
 *     NEXT_PUBLIC_SITE_URL → http://localhost:3000), chosen loudly.
 *
 * Never put secrets in this file.
 */
const resolved = resolveNativeServerUrl(process.env);

const config: CapacitorConfig = {
  appId: "com.bridgeline.sophira",
  appName: "Sophira",
  webDir: "public", // static fallback assets only; server.url is what loads
  server: {
    // The live Sophira deployment the shell loads — validated, never a
    // silent placeholder. Cleartext is allowed only for http://localhost.
    url: resolved.url,
    cleartext: resolved.cleartext,
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#faf9f7",
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#faf9f7",
  },
};

// Loudly state what the shell will load — no silent anything.
if (process.env.SOPHIRA_QUIET !== "1") {
  console.info(
    `[sophira] Native shell will load ${resolved.url} (${resolved.basis}, ${resolved.mode} build)`
  );
}

export default config;
