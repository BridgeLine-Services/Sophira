# Sophira Release Process

## Production web deployment (LIVE: https://sophira.vercel.app/)

The web app is deployed on Vercel from this repository (auto-deploy on
master push). For the deployment to function, the Vercel project needs
these **Production** environment variables (values from the Sophira
Supabase project's API settings — the anon key is the public browser key,
NEVER the service-role key):

- `NEXT_PUBLIC_SUPABASE_URL` — the Supabase project HTTPS URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Symptom when they are missing: every protected route returns
500 `MIDDLEWARE_INVOCATION_FAILED` ("Your project's URL and Key are
required to create a Supabase client!") while public pages (/install,
/downloads, /login) still render. Add both variables for the
**Production** environment and redeploy. Then set the repository
variable `SOPHIRA_APP_URL` to `https://sophira.vercel.app` — the native
shells load this URL.

## One-time repository configuration (Settings → Secrets and variables → Actions)

1. **Variable `SOPHIRA_APP_URL`** — the deployed Sophira web URL the native
   shells load. Every native build job REFUSES to run against the
   placeholder (`https://sophira.example.com`). Until the web app is deployed
   (Vercel/Netlify/your host) and this variable is set, no native release can
   honestly be produced.
2. **Android signing (optional but recommended):** generate a keystore
   (`keytool -genkey -v -keystore sophira-release.keystore -alias sophira
   -keyalg RSA -keysize 2048 -validity 10000`) and set secrets:
   `ANDROID_KEYSTORE_BASE64` (`base64 -w0 sophira-release.keystore`),
   `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
   Without them the pipeline publishes an HONEST unsigned APK
   (`Sophira-release-unsigned.apk`) and says so.
3. **iOS signing (required for any .ipa):** Apple Developer Program; set
   secrets `IOS_P12_BASE64`, `IOS_P12_PASSWORD`,
   `IOS_PROVISIONING_PROFILE_BASE64`, `IOS_TEAM_ID`. Distribution is
   ad-hoc (registered devices) — the App Store is NOT the only path, and the
   PWA always remains the no-requirements fallback.

**No secrets are ever committed.** The workflows decode credentials only on
the CI runner and never print them.

## Creating a release

```bash
git tag v1.0.0
git push origin v1.0.0
```

The release workflow then: runs the 144 tests, TypeScript check, production
build → Android APK (signed or honestly unsigned) → iOS archive (signed .ipa
export or honest unsigned archive) → desktop matrix (Windows .msi, macOS
.dmg, Linux .AppImage + .deb) → per-platform SHA256SUMS files → GitHub
Release with all artifacts and `ALL-CHECKSUMS.txt`.

Manual dispatch is also supported (Actions → Release → Run workflow) for
build runs without publishing.

## Artifact honesty table

| Artifact | Produced when | Name |
| --- | --- | --- |
| Android signed | ANDROID_* secrets set | Sophira-release.apk |
| Android unsigned | no secrets | Sophira-release-unsigned.apk |
| iOS signed | IOS_* secrets set | Sophira.ipa (ad-hoc) |
| iOS unsigned archive | no secrets | .xcarchive only, never called an .ipa |
| Windows | always | Sophira-windows.msi |
| macOS | always | Sophira-macos.dmg |
| Linux | always | Sophira-linux.AppImage + Sophira-linux.deb |

Each platform gets `SHA256SUMS-<platform>.txt` plus a merged
`ALL-CHECKSUMS.txt` in the release.

## Verifying a download

```bash
sha256sum Sophira-release.apk        # compare with the release checksum files
```

The in-app Downloads page also displays the per-artifact SHA-256 directly.

## CI (non-release)

`.github/workflows/ci.yml` runs on every push/PR: npm ci, the 144 tests,
TypeScript strict check, production build, and validation that the Android,
iOS and Tauri projects are intact. It fails loudly and never fabricates a
successful build.

## Current status (2026-09-26)

- Workflow definitions are complete in `.workflows-pending/` — the repo push
  credential lacks GitHub's `workflow` scope, so they must be moved to
  `.github/workflows/` (README in that folder has the exact commands).
- The first release additionally requires `SOPHIRA_APP_URL` (deploy the web
  app first) and, for signed artifacts, the secrets above.
