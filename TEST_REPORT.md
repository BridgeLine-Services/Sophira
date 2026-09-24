# Sophira — Test Report

Date: 2026-09-24 (upgrade) · Next 14.2.35, strict TypeScript · `npm test` + `npm run build`

## 1. Automated unit tests — ✅ 47 / 47 PASSED (`npm test`, runs offline)

| Area | Assertions | Result |
|---|---|---|
| Teacher isolation — Teacher A's rules never enter Teacher B's context | 6 | ✅ |
| Course isolation — course instructions appear only when the course is selected | 3 | ✅ |
| Writing-profile conditionality — math tasks never load the Writing Profile; writing tasks do | 4 | ✅ |
| Source conflicts — two active official docs with different dates are flagged (not silently resolved); archiving resolves; same-date docs not flagged | 5 | ✅ |
| Prompt-injection defense — docs wrapped in DATA fences; injection attempts detected; normal text not flagged | 4 | ✅ |
| Subject routing — 9 workflows, machine-verifiable only where honest | 12 | ✅ |
| Independent math verification — correct/incorrect/invalid identities, floating-point tolerance, missing checks | 9 | ✅ |
| Scope inheritance — global → course → teacher override ordering is explicit in every layer | 3 | ✅ |

## 2. Build verification

| Check | Result |
|---|---|
| `tsc --noEmit` full-project strict typecheck | ✅ 0 errors |
| `npm run build` — 30 routes (incl. `/proposals`, `/api/ai/feedback-to-proposal`) | ✅ |
| PWA assets resolvable (manifest, sw.js, icons) | ✅ build-time |
| Middleware gate: API routes excluded (JSON 401s, not HTML redirects) | ✅ code-level |

## 3. Security audit (code-level)

| Check | Result |
|---|---|
| No route trusts a client-supplied `user_id` — all identity from `supabase.auth.getUser()` | ✅ |
| Service-role key used only in server routes/admin client; never `NEXT_PUBLIC` | ✅ |
| Uploaded files stored in the private `private-docs` bucket; no public URLs returned | ✅ |
| RLS on every table incl. new `profile_versions`; invitations owner-only | ✅ code-level review |
| Uploaded documents wrapped as untrusted data; injection attempts flagged, never obeyed | ✅ + unit-tested |
| Feedback→proposal route validates/allowlists model-proposed fields; never auto-applies | ✅ |

## 4. Acceptance scenarios (spec §37) needing a live backend

These require a real Supabase project + AI key, which the build sandbox does not
have. Honest status — **BLOCKED**, not failed. Re-run after deploy:

| # | Scenario | Status |
|---|---|---|
| 1 | Sign in → dashboard → create course | 🔶 Not yet tested (live backend) |
| 2 | Teacher profile + instructions saved | 🔶 Not yet tested |
| 3 | Assignment response uses selected course/teacher instructions | 🔶 Not yet tested (needs AI key) |
| 4 | Math question does NOT apply Writing Profile | ✅ Logic unit-tested; end-to-end needs AI key |
| 5 | Writing assignment applies approved Writing Profile | ✅ Logic unit-tested; end-to-end needs AI key |
| 6 | Check-my-work feedback | 🔶 Not yet tested (needs AI key) |
| 7 | Unreadable input flagged, never invented | ✅ Code paths + honest-failure handling; device test pending |
| 8 | Profile-update proposal approve/reject (now with version snapshot) | 🔶 Not yet tested live |
| 9 | Student B cannot access Student A's data | ✅ RLS reviewed + isolation unit-tested at app layer; live DB test pending |
| 10 | Feedback → proposal → approval → versioned update + rollback | ✅ Unit-tested where pure; live flow pending |
| 11 | Mobile 360px layout, PWA install Android/iOS/desktop | 🔶 Not yet tested on devices |
| 12 | Errors (no AI key, bad file, failed AI call) preserve user work | ✅ Code paths reviewed; device test pending |

## Known limitations (honest)

- `machine_checks` verify the arithmetic identities the model derives from its
  own solution — a genuine independent recomputation (mathjs), but not a proof
  that the chosen method or setup was correct. The UI labels this precisely.
- Symbolic algebra verification (e.g. CAS-grade integration checking) is not
  implemented; mathjs covers arithmetic/numeric identities only.
- DOCX equations embedded as images cannot be read — the user is told.
- Older `.doc` (pre-2007 Word) files are unsupported (only `.docx`).
- Live-device PWA testing (Android Chrome, iPhone/iPad Safari) has not been
  performed in this environment; install instructions are documented instead.
