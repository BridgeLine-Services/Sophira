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
6. Deploy, then run the one-time database setup: paste
   `supabase/bootstrap-all.sql` in the Supabase SQL editor.
7. Open the site — with no owner yet, the sign-in screen shows
   **Create Owner Account**.

## Why the desktop app does not interfere

`src-tauri` is only read by the Tauri/Cargo toolchain (GitHub Actions /
local desktop builds). The Next.js build never imports it: nothing under
`src/` references `src-tauri`, and the web build output contains no Rust
artifacts (verified by the test suite). Removing, moving, or renaming the
folder is never required.
