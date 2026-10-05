# Sophira PWA Testing Guide — Direct-Browser/PWA Readiness (2026-10-05)

Everything in this guide needs ONLY a browser and the production URL.
**No App Store or Google Play download is required, or used.**

## The 10-point readiness verification

Statuses are honest: **VERIFIED (code/offline)** = verified against the
actual sources by the machine-checked suite (§26, 889+/889+); **PENDING
LIVE** = requires the deployed production URL and/or a physical device —
the owner runs the exact steps at the bottom to close them.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Run from the production URL | VERIFIED (code) / PENDING LIVE | `scripts/verify-deployment.mjs` + `/api/health` readiness rules; middleware serves the app + PWA shell. The production URL itself is the owner-side prerequisite (`SOPHIRA_APP_URL`). |
| 2 | Authenticate securely | VERIFIED (code) / PENDING LIVE | Supabase SSR auth (cookie sessions), middleware redirects unauthenticated users away from every app route (suite §1). |
| 3 | Invitation-only signup | VERIFIED (offline conformance) / PENDING LIVE | Signup without a valid invitation is refused at the DATABASE level, not the UI (migrations 0001/0002 + suite §23, tamper-tested). |
| 4 | Install to a supported mobile device | VERIFIED (code) / PENDING DEVICE | Valid manifest, correct 192/512/maskable icons, conservative SW, one-tap install path + exact Safari/Chrome steps on `/install`. |
| 5 | Retain authenticated state | VERIFIED (code) / PENDING DEVICE | Sessions persist in browser cookies (Supabase SSR); reload keeps you signed in; standalone PWA keeps the same cookie jar. |
| 6 | Load all required assets | VERIFIED | manifest.webmanifest is valid JSON with every required field; `icon-192.png` (192x192), `icon-512.png` (512x512), `apple-touch-icon.png` (180x180), `favicon-32.png` (32x32) all exist with the correct dimensions (machine-checked); Next assets load over the network. |
| 7 | Work after installation | VERIFIED (code) / PENDING DEVICE | `display: standalone`, `start_url: /dashboard`, scope `/`; the PWA shell (manifest/sw/icons) bypasses auth middleware by design so the installed app can boot. |
| 8 | Offline/online transitions | VERIFIED — and deliberately limited | The service worker caches ONLY static shell assets (`/_next/static/`, `/icons/`, the manifest). HTML and ALL API responses are NEVER cached (network-first, no fallback for user data). **There is NO offline AI, research, or solve functionality, and none is claimed.** Offline, the app shows the browser's connection state; on reconnect everything continues from the server. |
| 9 | Reconnect without losing persisted assignment state | VERIFIED (offline) | All assignment/learning/session data lives server-side (Supabase, RLS). The execution state machine is timestamp-driven and reconciles on load: a refresh mid-session/mid-break changes NOTHING (suite §19). Reconnect = refetch from the server; state is intact. Honest limit: input typed but not yet submitted could be lost in a mid-request drop — re-check the composer after a reconnect. |
| 10 | Clear installation path | VERIFIED | `/install` detects the platform, offers one-tap install where supported (Chrome/Edge), and shows exact step-by-step instructions for iPhone (Safari) and Android (Chrome), plus desktop. Linked from Settings → "Install on your phone". |

## Shared-device privacy (machine-checked)

The service worker's cache policy makes cross-user leakage via the cache
impossible: it never stores HTML, API responses, assignments, essays,
research, or any user content — only static, user-independent shell assets.
An offline/shared device cannot expose one student's academic data to
another through the cache. Sessions live in browser cookies: on a truly
shared device, sign out before handing the device over (same as any
website login).

## Machine checks (suite §26)

Manifest validity, exact icon dimensions, the SW's static-only cache gate,
the never-cache-user-data policy, middleware PWA-shell routing, and the
install-page instructions are all enforced by `npm test` on every run.

---

## Exact instructions for the owner's first live test

**Prerequisite (owner-side, once):** deploy Sophira with production
environment variables set (Supabase, AI key, search key), then set
`SOPHIRA_APP_URL` to that HTTPS deployment.

### 1. Opening the production URL
1. Open your browser (desktop is fine for this part).
2. Go to **`https://YOUR-SOPHIRA-DEPLOYMENT/`** (the value you set as
   SOPHIRA_APP_URL — never a placeholder).
3. You should land on the login page. You should NOT be able to open
   `/dashboard` without signing in (you get redirected).

### 2. Installing the PWA on Android
1. Open the production URL in **Chrome** on the Android device.
2. Sign in.
3. Go to **Settings → Install on your phone** (or open `/install`).
4. Either tap the **Install app** button on that page, or: **⋮ menu →
   Install app / Add to Home screen → Confirm**.
5. Sophira appears on the home screen with its own icon. Launch it from
   there — it opens full-screen, like any app. No Play Store involved.

### 3. Installing the PWA on iPhone
1. Open the production URL in **Safari** on the iPhone (iOS requires
   Safari for installs).
2. Sign in.
3. Open **Settings → Install on your phone** (or `/install`) and follow
   the on-screen steps, which are:
   **Share button (square with arrow) → Add to Home Screen → Add**.
4. Sophira appears on the home screen with its own icon. Launch it from
   there. No App Store involved.

### 4. Starting the first test
1. From the installed home-screen icon, launch Sophira — it should open
   standalone and still be signed in (session retained).
2. Open `/dashboard`: your course, assignments and learning state are all
   present (server-side persistence, not device storage).
3. Walk `docs/MASTER_ACCEPTANCE_WORKFLOW.md` steps 1-27 on the device,
   then record the result in `docs/DEVICE_ACCEPTANCE.md` (device model,
   OS version, date, result) so the release-gate device rows can turn
   PASS.
