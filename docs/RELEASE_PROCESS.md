# Sophira Release Process

## Production web deployment (LIVE: https://sophira.vercel.app/)

The web app is deployed on Vercel from this repository (auto-deploy on
master push). For the deployment to function, the Vercel project needs
these **Production** environment variables (values from the Sophira
Supabase project's API settings — the anon key is the public browser key,
NEVER the service-role key):

- `NEXT_PUBLIC_SUPABASE_URL` — the Supabase project HTTPS URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server-only (needed by admin routes)
- `OPENAI_API_KEY` (+ `OPENAI_BASE_URL`, `SOPHIRA_MODEL`) — AI features
- `SEARCH_PROVIDER` / `SEARCH_API_KEY` (optional) — verified web research
- `NEXT_PUBLIC_SITE_URL` — the public URL, used in invitation links

**Verify the deployment in one command** (matcher-excluded from the auth
middleware, works even while degraded):

```bash
curl -s https://your-sophira-domain/api/health
# {"ok":true,"name":"sophira","configuration":{"supabase":true,"supabase_service_role":true,"ai":true,"search":true}}
```

Every capability reports an honest boolean — no values are ever exposed.
A `false` names exactly what still needs configuring: `supabase` false
means protected routes stay in degraded mode (redirect to /login, no
500s — the §27 fix); `ai` false means every AI feature returns a clear
503 "not configured"; `search` false means the research workflow reports
honestly instead of fabricating sources. A deployment is production-ready
when `supabase`, `supabase_service_role` and `ai` are `true` (`search` is
optional).

**Machine-enforced (2026-10-05):** the release workflow now refuses to
ship native shells against a misconfigured deployment — each native job
runs `node scripts/verify-deployment.mjs "$SOPHIRA_APP_URL"`, which
checks the live `/api/health` of the target and fails the release when
any required capability is `false`. Locally:

```bash
node scripts/verify-deployment.mjs https://your-sophira-domain
```

## Legal documents (owner facts + attorney review)

The ToS / Privacy Policy / LICENSE templates are complete except for the
bracketed owner facts (legal entity, address, jurisdiction, contact,
effective date). They are machine-visible:

```bash
npm run legal:status   # or: node scripts/legal-status.mjs --json
```

The script exits 0 once every owner fact is filled in. Completing them is
an owner action, and qualified counsel must review before production use
(see docs/legal/LEGAL_REVIEW_NOTICE.md).

**One-time Supabase bootstrap (fresh installs only).** Migration 0008
makes signup invitation-only at the database level and fail-closed: no
account at all can be created until the owner email is configured. In the
Supabase SQL editor, once, replacing the address with the real owner:

```sql
insert into public.app_config (key, value)
values ('owner_email', to_jsonb('owner@example.com'::text))
on conflict (key) do update set value = excluded.value;
```

(Already documented in README setup step 3; repeated here because the
release checklist is the operator's bring-up path.) Until this runs, the
first signup is rejected with a clear operator-facing message — intended
fail-closed behavior.

After the environment is configured, set the repository
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

The release workflow then: runs the offline test suite (285 assertions), TypeScript check, production
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

`.github/workflows/ci.yml` runs on every push/PR: npm ci, the offline test suite (285 assertions; the CI step label still says "144" from an older round — cosmetic only),
TypeScript strict check, production build, and validation that the Android,
iOS and Tauri projects are intact. It fails loudly and never fabricates a
successful build.

## Current status (2026-09-26)

- **DONE (2026-09-27): workflows are ACTIVE** at `.github/workflows/ci.yml`
  and `.github/workflows/release.yml`; first CI run passed green.
  `.workflows-pending/` is retained only as reference.
- The first release additionally requires `SOPHIRA_APP_URL` (deploy the web
  app first) and, for signed artifacts, the secrets above.
