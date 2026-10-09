# Sophira — First Testing Release Report

**Date:** 2026-10-09 · **Commit:** `e48863f` · **Live app:** https://sophira.vercel.app

## Ready for controlled testing

The completion criteria are met at the infrastructure level: an authorized
user can sign in, recover a password (reset links now point at the live
domain), submit an assignment, receive academic assistance (math is fully
deterministic + verified; essay planning/drafting need an AI provider key),
save work (grants verified live), and keep a personalization profile, while
the owner manages invitations and revocation without any path to other
members' private academic content (RLS + owner-checks audited, owner
statistics are aggregate metadata only).

## Validation executed in this round

| Command | Result |
|---|---|
| `npm test` | **2644/2644 PASS** |
| `npx tsc --noEmit` | clean |
| `npm run build` | PASS |
| `npm run verify` | PASS |
| `npm run scan:secrets` | CLEAN |
| `npm run env:example --check` | in sync |
| `npm run doctor` (local context) | fails only on local `NEXT_PUBLIC_SITE_URL` (set in Vercel) |
| `npm run db:migrate:check` | BLOCKED: needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF |
| Live probes | login/health 200; guarded routes single-hop redirect; production grants TRUE |

## What can be tested immediately (owner, signed in)

1. Dashboard / navigation on desktop, tablet, phone widths.
2. Math: type or photograph `∫ 4x cos(2 − 3x) dx` — solved with method
   steps and a verification badge; try an unsupported integral to see the
   honest NEEDS REVIEW refusal.
3. Essay planning (once an AI key is configured): plan → editable outline
   → approval gate → staged drafting → persistence across refresh.
4. Writing samples (save + list + privacy), typing calibration.
5. Owner dashboard: membership, invitations, requests, statistics
   (repaired automatically at first page load after 2026-10-09).
6. Memory personalization setup card; offline capability overview.

## Environment variables required for full function

- `SUPABASE_*` — configured (production reached acceptance).
- `OPENAI_API_KEY` / `OPENAI_BASE_URL` (or the Gemini free tier) — AI
  essay/assistant features; WITHOUT them those features show honest errors.
- `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` — only for
  `db:migrate:check` / auth-redirect auto-repair from outside Vercel.
- See `docs/ENVIRONMENT_VARIABLES.md` for the complete manifest.

## Explicitly NOT done / blocked

- Attorney review of license/ToS/privacy (28 owner facts unresolved — do
  not publish to the public until reviewed).
- Physical-device acceptance (camera, iPad, touch) — needs hands and
  devices; checklist in docs/DEVICE_ACCEPTANCE.md.
- Signed-in end-to-end as the production owner — no synthetic production
  credentials exist by design (invitation-only).
- Pixel-level multi-width rendering verification (code-level pins only).
