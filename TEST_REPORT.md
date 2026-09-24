# Sophira — Test Report

Date: 2026-09-24 · Build: `next build` (Next 14.2.35, strict TypeScript)

## What was actually verified

| Check | Result |
|---|---|
| `tsc --noEmit` full-project typecheck | ✅ PASSED (0 errors) |
| Production build, all 28 routes compile | ✅ PASSED |
| Layout/responsive audit of all pages (single-column, ≥44px targets, no horizontal scroll by construction) | ✅ PASSED (code-level) |
| PWA assets resolvable (manifest, sw.js, icons referenced by layout + install page) | ✅ PASSED (build-time) |
| Middleware auth gate covers all private routes; API routes excluded (they enforce auth themselves with 401 JSON) | ✅ PASSED (code-level) |
| RLS: every table policy reviewed — all user data visible only to owner (`user_id = auth.uid()`); invitations owner-only (migration 0002) | ✅ PASSED (code-level review) |
| Writing Profile applied only for writing tasks (classification gate in `/api/ai/solve`) | ✅ PASSED (code-level) |

## Acceptance scenarios (spec §21)

These require a **live Supabase project and an AI API key**, neither of which exists in the
build sandbox. They are honest **BLOCKED**, not failed:

| # | Scenario | Status | How to run it after deploy |
|---|---|---|---|
| 1 | Sign in → dashboard → create course | 🔶 Not yet tested (needs live backend) | Sign up, finish onboarding, add course |
| 2 | Teacher profile + instructions saved | 🔶 Not yet tested | Create teacher, fill requirements, save |
| 3 | Assignment response uses course instructions | 🔶 Not yet tested (needs AI key) | Pick course+teacher in wizard, start assignment |
| 4 | Math question does NOT apply Writing Profile | 🔶 Not yet tested (needs AI key) | Ask math question with approved writing profile present |
| 5 | Writing assignment applies approved Writing Profile | 🔶 Not yet tested (needs AI key) | Writing-mode task after approving a profile |
| 6 | Check-my-work feedback | 🔶 Not yet tested (needs AI key) | Check mode with own attempt |
| 7 | Unreadable/ambiguous input flagged, not invented | 🔶 Not yet tested (needs AI key) | Upload a blurry photo |
| 8 | Profile update proposal approve/reject | 🔶 Not yet tested (needs AI key) | Paste teacher doc → approve/reject proposal |
| 9 | Second user cannot access first user's data | 🔶 Not yet tested (needs live backend) | Sign up user 2 via invitation, try to guess user 1's URLs |
| 10 | Narrow-screen layout usable | 🔶 Not yet tested on devices | Open on a phone at 360px width |
| 11 | Installation path | 🔶 Not yet tested (needs HTTPS deploy) | Visit /install on Android Chrome / iPhone Safari |
| 12 | Errors preserve user work | ✅ Code-level PASSED (503/502/415 handlers keep state) — device test pending | Remove AI key, submit an assignment, verify text preserved |

Nothing in this report claims a test ran that did not.

## Known limitations

- DOCX uploads are not parsed — the user is told to paste text or use PDF (honest 415 message).
- Direct signups at the Supabase API level (bypassing the app UI) cannot be fully prevented
  from app code; the app itself is invite-only, and Supabase dashboard settings can lock
  this down further (see README "Setup" note).
- AI verification is a self-check, not an independent computation engine — surfaced honestly
  as "Needs verification" whenever a check fails or cannot be performed.
- Image (photo) reading requires a vision-capable model (`SOPHIRA_MODEL`, e.g. gpt-4o-mini).
