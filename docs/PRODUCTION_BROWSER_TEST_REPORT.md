# Production Browser Test Report

Round: 2026-10-11 | Production: https://sophira.vercel.app
Deployed revision: master 7007c71 (Vercel auto-deploy; verified by the
matching CI/health workflow runs on this exact SHA, completed success)
Browser: Browserbase real Chromium session (not curl, not mocked)

## Unauthenticated tests (real browser, this round)

| # | Test | URL opened | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | Home is protected | https://sophira.vercel.app/ | Redirect to login; login page renders | Landed on /login?next=%2F; clean Sophira login page (email/password, invitation signup, Terms/Privacy links); no error text, no data leakage | PASS |
| 2 | Owner-only System Health is protected | https://sophira.vercel.app/owner/health | Redirect to login with preserved destination; owner content NEVER shown | Landed on /login?next=%2Fowner%2Fhealth; same clean login page; no owner data in the DOM | PASS |

Also verified this round (real CI on the deployed SHA 7007c71):
CI (full suite + build + self-tests) success; Migrations check success;
Scheduled health check (full authoritative release gate) success —
https://github.com/BridgeLine-Services/Sophira/actions/workflows/health.yml

## Not run this round (honest status)

- AUTHENTICATED owner pass (sign in, Owner Dashboard, System Health live
  view, typing calibration, Science expand/collapse, Export PPTX in the
  notebook workspace): BLOCKED — no authorized owner session was made
  available for automated use. Requires the owner to provide a test account
  or an owner session through an approved secure mechanism. Nothing was
  bypassed; middleware and authorization were untouched.
- Provider flows (Microsoft/Google): NOT RUN — the integration code is not
  implemented yet and no credentials exist (see docs/WORD_GOOGLE_DOCS_SETUP.md).
- Physical device (Android/iPhone) and offline-sync tests: BLOCKED — no
  physical device available to the agent (release gate reports the same).

## Repeatability

Sessions 1-2 are repeatable with any browser automation against the two
URLs above. The authenticated pass must never use a fabricated session:
it waits for an owner-provided test account.
