# Quick start: test Sophira locally (no Vercel, no paid AI, no API keys)

Sophira runs on whatever device you have. Your AI can run **on your
device**, for free. There are two ways to test it.

---

## PATH A — easiest: use the Sophira web app (PWA)

You do not need to install anything from an app store.

1. Open the Sophira web address in your browser.
2. Install it as an app:
   - **Android (Chrome):** menu → *Install app*
   - **iPhone / iPad (Safari):** Share → *Add to Home Screen*
   - **Windows / Mac / Linux:** browser menu → *Install* / *Add to Dock*
3. Open Sophira → go to the **Offline** section.
4. Choose the recommended local model for your device (you can always
   pick a different one — nothing downloads without your confirmation).
5. Confirm the download. First time only: this needs internet, because
   Sophira downloads the AI engine and the model once.
6. Wait for **"Local AI is ready."**
7. Turn off your internet (airplane mode is perfect).
8. Ask Sophira a test question.
9. Confirm the answer is stamped **LOCAL MODEL** with the model name —
   that stamp means it truly ran on your device, not in the cloud.

---

## PATH B — test from GitHub, without Vercel

For this path you need to install **Node.js 20** first (it is the
program that runs Sophira on your computer — there is no way around
this one requirement; Sophira is a web application and Node.js is its
engine). Get it from https://nodejs.org (the "LTS" version). Then:

1. Download Sophira: on the GitHub page click **Code → Download ZIP**,
   then unzip it (or, if you know Git: `git clone` the repository).
2. Open the project folder in a terminal.
3. Install Sophira's parts (one time):
   `npm install`
4. Start Sophira in local testing mode:
   - **Mac/Linux:** `SOPHIRA_LOCAL_FIRST=true npm run dev`
   - **Windows (PowerShell):** `$env:SOPHIRA_LOCAL_FIRST="true"; npm run dev`
5. Open **http://localhost:3000** — you will land on the
   **"Test Sophira locally"** page.
6. Click **Test Local AI**, pick the recommended model for your device,
   and confirm the download (internet needed this one time).
7. Ask Sophira something. The answer is stamped **LOCAL MODEL**.
8. Turn off your internet and ask again — it still answers.
9. Cloud things (accounts, invitations, sync) honestly show **not
   connected** in this mode. That is expected: no database is configured,
   and Sophira never pretends otherwise.

Optional checks:

- `npm run local:test` — verifies the local setup (no downloads).
- `npm run local:test:model -- --yes` — checks the model source is
  reachable (explicit; does not download the weights).

### Local testing on phones / tablets / desktop shells (developers)

`npm run dev` plus any of these works against your local server — no
Vercel deployment needed for development:

- Android: `npm run android:debug`
- iOS: `npm run ios:sync`
- Desktop (Tauri): `npm run desktop:dev`

Production native builds still require a deployed URL
(`SOPHIRA_APP_URL`), exactly as before — this changes nothing about
production.

---

## What works with NO internet after first-time model setup

- Local AI questions and answers (on your device)
- Deterministic math verification (offline math)
- Your locally stored academic data (encrypted offline storage)
- The app itself (installed as a PWA)

## What still needs internet

- The one-time download of the AI engine + model
- Model re-downloads (if you delete the model)
- The first page load if you did not install the PWA

## What needs Supabase (or another backend)

- Accounts, sign-in, invitations, sync — all cloud features.
  (PATH B local testing deliberately works without them.)

## What needs a remote AI provider

- Nothing, if you use the local model. Remote AI is optional, off by
  default, and never required for local testing.

## Why is local-first mode development-only?

`SOPHIRA_LOCAL_FIRST=true` also requires a non-production build, so a
real deployment can never open this path by accident. Production keeps
full sign-in and invitation-only access — unchanged.
