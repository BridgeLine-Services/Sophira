# Sophira environment variables — plain-English guide

You set these in Vercel: **Project → Settings → Environment Variables**.
Never paste a secret into chat or into a file in the repository.

## PUBLIC / SAFE (visible in the browser by design — fine, not secrets)

| Variable | Where to get it | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API → "Project URL" | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same Supabase API page → "anon public" key | No (public by design; your data is protected by Row Level Security) |
| `NEXT_PUBLIC_SITE_URL` | Your deployed address, e.g. `https://sophira.vercel.app` | No |

## SERVER-ONLY (never put these in a `NEXT_PUBLIC_` variable, never print them)

| Variable | Where to get it | Secret? |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase API page → "service_role" key | **YES — the master key.** Server-only. Sophira never sends it to the browser and its secret scan checks for leaks. |
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens | Yes (server/CI only) | OPTIONAL. Powers AUTOMATED MIGRATIONS: the CI Migrations job and the one-click "Repair Setup" apply every missing migration through the Supabase Management API. Never browser-visible; the app runs fine without it. |
| `SUPABASE_PROJECT_REF` | Supabase dashboard → Settings → API (project ref) | No (not a secret, but server/CI scoped) | OPTIONAL. Companion to `SUPABASE_ACCESS_TOKEN` for automated migrations. |

## THIRD-PARTY (all optional — Sophira runs without them)

| Variable | Where to get it | Secret? | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio (free tier available) | Yes | Preferred free remote AI. |
| `GEMINI_MODEL` | e.g. `gemini-2.5-flash` | No | |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `SOPHIRA_MODEL` | OpenAI (paid) | Yes | Paid fallback, disabled by default; requires `ALLOW_PAID_AI=true` or `MONTHLY_AI_BUDGET_USD>0`. Never required. |
| `ALLOW_PAID_AI`, `MONTHLY_AI_BUDGET_USD` | you choose | No | Opt-in switches for the paid path. |
| `SEARCH_PROVIDER`, `SEARCH_API_KEY`, `SEARCH_BASE_URL` | Brave or Tavily (free tiers) | Key is secret | Needed only for live web research; without it research reports "internet connectivity/provider required" honestly. |
| `SOPHIRA_OFFLINE_ONLY` | you choose | No | Forces local-AI-only mode. |

## DEV / TEST-ONLY (never set these in production)

| Variable | Notes |
|---|---|
| `SOPHIRA_LOCAL_FIRST` | Local testing mode; also requires a non-production build, so a real deployment can never activate it. |
| `SOPHIRA_APP_URL` | Native (Android/iOS/desktop) production builds: the deployed Sophira URL. |
| `SOPHIRA_TEST_*`, `RUN_LIVE_TESTS` | Automated tests only. |

## If a variable is missing

Sophira never fakes a value. The deployment shows a clear configuration
status (the `/setup` page) telling you exactly what is missing.

## Machine-readable catalog and self-check (2026-10-06)

This guide is for humans; the machine-readable source of truth is
**src/config/env.manifest.json**. From it:

- `.env.example` is generated (`node scripts/gen-env-example.mjs`;
  `npm run env:example` verifies sync),
- `src/lib/env.ts` validates configuration centrally at runtime,
- `npm run verify:env` checks your local environment against the catalog
  and prints exactly what is missing or invalid — never any secret values,
- `npm run verify:deployment` checks a live deployment's readiness
  (Supabase, AI, search) via `/api/health`.

Free-first AI policy is pinned in the catalog: `ALLOW_PAID_AI=false` and
`MONTHLY_AI_BUDGET_USD=0` by default; the Gemini free tier is the preferred
provider; the paid OpenAI fallback stays inert until explicitly allowed.
Vercel deployment and environment sync (including the Supabase
Integration and `vercel env pull`) are documented in
**docs/VERCEL_DEPLOYMENT.md**.
