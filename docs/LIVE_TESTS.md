# Sophira — LIVE acceptance tests (credential-gated, never fabricated)

Status legend: PASS = actually executed and succeeded; FAIL = executed and
failed; BLOCKED = requires owner credentials/deployment/device that are not
available to the runner; NOT RUN = genuinely not executed.

## 1. Password reset — full real-Supabase flow (BLOCKED until run)

Uses DEDICATED TEST CREDENTIALS (a throwaway invited test account on a
test project — never production accounts; keys stay in the server
environment, never in source control). Steps A–R are in
TESTING_TONIGHT.md "Forgot Password Acceptance Test". Live verification
requires all of: valid reset request; recovery email generation; valid
recovery link; successful callback exchange; password update; OLD
password rejection; NEW password acceptance; expired link rejected;
already-used link rejected; no account-enumeration leak; no
role/profile/status escalation; a REVOKED user stays revoked after
recovery; owner recovery does not bypass owner authorization checks.

## 2. Gemini free tier — LIVE_GEMINI=1 (BLOCKED until run)

```bash
GEMINI_API_KEY=<server env only> LIVE_GEMINI=1 npm test
```

Runs the REAL serverAiChat/geminiChat path against Google's real
endpoint (free-tier quota only): success, internal-format conversion,
model allowed by the verified free-tier list, key in the x-goog-api-key
HEADER (never in a URL), honest quota (429) handling, no silent switch to
a paid provider. Without the key this section reports skipped — never PASS.

## 3. AI application route (BLOCKED until run)

```bash
node scripts/live-ai-app-test.mjs
```

Exercises the deployed app itself: unauthenticated refusal, dedicated
test-account sign-in, a real authenticated AI request, honest-failure
behavior, no secrets in responses, and (optionally) a cross-user probe
with SOPHIRA_TEST_OTHER_ID. Requires SOPHIRA_LIVE_APP_URL plus the test
account/project credentials. Exits 2 (BLOCKED) when credentials are
missing — that is the honest result, not a failure of the app.

## 4. Live Supabase security matrix + research provider

Already wired in the release gate (RUN_LIVE_TESTS=1) and the dedicated
regression scripts (tests/security/rls-regression.mjs,
tests/security/invitation-regression.mjs) with --self-test offline modes.
BLOCKED without database credentials.

## Current honest status (2026-10-06)

- Password-reset OFFLINE tests: PASS (tests/reset-password.ts).
- Password-reset LIVE: NOT RUN (no test credentials).
- Gemini LIVE: NOT RUN (no GEMINI_API_KEY).
- AI application route LIVE: NOT RUN (no deployed backend credentials).
- Release gate: BLOCKED (production env + live prerequisites missing).

## Live membership check (2026-11-13)

`npm run verify:live-membership` asks the live project whether the presence and notification
features have what they need, and prints one plain verdict per check. It exits 3 when no live
credentials are present, 1 when a check does not answer as expected, 0 when everything does.

What it asks: that `member_presence`, `member_availability`, `presence_settings`,
`member_notifications`, `notification_preferences`, `invitation_requests` and
`invitations.email_status` are readable; that `presence_heartbeat`, `presence_release` and
`presence_set_availability` exist and **refuse a caller who is not signed in** (an `ok: true`
answer would be a security hole and fails the check); that `network_directory` refuses anyone who
is not staff; and that the presence row count is identical before and after, so the check itself
wrote nothing.

What it cannot ask, and says so: whether a real signed-in member appears Online (needs a member
account), whether RLS stops one member reading another's rows (verified at SQL level by
`npm run db:verify:local`), and which migration number the database is at (Supabase does not
expose its history table).

Result on 2026-11-13: all thirteen checks passed against the live project, and the live
`member_presence` table holds recent heartbeats from real signed-in sessions.
