# Troubleshooting Sophira (2026-10-06)

Plain-language fixes for the problems that actually come up. None of these
require editing code. When in doubt, run `npm run verify` — it tells you
categorically what is missing (never any secret values).

## 1. Missing `.env.local`

Symptom: setup prints "Created .env.local from .env.example" but you skipped
filling it, or the file is absent after a fresh clone.
Fix: run `npm run setup` (creates `.env.local` from `.env.example` only if
it does not exist — it never overwrites your file), then open
`.env.local` and fill in the credentials listed in the comments.
See `docs/ENVIRONMENT_VARIABLES.md` for where to get each value.

## 2. Missing Gemini API key

Symptom: AI answers say the provider is not configured; `npm run verify`
warns "No AI provider key configured".
Fix: get a FREE key at aistudio.google.com → "Get API key", then set
`GEMINI_API_KEY=` in `.env.local` (server-side only — it never reaches the
browser). Alternatively use LOCAL AI (no key): `npm run setup:ai -- --mode
local`, or run the app and use the on-device model. The Gemini model itself
is not in this repository — the key lets Sophira call Google's API.

## 3. Invalid Supabase configuration

Symptom: sign-in fails, or `/setup` (or `/api/setup-status`) reports the
Supabase connection as not configured while you believe you set the vars.
Fixes, in order:
1. Check the three names are exactly `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the last
   is server-only — it must NOT start with `NEXT_PUBLIC_`).
2. Confirm the values come from the correct Supabase project
   (Project Settings → API).
3. Confirm the database schema exists: run `supabase/bootstrap-all.sql`
   in the Supabase SQL editor (all migrations, one paste).
4. Restart the dev server after editing `.env.local`.
For Vercel, see item 5.

## 4. Failed AI requests

Symptom: an AI request errors out.
What to check:
- `npm run setup:ai` shows your current mode and whether the needed key is
  set (values never printed).
- Paid OpenAI requests fail by design while `ALLOW_PAID_AI=false` and
  `MONTHLY_AI_BUDGET_USD=0` — that is the free-first safeguard, not a bug.
  Enable them consciously only if you want paid AI.
- Network blocked or provider outage: the app preserves your input and
  reports the failure honestly; retry after fixing connectivity.
- LOCAL AI: the on-device model needs a one-time download; until then the
  offline page says so and never fakes readiness.

## 5. Vercel environment configuration

Symptom: the deployment works but /setup or /api/health reports things
unconfigured.
Fix: follow `docs/VERCEL_DEPLOYMENT.md` — the Vercel Supabase Integration
provisions the three Supabase variables automatically; `vercel link` +
`vercel env pull .env.local` syncs the project's environment to your
machine; `vercel env push` uploads a filled `.env.local`. After changing
environment variables, REDEPLOY (Vercel does not hot-reload env changes),
then check `/api/health` or run `npm run verify:deployment`.

## 6. Local AI unavailable

Symptom: the on-device model does not load.
Fix: the engine and model download at FIRST use and need internet for
that one-time setup (a few hundred MB on desktop, less on phone). Check
`npm run local:test` (it verifies Node ≥ 20, dependencies, the engine
files, and the model registry). The model is NOT in this repository, and
no model weights are ever committed — it downloads to your device and
stays there. See `docs/OFFLINE_MODELS.md`.

## 7. Capacitor unable to reach deployed Sophira

Symptom: the installed mobile shell shows a connection error.
Fix: the shell loads your DEPLOYED web app — it contains no server, no AI
keys, and no database. Check the URL it points at (`SOPHIRA_APP_URL` for
release builds; the dev server for `android:debug`/`desktop:dev`): it must
be reachable from the phone (a localhost URL is never valid for a release
build — `scripts/native-url.mjs` fails closed on placeholders). Verify the
deployment itself with `/api/health`. Then rebuild/re-sync the shell
(`npm run android:debug`, `npm run cap:sync`). See `docs/NATIVE_BUILDS.md`.

## 8. Invalid `SOPHIRA_APP_URL`

Symptom: a native release build refuses to compile, or the gate blocks it.
Fix: `SOPHIRA_APP_URL` must be the real https URL of your deployed Sophira
(e.g. https://your-app.vercel.app). Placeholders like
sophira.example.com fail intentionally — the build never silently points
at a wrong target. Set it in `.env.local` for `npm run android:build` /
`desktop:build`, or in GitHub Actions for release builds. Development
builds don't need it (they use the local dev server; override with
`SOPHIRA_DEV_URL`).

## Where things stand (honesty section)

`npm run verify` gives you the categorical status of dependencies,
environment, AI, search, native URLs, secret hygiene, and the production
build. `/setup` on a deployment reports the live configuration status.
Nothing in Sophira fakes readiness: a missing configuration is reported,
never simulated.

## 9. Local inference server unreachable (self-hosted AI)

Symptom: AI answers say the local runtime is unavailable;
`/api/ai/health` reports `{"available":false,"reason":"Local inference
server unreachable…"}`.
Fix:
1. Is the server running? (`ollama serve`, or your llama.cpp/vLLM/LM
   Studio server; `curl http://127.0.0.1:11434/api/tags` should answer.)
2. Does `LOCAL_LLM_BASE_URL` in `.env.local` point at it exactly (e.g.
   `http://127.0.0.1:11434`)? No port typos; Sophira normalizes a
   trailing `/v1` for you.
3. Is the model installed? (`ollama pull llama3.1:8b`, or set
   `LOCAL_LLM_MODEL` to a model your server actually has — the 404 error
   names the missing model.)
4. Restart the dev server after editing `.env.local`.
Non-AI features keep working; Sophira will not silently call a paid
cloud provider as a substitute.
