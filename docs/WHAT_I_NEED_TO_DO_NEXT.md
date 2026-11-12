# What I Need to Do Next — the one owner checklist

You never need a terminal, SQL, or code. Each step below says exactly where to
click. Full status details live in docs/COMPLETION_REPORT.md (the authoritative
report, updated 2026-10-13). Details for steps 1-2: docs/WORD_GOOGLE_DOCS_SETUP.md.

## First: bring your database up to date (about 1 minute)

**Why:** Sophira has two newer pieces of database furniture waiting.

1. The first records **how long each AI answer took**, so the AI Operations page can show response
   times instead of "not measured yet".
2. The second records the **whole administrative history**: invitations, suspensions, restorations,
   removals, invitation-request decisions and integration connections, not only role changes. The
   Security page already tells you when something is not recorded; after this, almost everything is.

I checked your real database on 2026-11-11. Everything for members, roles, phone numbers and
presence is already there. These two updates are not, so the AI page says response time is not
measured yet, and the Security page still shows role changes only.

Nothing is broken while you wait. Members can keep working, and no existing record is touched.

**What to do:**

1. Open **https://sophira.vercel.app/owner/database** and sign in as the Owner if it asks.
2. Look at the line under "Your database today". If it is green and says **Up to date**, you are
   already done — skip to step 4.
3. If it says something like **2 updates missing**, press the button marked **Update database** and
   wait for the spinner to stop. The page will change to **Up to date**, with a line like
   **53 of 53 pieces are in place** (the number grows as Sophira gains database pieces; what matters
   is that the two numbers match). This only adds what is missing; nothing existing is replaced or
   deleted, and members can keep working while it runs.
4. Open **https://sophira.vercel.app/owner/ai-operations** and check that the response-time line no
   longer says "not measured yet".
5. Open **https://sophira.vercel.app/owner/security** and check that the lower card says invitations,
   suspensions and connections are recorded (it will still say failed sign-ins are not).

**If something looks wrong, paste this back to me:** the exact wording of any red or amber message
on that page, and the line that ends "pieces are in place".

Do not paste your password or any key.

## Second: replace the test member sign-in I was given (about 2 minutes)

The address saved for the signed-in checks is not an email address (it has no "@" in it), so I did
not attempt to sign in with it. Ten checks stay marked BLOCKED rather than being reported as passes
or as an application fault. Everything else about those checks is ready.

A test member is a separate account used only for checking, never your own account.

**What to do:**

1. Open **https://sophira.vercel.app/owner/members**.
2. Find the member you want to use for testing (create one through Invitations first if there is
   nobody suitable). It must be a normal **User** role, not an Owner or Co-Owner.
3. Copy that member's email address exactly as it appears.
4. Send me that email address and a test-only password for it in a private message. I will store
   them as secrets, never in the code, and never in a report.

As soon as I have them I can finish: a signed-in member reporting presence, two devices keeping one
person Online, a member being refused another member's rows, and a User being refused a staff
action.

## Fix the typing schema in production (2 minutes, no technical steps)

**Why:** The Migrations CI job shows "success" even when it cannot reach your
database (it prints a notice and skips when the two optional Supabase
credentials are not configured). Result: migrations 0035-0038 were never
applied to production, which caused the "Could not find the 'backspaces'
column" typing error. This is now fixed at the root: the migrations carry
probe markers, and the built-in repair flow at **/setup** detects and applies
them automatically.

**What to do:** Sign in as the owner, open **https://sophira.vercel.app/setup**
once, and press the repair button if it appears. The missing columns are added
safely (nothing is deleted or rewritten). Then reload the Typing page — it
should work.

**Alternative (optional, for automatic CI migrations):** create a personal
access token at supabase.com/dashboard/account/tokens and add
`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` in GitHub repo Settings →
Secrets and variables → Actions. Never share these values in chat.

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

## Optional: automatic invitation emails (about 10 minutes)
- Without this, inviting works fine — you just copy the link and send it yourself.
- Get a key at https://resend.com, verify your domain, then set in Vercel:
  `RESEND_API_KEY` and `SOPHIRA_INVITE_FROM_EMAIL`
  (`Sophira <invitations@yourdomain.com>`).
- Done when: after you invite someone, the dashboard says "Email sent".

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

## Added 2026-11-11 (Owner Dashboard, membership and release work)

1. **Press Update database once.** Migration 0052 (`provider_usage.latency_ms`) is not applied on
   the live database yet. Until it is, AI request counts still work and the AI page says response
   time is not measured rather than showing 0 ms.
2. **Give me one test member account** (email + password you create for testing only, never the
   Owner's account). Ten live checks are BLOCKED without it: a member appearing Online, two devices,
   presence expiry, member-to-member isolation, suspended and revoked refusals, and a real
   invitation email arriving.
3. **Optional: repository secrets for scheduled backups.** The new daily workflow reports BLOCKED
   (not failed) until these exist: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`.
   Nothing is ever printed from them.
4. **Optional: `SOPHIRA_TEST_MEMBER_EMAIL` / `SOPHIRA_TEST_MEMBER_PASSWORD`** (and a second
   `..._MEMBER2_...`) make the signed-in half of `npm run verify:live-membership` run instead of
   reporting BLOCKED.
