# What I Need to Do Next — the one owner checklist

You never need a terminal, SQL, or code. Each step below says exactly where to
click. Full status details live in docs/COMPLETION_REPORT.md (the authoritative
report, updated 2026-10-13). Details for steps 1-2: docs/WORD_GOOGLE_DOCS_SETUP.md.

## 1. Turn on "Save to Word" and "Save to Google Docs" (about 20 minutes)
- Microsoft: https://entra.microsoft.com -> App registrations -> New registration.
  Name it Sophira. Add redirect URI:
  `https://sophira.vercel.app/api/integrations/microsoft/callback`
  Create a client secret. Copy the Application (client) ID and the secret VALUE.
- Google: https://console.cloud.google.com -> enable "Google Docs API" and
  "Google Drive API" -> Credentials -> Create OAuth client ID (Web application)
  with redirect URI:
  `https://sophira.vercel.app/api/integrations/google/callback`
- Put the four values in Vercel (never in chat, GitHub, or files):
  https://vercel.com/bridge-line-services-projects/sophira/settings/environment-variables
  as MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
- Done when: in Sophira, Settings -> Integrations lets you press Connect and the
  page says Connected after a real provider check.

## 2. Turn on the live security tests (about 10 minutes)
- Create a NEW Supabase project (separate from production):
  https://supabase.com/dashboard -> New project. Name it sophira-security-test.
- From its Settings -> API, copy the Project URL, anon key, and service_role key.
- Add them as GitHub Actions secrets (not Vercel):
  https://github.com/BridgeLine-Services/Sophira/settings/secrets/actions
  as SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY, SUPABASE_TEST_SERVICE_ROLE_KEY.
- Done when: the weekly health workflow report no longer lists the security-test
  checks as blocked.

## Before step 3: the two optional keys (each about 5 minutes, only if you want those features)
- AI cloud fallback (optional — Sophira's default is the free local model):
  get a key from https://aistudio.google.com/apikey and set GEMINI_API_KEY in
  the Vercel environment settings. The local model works without it.
- Live web research (optional): get a search key from your chosen provider and
  set SEARCH_API_KEY (with SEARCH_PROVIDER if it is not the default) in the
  same Vercel page.
- Native app builds (only if you ever want phone installs from a store):
  SOPHIRA_APP_URL must be set in Vercel to the app's public address.

## The secret-handling golden rule
If a value is secret (password, API key, token, client secret), it goes ONLY
into your hosting settings (Vercel environment variables or GitHub secrets),
never into chat, files, screenshots, or code. Sophira will never ask you to
paste a secret anywhere else — Never paste a key into a chat, and no legitimate
support channel will ask you to.

## Where every variable is documented
The full, plain-language list of every variable — required, optional, and
test-only — is docs/ENVIRONMENT_VARIABLES.md. Legal details and the exact
remaining legal placeholders are in docs/legal/LEGAL_CONFIGURATION.md; the
legal pages stay unpublished and the release gate honestly reports the app is
NOT READY for production release until the legal facts and attorney review are
complete (private testing with invited users is fine meanwhile).

## 3. Answer the legal questions (reply in chat)
- Does 10/04/2026 mean October 4, 2026 or April 10, 2026?
- Which US state's law should govern the terms?
- Is servicesbridgeline@gmail.com okay as the public legal/privacy contact?
- Your/your attorney's choices for liability limit and data retention.
- Then have an attorney review before making the legal pages live.

## 4. Test on your phone (about 15 minutes)
- Open https://sophira.vercel.app on your phone, sign in, install it as an app,
  and follow the pass/fail list in docs/DEVICE_ACCEPTANCE.md.

## 5. Invite your test users
- Owner Dashboard -> Invite someone. That is the whole step.

That is everything. Everything else runs automatically.
