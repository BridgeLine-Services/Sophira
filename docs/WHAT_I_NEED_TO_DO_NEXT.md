# What I Need to Do Next

A short guide for the owner of Sophira. It lists only the actions that truly
need you. Everything else (testing, building, checking, reporting) happens
automatically. You never need to open a terminal, write SQL, or edit code.

**Where Sophira stands right now:** NOT READY for release. The app itself is
built and fully tested, and it will never pretend otherwise: nothing is
marked ready unless it was genuinely verified. The items below are the only
things standing between Sophira and launch.

**Golden rule about secrets:** you will sometimes add private keys
(Sophira calls them environment variables). Only ever do this in your
hosting provider's secure settings screens (the guide named below shows the
exact screen). Never paste a key into a chat, a file, an email, or a message.

---

## 1. Connect your database

Sophira keeps all its information (accounts, assignments, memories) in a
private database. It is not connected yet, so nothing can be verified.

**What to do:** in your hosting dashboard, open this project's settings and
connect the Supabase integration. It fills in the database settings
automatically. The variable names it provides are SUPABASE_URL,
SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY; you should not need to
copy them anywhere yourself.

**How you know it worked:** Owner Dashboard, then System Health shows the
database item as Ready.

## 2. Give Sophira its web address

Phone and tablet features, email links, and live health checks need to know
where your app lives on the web.

**What to do:** in your hosting provider's environment settings, set
SOPHIRA_APP_URL to your deployment's address (it looks like
https://your-app.vercel.app).

## 3. Connect the AI helper

Essay feedback, planning help, and tutoring need an AI provider.

**What to do:** in your hosting provider's environment settings, add
GEMINI_API_KEY, the free Google AI key. docs/ENVIRONMENT_VARIABLES.md shows
the exact screen and where to get the key. No paid service is ever turned on
without your explicit approval.

## 4. Connect research and web search

The research tools search the real web and verify every source. Without a
search provider they stay switched off; they never invent sources.

**What to do:** add SEARCH_API_KEY in your hosting provider's environment
settings (docs/ENVIRONMENT_VARIABLES.md has the step by step).

## 5. One-time: a private practice copy of the database

Before Sophira can run its live security drills (proving that one member can
never see another member's private work), it needs a throwaway practice
database it can test against safely.

**What to do:** add three one-time values, SUPABASE_TEST_URL,
SUPABASE_TEST_ANON_KEY, and SUPABASE_TEST_SERVICE_ROLE_KEY, in the secure
location shown in docs/ENVIRONMENT_VARIABLES.md. Sophira then runs the
drills automatically. No SQL or terminal work is needed.

## 6. Try the app on your phone or tablet

Some things (touch, on-screen keyboards, offline use) can only be proven on a
real device. Automation cannot do this for you, and Sophira will not pretend
it did.

**What to do:** follow the beginner checklist in docs/DEVICE_ACCEPTANCE.md
on your own phone or tablet. It tells you exactly what to tap and what to
look for.

## 7. Provide your legal information

The Terms of Service, Privacy Policy, and License are complete templates,
but a few facts can only come from you (your legal name or business name,
address, contact email, effective date, your jurisdiction, and your data
retention choice). Sophira will not invent them.

**What to do:** fill in the fields listed in docs/legal/LEGAL_CONFIGURATION.md.
Then, before you publish, have a qualified attorney review the documents
(see docs/legal/LEGAL_REVIEW_NOTICE.md). An automated check can never
replace legal review.

---

## How to watch progress

- Open the app, go to Owner Dashboard, then System Health. It runs the real
  release checks and explains each one in plain English, with the exact
  action for you.
- A complete checkup also runs automatically once a week, and you can start
  one yourself from the project's Checks page on GitHub ("Scheduled health
  check", then "Run workflow"). If something needs your attention, a single
  issue named "Sophira health check needs your attention" appears on the
  repository and closes itself once everything genuinely passes.
- When every check shows Ready, System Health will say READY FOR RELEASE.
  Until then it honestly says NOT READY.
