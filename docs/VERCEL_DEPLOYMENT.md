# Deploying Sophira to Vercel (single Next.js application)

## What Vercel should deploy

The Sophira **Next.js web application lives at the repository root**
(`package.json`, `next.config.mjs`, `src/`). That root is the one and only
Vercel deployment target. The repository also contains `src-tauri/` —
the **Tauri desktop application** — which is NOT a web service and is
never deployed to Vercel.

`vercel.json` pins this explicitly:

```json
{ "framework": "nextjs" }
```

No `services`, no Rust runtime, no rewrites. If Vercel's import wizard
proposes a multi-service configuration ("app" + "src-tauri" with a Rust
runtime), do NOT accept it — it is auto-detection of the desktop folder,
not a runtime requirement of the web app.

## Statement

Vercel deploys the repository root as a single Next.js application. `src-tauri/` is the Tauri desktop application and is not deployed to Vercel.

## Vercel dashboard settings

- Repository: `BridgeLine-Services/Sophira`
- Root Directory: **the repository root** (leave as `/` — the folder containing `package.json`)
- Framework Preset: **Next.js**
- Do **not** select `src-tauri`
- Do **not** create a Rust service
- Do **not** create a second Vercel application

## Importing the repository

1. Import `BridgeLine-Services/Sophira` into Vercel.
2. If the wizard shows multiple detected applications, choose the
   **Next.js application** with **Root Directory = the repository root**
   (the folder containing `package.json`).
3. Framework preset: **Next.js** (already enforced by `vercel.json`).
4. Build command: leave as detected — `next build` from the existing
   `package.json` script (npm, `package-lock.json`).
5. Add the environment variables listed in README (Supabase URL, anon
   key, service-role key; AI keys optional; no OpenAI required).
6. **Database setup is automatic - two supported channels.** The
   application itself initializes the database on first launch; no SQL
   editor is ever used.
   - **Primary (recommended, zero secrets to copy):** connect the Vercel
     project to its Supabase project with the official **Supabase
     integration** (Vercel → Project → Integrations → Supabase). The
     integration provisions the direct database connection
     (`POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` / pooler URLs, or
     `SUPABASE_DB_PASSWORD`) that the deployed app uses to apply every
     missing migration (0001-0026) itself, from `/setup` ("Set Up
     Sophira") or directly from `/create-owner`.
   - **Manual alternative (if the project was connected by pasting the
     three API keys):** add ONE variable in Vercel → Settings →
     Environment Variables: `POSTGRES_URL_NON_POOLING` (Supabase
     dashboard → Settings → Database → Connection string, URI form;
     server-only) or `SUPABASE_DB_PASSWORD` (the project's database
     password; the app derives the direct endpoint automatically).
   - **Secondary (optional, for CI-side migration):** set GitHub secrets
     `SUPABASE_ACCESS_TOKEN` (a Supabase personal access token) +
     `SUPABASE_PROJECT_REF` and the CI **Migrations** job applies the
     chain on every push. Without them that job skips with a notice -
     first-launch production setup does NOT depend on it.
   `/setup` diagnoses the exact missing capability (Supabase credentials,
   service-role key, or initialization channel) and never shows a vague
   "administrator connection" message; `/api/setup-status` exposes the
   categorical `setupChannel` (`direct-postgres` / `management-api` /
   `none`).
7. Open the site — with no owner yet, the sign-in screen shows
   **Create Owner Account**. If the database is not ready, the page
   explains exactly what is missing and repairs it when safe — never a
   mysterious "wrong email or password" error.

## Why the desktop app does not interfere

`src-tauri` is only read by the Tauri/Cargo toolchain (GitHub Actions /
local desktop builds). The Next.js build never imports it: nothing under
`src/` references `src-tauri`, and the web build output contains no Rust
artifacts (verified by the test suite). Removing, moving, or renaming the
folder is never required.

## Environment variables: automatic discovery and sync (2026-10-06)

Sophira's required configuration is machine-readable and self-checking, so
nobody has to figure out variable names by hand:

- **src/config/env.manifest.json** is the single authoritative catalog of
  every environment variable Sophira reads (web runtime, AI, search, local
  modes, native release builds, live tests) — with required/optional
  classification, server-only vs public scope, defaults, and where to get
  each value.
- **.env.example is GENERATED from it** (`node scripts/gen-env-example.mjs`),
  never hand-edited; `npm run env:example` fails CI if the two disagree.
- **src/lib/env.ts** validates configuration centrally at runtime
  (`checkEnv()`), and `/api/health` + `/setup` report what is missing in
  categorical booleans only.
- **`npm run verify:env`** validates your local environment (or a
  production-shaped check with `--prod`) against the manifest and prints
  exactly what is missing or invalid — never any secret values.
- **`npm run verify:deployment`** checks a live deployment's
  `/api/health` for real configuration readiness.

### Getting variables into Vercel without manual retyping

1. `vercel link` — connect the local clone to the Vercel project.
2. Fill a local `.env.local` (template: `.env.example`).
3. `vercel env push` — uploads the file to the project; Vercel prompts for
   which environments (Preview/Production/Development) receive each value.
4. `vercel env pull .env.local` — the reverse: pulls the project's
   environment down for local development (the supported way to give a
   new clone its credentials without copy-paste).

### What Vercel can and cannot provision automatically (honest limits)

- **Automatic**: the Vercel **Supabase Integration** (Marketplace → Supabase)
  provisions `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  and `SUPABASE_SERVICE_ROLE_KEY` into the project automatically — for the
  production Supabase project and, separately, for a preview Supabase
  project if you connect one. `NEXT_PUBLIC_SITE_URL` can use Vercel's
  System Environment Variables or be set once per environment.
- **User-provided secrets (Vercel cannot create third-party credentials)**:
  `GEMINI_API_KEY` (free tier, preferred), `SEARCH_API_KEY`
  (Brave/Tavily), and the optional `OPENAI_API_KEY` (paid fallback — inert
  while `ALLOW_PAID_AI=false` and `MONTHLY_AI_BUDGET_USD=0`). No secret
  value is ever needed in the repository.
- **GitHub-Actions-only** (never Vercel): the Android/iOS signing secrets —
  they live in the repository's GitHub secrets, not the web deployment.

### Preview vs Production (isolating the academic database)

- Configure **Production** with the production Supabase project's
  variables.
- For Preview deployments, connect a **separate test Supabase project** via
  the same Supabase Integration and scope its variables to Preview —
  strongly recommended whenever you test anything that writes
  (assignments, invites, owner flows), so a preview test can never write
  into the production academic database.
- The database, not the app, enforces isolation: signups are
  invitation-only and every table has row-level security, so even a
  wrong-scope preview cannot read another user's data — but it could
  write test rows into whatever Supabase project it points at, which is
  why previews should point at a test project.
- After any environment change, redeploy and run
  `npm run verify:deployment` (or curl `/api/health` on the deployment):
  it reports `supabase / supabase_service_role / ai / search` readiness
  honestly.
