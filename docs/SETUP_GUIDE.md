# Sophira Setup Guide — plain English (2026-10-13)

One page, no jargon. If you can use the Vercel website, you can run Sophira.

## What is already working

Nothing in this list needs anything from you. The database, login, academic
workflows, archiving, and the built-in AI model are live today:

- Login, invitations, and your Owner Dashboard.
- Courses, assignments, notebooks, research, typing, scheduling, library.
- The free built-in AI model (works with zero API keys).
- Document downloads (DOCX, PDF, PPTX).

## The only setup that is genuinely required

Nothing new. Your database and login are already configured and running.
If the app ever asks for them, these are the only "must have" values (they
belong in Vercel → Sophira → Settings → Environment Variables, and they are
already there):

1. `NEXT_PUBLIC_SUPABASE_URL` — the address of your database.
2. `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the public key for login.
3. `SUPABASE_SERVICE_ROLE_KEY` — the private key the server uses (never
   put this in a chat, a screenshot, or a document).

## Optional extras — each one turns on a feature, nothing breaks without it

| If you want... | You add... | Where |
| --- | --- | --- |
| Automatic invitation emails | `RESEND_API_KEY` (+ a verified sender) | Vercel env vars |
| Save documents into Word / Google Drive | Microsoft + Google app registration (4 values) | Vercel env vars — see docs/WORD_GOOGLE_DOCS_SETUP.md |
| Live web research | `SEARCH_PROVIDER` + `SEARCH_API_KEY` | Vercel env vars |
| Faster cloud AI (optional — built-in AI works) | `AI_PROVIDER` + `GEMINI_API_KEY` | Vercel env vars |

The dashboard and health page always tell you honestly which of these are
configured; nothing pretends to be connected.

## How to add a value (about 2 minutes each)

1. Open https://vercel.com and select the Sophira project.
2. Click Settings → Environment Variables.
3. Paste the NAME exactly as shown above, and the value you were given.
4. Click Save, then Deployments → Redeploy (so the app sees it).
5. Open https://sophira.vercel.app/owner/health to confirm it now shows ready.

## Common problems and fixes

- "I added the key but it still says not configured" → you missed step 4
  (redeploy). Do it once and re-check the health page.
- "Invitations show a copy link instead of sending email" → the email key
  is missing; the copy link always works in the meantime.
- "Word / Google says not set up" → the app registration steps have not
  been finished; downloads still work meanwhile.

## What was simplified in this round

- The Owner Dashboard Integrations link now opens an owner page inside the
  Owner Dashboard (it used to drop you into personal Settings).
- Typing history no longer breaks when optional measurement columns are
  missing — the test can always start.
- Notebook creation always shows the new notebook immediately, and any
  list-loading problem now shows an honest message instead of an empty page.

For the full technical list see docs/ENVIRONMENT_VARIABLES.md; for your
personal action checklist see docs/WHAT_I_NEED_TO_DO_NEXT.md.
