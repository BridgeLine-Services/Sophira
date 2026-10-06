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
