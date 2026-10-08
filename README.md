# Sophira

A private, invite-only AI academic assistant. Sophira adapts to your courses,
your teachers' exact requirements, and your own writing style — from
elementary school through PhD work — and installs on your phone as an app.

Built with Next.js (App Router), Supabase (auth + database + private
storage, row-level security on every table), and a free-first AI stack.

## What Sophira does

- **Private by default.** Row-level security on every table: your
  assignments, documents, writing samples, teacher profiles and feedback are
  visible only to your account — not even the owner can browse them.
- **Teacher-aware.** A structured profile per teacher; AI-extracted rules
  always land as *proposals* you approve or reject.
- **Your writing voice.** A Writing Profile built only from samples you
  provide, applied only to writing tasks and never against the assignment's
  requirements.
- **Honest AI.** Verification is labeled for what it is; unreadable documents
  produce a clear error, never invented text; a missing provider is said
  plainly and your work is preserved.
- **Invite-only.** The owner invites members by email; links are single-use,
  tied to the invited email, revocable — enforced in the database.
- **Installable.** A Progressive Web App: one tap on Android, "Add to Home
  Screen" on iPhone. No app store needed.
- **Learns how you work.** Approved corrections become scoped learning
  patterns with a full lifecycle (observed → confirmed → corrected).
- **Runs without a paid API key.** Self-hosted AI by default, free Gemini
  tier as the cloud fallback, on-device offline AI, and paid AI strictly
  opt-in (fail-closed).

## Get it running (5 steps)

1. **Get the code.** In a terminal:
   `git clone https://github.com/BridgeLine-Services/Sophira.git && cd Sophira`
   (no Git? On the repository page: Code → Download ZIP, then unzip).
   Install Node.js 20+ from nodejs.org.
2. **Install and configure.** Run `npm run setup` — it installs
   dependencies, creates `.env.local` from the generated `.env.example`, and
   validates your configuration without ever printing secret values. Then
   `npm run setup:ai` to choose the AI mode (see "AI providers" below).
3. **Create a Supabase project** at [supabase.com](https://supabase.com) and
   put its URL + anon key + service-role key in `.env.local`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`).
4. **Run it.** `npm run dev` → http://localhost:3000. For a deployed app,
   open `/setup` and click **Set Up Sophira** — the app applies its own
   migration chain (`0001`–`0026`) from inside the app. No SQL editor, ever.
5. **Create the owner account.** With no owner yet, the sign-in screen shows
   **Create Owner Account** (also at **/create-owner**). Enter your email and
   choose your own password: migration 0025 makes the FIRST completed
   registration claim the single owner slot atomically — exactly one owner
   can ever exist, no invitation and no database editing required. After
   that, signup is invitation-only for everyone. Invite members from the
   Owner Dashboard (`/owner`).

Check everything with `npm run doctor` (plain-English readiness checklist)
or `npm run verify` (full validation incl. build).

## AI providers (free-first, zero-billing, fail-closed)

**You do NOT need an OpenAI, Anthropic, Gemini, or other paid AI API key
to run Sophira.** LOCAL AI runs on your own machines (self-hosted server
or the on-device model, downloaded at first use — never committed to
GitHub); CLOUD AI models (Gemini/OpenAI) are *not* inside this repository
— they run on their providers' servers and are reached with your key,
which stays server-side.

How the pieces fit: GitHub source → Next.js Sophira web app → Vercel
deployment → **Capacitor shell loads the DEPLOYED web app** → Android
APK / iOS app contains **NO secrets**: all AI and database calls go
through the deployed app's server-side routes.

With the default `AI_PROVIDER=auto` the server tries, in order:

1. **Self-hosted** (`LOCAL_LLM_BASE_URL` + `LOCAL_LLM_MODEL`) — your own
   Ollama / llama.cpp / vLLM / LM Studio server. **No API key, the default
   path.**
2. **Gemini free tier** (`GEMINI_API_KEY`) — free cloud fallback; only
   verified free-tier models run unless paid use is explicitly allowed.
3. **OpenAI** (`OPENAI_API_KEY`) — only when `ALLOW_PAID_AI=true` or
   `MONTHLY_AI_BUDGET_USD>0`. With the defaults a paid key is reported and
   IGNORED.

On-device offline AI (SmolLM2/Qwen tiers) runs in the browser with no key
and no cloud. Architecture: **docs/SELF_HOSTED_AI_ARCHITECTURE.md**.

## Documentation index

| Topic | Document |
| --- | --- |
| Environment variables (plain-English) | docs/ENVIRONMENT_VARIABLES.md |
| Vercel deployment | docs/VERCEL_DEPLOYMENT.md |
| Release process / release gate | docs/RELEASE_PROCESS.md, docs/RELEASE_GATE.md |
| Feature status (honest, per-feature) | docs/FEATURE_STATUS.md |
| Dated upgrade rounds (history) | docs/CHANGELOG.md |
| Local no-Vercel quick start | docs/QUICK_START_LOCAL.md |
| Self-hosted AI architecture | docs/SELF_HOSTED_AI_ARCHITECTURE.md |
| Offline architecture / models | docs/OFFLINE_ARCHITECTURE.md, docs/OFFLINE_MODELS.md |
| Notebooks | docs/NOTEBOOKS.md |
| Math scan (image → solution) | docs/MATH_SCAN.md |
| Native builds (Android/iOS/desktop) | docs/NATIVE_BUILDS.md |
| Acceptance testing | docs/ACCEPTANCE_TESTS.md, docs/MASTER_ACCEPTANCE_WORKFLOW.md, docs/LIVE_TESTS.md, TEST_REPORT.md |
| Tonight's manual test run | TESTING_TONIGHT.md |
| Troubleshooting | docs/TROUBLESHOOTING.md |
| Legal templates & owner facts | docs/legal/ (npm run legal:status) |

## Testing

- `npm test` — 2503 offline assertions (isolation, conditionality,
  conflicts, injection defense, routing, verification, offline subsystem).
- `npx tsc --noEmit` and `npm run build` — must pass with zero errors.
- `RUN_LIVE_MODEL=1 npm test` — additionally verifies real on-device
  inference (~120 MB model download).

## Honesty guarantees

- Unconfigured AI → every AI feature returns a clear 503; your input is
  preserved. Missing configuration → a friendly page or redirect, never a
  500 (`/api/health` reports each capability honestly).
- The verification panel never claims a check that wasn't performed.
- Profile changes require explicit approval.
- Offline answers are always stamped with their origin (LOCAL vs REMOTE).

## Proprietary Software — All Rights Reserved

Sophira is **proprietary software**; all rights are reserved by the copyright
holder under the [LICENSE](LICENSE) file. This is not open-source software:
copying, redistribution, modification, and commercial exploitation are
prohibited without express written authorization. The app serves the
templates at **/terms**, **/privacy** and **/license**, with an honest
placeholder banner while owner facts remain unfilled; the release gate
blocks production-readiness until they are resolved (see
docs/legal/LEGAL_REVIEW_NOTICE.md — an attorney must review before launch).
