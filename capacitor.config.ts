import type { CapacitorConfig } from "@capacitor/cli";

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
 * Set SOPHIRA_APP_URL before running/syncing, e.g.:
 *   SOPHIRA_APP_URL="https://your-sophira-domain" npx cap sync android
 * The placeholder below is overwritten per build in CI and documented in
 * docs/NATIVE_BUILDS.md. Never put secrets in this file.
 */
const config: CapacitorConfig = {
  appId: "com.bridgeline.sophira",
  appName: "Sophira",
  webDir: "public", // static fallback assets only; server.url is what loads
  server: {
    // The live Sophira deployment the shell loads. Override per environment.
    url: process.env.SOPHIRA_APP_URL || "https://sophira.example.com",
    cleartext: false, // HTTPS only — auth tokens must never cross plaintext
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

export default config;
