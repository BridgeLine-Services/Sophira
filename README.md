# Sophira

A private, invite-only AI academic assistant. Sophira adapts to your courses,
your teachers' exact requirements, and your own writing style — from elementary
school through PhD work — and installs on your phone as an app.

Built with Next.js (App Router), Supabase (auth + database + private storage,
row-level security on every table), and a free-first AI provider chain. **This
repository is the source of truth for the application code.** Cloud AI models
(Gemini/OpenAI) are *not* inside it — they run on their providers' servers and
are reached through their APIs with a key. LOCAL AI is a small model that
genuinely runs on your own machine, downloaded at first use from the app
(never committed to GitHub). You do NOT need an OpenAI (or any paid) key to
use Sophira — see the provider chain below. CLOUD AI answers come from
Gemini; LOCAL AI answers come from your own machine. The mobile app is a thin shell:
GitHub → Next.js → Vercel, then
the Capacitor shell loads the DEPLOYED web app; the shell contains NO secrets.

## What it does

- **Private by default** — every table is RLS-protected; not even the owner can
  browse members' work. Owner analytics are aggregate-only.
- **Teacher-aware** — a structured profile per teacher; AI-extracted rules land
  as *proposals* you approve or reject.
- **Your writing voice** — a Writing Profile built only from samples you label,
  applied only where it doesn't violate the assignment's requirements.
- **Honest AI** — verification is a self-check with a "Needs verification"
  status, never a fake guarantee. If the AI provider isn't configured, the app
  says so plainly and preserves your work.
- **Installable** — a Progressive Web App; no app store needed.
- **Invite-only** — the Owner Dashboard manages invitations; enforcement is in
  the database, not just hidden UI. First owner: see step 4 below.
- **Learns how you work** — approved corrections become scoped learning
  patterns; corrected mistakes are never reintroduced.
- Seven modes: Learn, Assignment, Check my work, Writing, Study, Explain
  simply, Custom.

## Which AI answers? (the real, current behavior)

`AI_PROVIDER` defaults to `auto`, which tries in order:

1. **selfhost** — an OpenAI-compatible local server (e.g. Ollama) if
   `LOCAL_LLM_BASE_URL` is set. No API key, your machine only.
2. **gemini** — if `GEMINI_API_KEY` is set (free tier, verified free-tier
   models only).
3. **openai** — only if paid use is *explicitly* allowed
   (`ALLOW_PAID_AI=true` or `MONTHLY_AI_BUDGET_USD>0`). Disabled by default.
4. Otherwise the built-in **local/offline** provider — no key needed.

No key is ever required. The app always reports which provider answered.
See `docs/ENVIRONMENT_VARIABLES.md` and `docs/SELF_HOSTED_AI_ARCHITECTURE.md`.

## Get it running (5 steps)

1. **Get the code** — **Download ZIP** from the GitHub page (no Git needed),
   or `git clone https://github.com/BridgeLine-Services/Sophira.git`.
   Then `npm ci`, `npm run setup` (guided .env), `npm run setup:ai`
   (guided AI config), and `npm run verify`.
2. **Create a Supabase project** at [supabase.com](https://supabase.com)
   (free tier is fine). You need its URL, anon key, and service-role key.
3. **Deploy to Vercel** — import the repository, then connect the project to
   Supabase with the **official Supabase integration** (Vercel → your project →
   Integrations → Supabase). The integration provisions everything
   automatically. Full detail: `docs/VERCEL_DEPLOYMENT.md`.
4. **Initialize the app** — open your site's `/setup` and click
   **Set Up Sophira** (prepares the database: 26 migrations, 0001–0026 —
   no SQL editor, ever). Then open `/create-owner` (the sign-in screen also
   shows **Create Owner Account** when no owner exists yet): the *first*
   completed registration claims the single owner slot atomically — no
   invitation, no SQL, no `owner_email` setting. After that, every further
   signup requires a valid invitation.
5. **Check it** — open `/api/health` on your deployment: it reports
   configuration honestly (Supabase, AI, search). Run `npm run doctor` for a
   plain-English ✅/❌ checklist of exactly what's still missing.

## Validate and test

```
npm ci
npm test          # full offline suite (see the number it prints — the
                 # docs quote historical counts; the command is the truth)
npx tsc --noEmit
npm run build
```

Locally: `npm run dev` → http://localhost:3000 (see
`docs/QUICK_START_LOCAL.md`).

## Documentation index

- `docs/VERCEL_DEPLOYMENT.md` — deploying, and the exact environment variables
- `docs/ENVIRONMENT_VARIABLES.md` — every variable, what it's for, scope
- `docs/OWNER_ACCESS.md` — owner account, invitations, revocation
- `docs/SELF_HOSTED_AI_ARCHITECTURE.md` — local AI, provider chain, health
- `docs/QUICK_START_LOCAL.md` — running Sophira locally without Vercel
- `docs/RELEASE_PROCESS.md` — the release checklist and release gate
- `docs/RELEASE_GATE.md` — what the automated release gate verifies
- `docs/CHANGELOG.md` — dated upgrade-round changelogs
- `docs/FEATURE_STATUS.md` — the honest, dated feature-status table
- `docs/TROUBLESHOOTING.md`, `docs/LIVE_TESTS.md`,
  `docs/ACCEPTANCE_TESTS.md` — testing guides
- `TESTING_TONIGHT.md` (repository root) — the live smoke-test script

## Proprietary Software — All Rights Reserved

© 2026 Sophira. Unauthorized copying, distribution, or use is prohibited.
