# Sophira Native Builds — iOS (.ipa), Android (.apk), Desktop (Tauri)

## Architecture (why the shells load the live app)

Sophira's Next.js app uses server-side rendering and **server API routes**
(Supabase auth, AI, learning persistence), so it cannot be exported as a
static bundle. The native targets therefore wrap the **deployed Sophira web
app**:

- **Android** — Capacitor (`android/`), real Gradle project, loads the
  deployment via `server.url`.
- **iOS** — Capacitor (`ios/`), real Xcode project, loads the deployment via
  `server.url`.
- **Desktop** — Tauri v2 (`src-tauri/`), real Rust application, opens a native
  window at the deployment URL.

The web app stays the single canonical implementation. No core logic is forked
into native targets; auth, uploads, camera input and every workflow behave
exactly as in the browser. No secrets are bundled anywhere — the apps simply
load your HTTPS deployment.

## Set the deployment URL

All builds read the URL from one place:

| Target | Config | Where to change |
| --- | --- | --- |
| Android/iOS | `capacitor.config.ts` → `server.url` | `SOPHIRA_APP_URL` env var during `npx cap sync` |
| Desktop | `src-tauri/tauri.conf.json` → `app.windows[0].url` | edit, or CI sets it from the variable |
| CI | repository **variable** `SOPHIRA_APP_URL` | Settings → Secrets and variables → Actions → Variables |

The placeholder `https://sophira.example.com` is deliberately refused by the
release pipeline.

## Android

Prereqs: Node 20, JDK 17, Android SDK (API 34+).

```bash
npm ci
SOPHIRA_APP_URL="https://your-sophira-domain" npx cap sync android
cd android
./gradlew assembleDebug     # app-debug.apk — direct install for testing
./gradlew assembleRelease   # release APK (unsigned unless keystore env vars are set)
```

Output: `android/app/build/outputs/apk/…`. Rename to `Sophira-release.apk`.

### Release signing

Set these **GitHub secrets** (never commit them):

- `ANDROID_KEYSTORE_BASE64` — `base64 -w0 sophira-release.keystore`
- `ANDROID_STORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

`android/app/build.gradle` reads them at build time. Generate a keystore
locally with:

```bash
keytool -genkey -v -keystore sophira-release.keystore -alias sophira \
  -keyalg RSA -keysize 2048 -validity 10000
```

Unsigned release APKs install via `adb install` or after manual signing
(`apksigner`). The signed release APK installs directly on any Android
device with "install unknown apps" allowed — **no Google Play required**.

## iOS

Prereqs: **macOS** with Xcode 15+ and an Apple Developer account for signed
builds.

```bash
npm ci
SOPHIRA_APP_URL="https://your-sophira-domain" npx cap sync ios
npx cap open ios   # opens Xcode: set your Team, then Product → Archive
```

CLI archive (what CI does):

```bash
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/Sophira.xcarchive archive
xcodebuild -exportArchive -archivePath build/Sophira.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/ipa   # → Sophira.ipa
```

### Signing (the honest requirement)

An installable `.ipa` **requires Apple's signing and provisioning**:

1. Apple Developer Program membership.
2. A distribution certificate (`.p12`) + provisioning profile (ad-hoc for
   registered devices, or App Store).
3. CI secrets: `IOS_P12_BASE64`, `IOS_P12_PASSWORD`,
   `IOS_PROVISIONING_PROFILE_BASE64`, `IOS_TEAM_ID`.

Without those, the pipeline produces an **unsigned archive** and says so —
it never fakes a signed build. Ad-hoc distribution installs on up to 100
registered devices per membership year without the App Store.

App-identifier: `com.bridgeline.sophira`. Bundle version tracks
`package.json`.

## Desktop (Windows / macOS / Linux)

Prereqs: Node 20, Rust stable, platform build tools (Linux:
`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev`).

```bash
npm ci
# point the shell at your deployment first (tauri.conf.json url)
npx tauri build            # release bundles
npx tauri dev              # dev window
```

Outputs in `src-tauri/target/release/bundle/`:

- Windows: `.msi` installer (contains `Sophira.exe`)
- macOS: `.dmg`
- Linux: `.AppImage` + `.deb`

No secrets are bundled; the window loads your HTTPS deployment. Icons were
generated with `npx tauri icon public/icons/icon-512.png` (regenerate the same
way if you replace the brand icon).

## Release pipeline (.github/workflows/release.yml)

On a `v*` tag: tests → tsc → build → Android APK → iOS archive/ipa → desktop
matrix (linux/windows/macos) → SHA-256 checksums → GitHub release with all
artifacts attached.

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Required repo configuration (Settings → Secrets and variables → Actions):

- Variable: `SOPHIRA_APP_URL`
- Optional secrets for signing: the `ANDROID_*` and `IOS_*` sets above.

CI (`.github/workflows/ci.yml`) runs tests, TypeScript and the production
build on every push/PR — unsigned and unprivileged; it cannot touch secrets.

## Distribution summary (what the downloads page says)

- **PWA** — no store required, always available. This is the primary path.
- **Android APK** — direct install; enable installs from your chosen source.
- **iOS IPA** — Apple's signing rules apply (ad-hoc for registered devices or
  App Store). The PWA needs none of that.
- **Desktop** — independent downloads from the same releases.
