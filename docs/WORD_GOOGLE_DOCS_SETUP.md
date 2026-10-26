# Microsoft Word and Google Docs Setup (Owner Guide)

Status: **CODE IMPLEMENTED AND TESTED OFFLINE (2026-10-11) — live connections
are BLOCKED until you complete this guide.** The OAuth flows, secure token
storage, real document saves, and the Settings → Integrations page are
merged; the moment these credentials exist in your deployment, the
Connect buttons go live. The exact redirect URIs required are:

- Microsoft: https://sophira.vercel.app/api/integrations/microsoft/callback
- Google: https://sophira.vercel.app/api/integrations/google/callback

## Browsing, selecting, and reading documents (2026-10-12)

- Microsoft: Settings -> Integrations -> "Browse Microsoft files" lists
  your own OneDrive documents plus files explicitly shared with your
  account (where your tenant permits that listing). Selecting a file
  reads its text for read-only assistance through YOUR connection.
  Some school/workplace tenants restrict shared-file listing or
  per-file reads; every refusal is shown honestly, and Sophira never
  requests tenant-wide scopes (no Files.*.All) to work around it.
  Where a tenant blocks the operation, the owner action is an Entra
  admin-consent / tenant-policy review — a decision for the school or
  workplace, never a silent scope expansion by Sophira.
- Google: by default Sophira lists ONLY files it created (the
  least-privilege drive.file scope). "Enable Drive browsing" adds the
  OPTIONAL read-only consent (drive.readonly) through incremental
  consent, so documents shared with your account become browsable.
  Google Docs export as text for read-only assistance; presentations
  and spreadsheets are honestly not-yet-readable and offer the
  downloadable export instead.
- Every selected document is stored as a WORKLOAD SELECTION with the
  scope you state (section, questions, deliverables). Reading a shared
  document never makes its other sections your work, and Sophira never
  creates profiles or memories for people who do not have Sophira
  accounts.

## What each integration saves (all four products)

- Microsoft connection: Word documents (.docx) AND PowerPoint files
  (.pptx) to your OneDrive root (never overwriting an existing file
  silently).
- Google connection: Google Docs (created with full content +
  provenance) AND Google Slides presentations (converted from
  Sophira's .pptx via Google's Drive API).

## Account types (documented, not yet live-verified)

- Microsoft: the app uses the "common" tenant endpoint, which accepts
  personal Microsoft accounts and work/school accounts; organizational
  tenants may require admin consent for the Files.ReadWrite delegated
  permission. This is the provider's behavior, verified only by live
  tests once credentials exist.
- Google: personal accounts and Workspace accounts both work with
  drive.file; while the OAuth consent screen is in Testing status,
  only designated test users can consent, and broader availability may
  require Google verification for the scopes used. Do not assume all
  account types are verified until live tests confirm it.

## Why this is blocked

Direct Word and Google Docs saving means Sophira writes to documents in
YOUR Microsoft 365 and Google accounts, using YOUR authorization. That
requires app registrations owned by you and consent granted by you. No one
can (or should) create these for you, and credentials must never be pasted
into chat, code, or GitHub.

## What will be required (when the code is ready)

### 1. Microsoft (Word)

1. Open https://entra.microsoft.com and sign in with the Microsoft account
   that owns your documents.
2. Microsoft Entra ID -> App registrations -> New registration.
3. Name it "Sophira". Supported account type: "Accounts in this
   organizational directory only" if your documents live in one tenant
   (otherwise "Personal Microsoft accounts" for a personal account).
4. Add the redirect URI shown in the integration settings page of the app
   once it is live (it will be
   https://sophira.vercel.app/api/integrations/microsoft/callback). The exact
   value will also be displayed in-app before you need it.
5. API permissions: Files.ReadWrite (delegated). No admin or tenant-wide
   permissions are required.
6. Certificates & secrets -> New client secret -> copy the SECRET VALUE.
7. Overview -> copy the Application (client) ID.
8. In your hosting provider's environment settings (Vercel: Project ->
   Settings -> Environment Variables) set:
   - MICROSOFT_CLIENT_ID = the client ID (not secret)
   - MICROSOFT_CLIENT_SECRET = the secret value (SECRET)
9. Verify: the integrations settings page will show "Connected" only after a
   real sign-in and a successful verification request — not because the
   variables exist.

### 2. Google (Docs)

1. Open https://console.cloud.google.com and create (or pick) a project.
2. APIs & Services -> Library -> enable "Google Docs API" and "Google Drive API".
3. APIs & Services -> OAuth consent screen -> External -> fill in the app
   name (Sophira) and your contact email.
4. APIs & Services -> Credentials -> Create credentials -> OAuth client ID
   -> Web application. Authorized redirect URI:
   https://sophira.vercel.app/api/integrations/google/callback (the exact
   value will be displayed in-app before you need it).
5. Scopes: the narrowest that supports the workflow will be requested by the
   app (drive.file: documents created or opened through Sophira). Broader
   Drive access is NOT requested.
6. Copy the client ID and client secret, and set in your hosting provider's
   environment settings:
   - GOOGLE_CLIENT_ID = the client ID (not secret)
   - GOOGLE_CLIENT_SECRET = the client secret (SECRET)
7. Verify: same as Microsoft — real sign-in plus a successful verification
   request.

### 3. Disconnecting and revoking

- In Sophira: integrations settings -> Disconnect (this deletes Sophira's
  stored tokens immediately).
- Microsoft: https://account.microsoft.com/consent -> revoke Sophira.
- Google: https://myaccount.google.com/permissions -> remove access.

## What continues to work without these

Local DOCX, PDF, and (new) PPTX export never require provider credentials:
they build files from your stored notebook artifacts with provenance
attached, and download through your browser. Direct Word and Google Docs
editing is an addition on top of that, never a replacement for it.


---

## Document history (2026-10-26)

Every confirmed Sophira document operation is recorded in
`public.document_history` (migration `0040_document_history.sql`):
owner-scoped RLS reads, service-role-only writes, no token columns, and
account-deletion cascade. The Downloads/Documents UI exposes a **History**
button on each workload selection with:

- the version timeline (event type, outcome, provenance, timestamp),
- **Check for changes outside Sophira** — compares provider state with the
  last preserved version (Google: content fingerprint + diff; Microsoft:
  provider eTag metadata only),
- **Compare last two versions** (line diff, additions/removals),
- **Create recovery copy** (Google: a NEW document from the preserved
  snapshot; the original is never modified),
- **Show OneDrive versions / Restore** (Microsoft: provider version history,
  restore guarded by the reviewed eTag).

**Provenance is evidence, not authorship.** History labels Sophira-generated,
Sophira-inserted, user-requested, user-confirmed, external-observed,
provider-reported, or unknown. Sophira never produces an authorship score or
a misconduct verdict from revision metadata.

### Word replacement safety

Replacing a Word file is a **whole-file** operation (a freshly built DOCX from
your Sophira artifact — existing Word comments/tracked changes are not
preserved). It now requires the eTag of the version you reviewed:

1. open the file's current version in Sophira (`GET /api/integrations/microsoft/documents?item_id=...`),
2. confirm the replacement with that eTag,
3. Sophira re-reads the file and refuses if it changed (and the PUT itself is
   `If-Match`-guarded, so a concurrent change fails with 412).

### Live verification still required (owner actions)

Code is complete and unit-tested with mocks; nothing below can be done from
the repository:

1. Register the Google Cloud OAuth client with the redirect URI
   `https://sophira.vercel.app/api/integrations/google/callback`, scope
   `drive.file` only.
2. Register the Microsoft Entra app with
   `https://sophira.vercel.app/api/integrations/microsoft/callback` and
   delegated `Files.ReadWrite offline_access`.
3. Set `GOOGLE_CLIENT_ID/SECRET` and `MICROSOFT_CLIENT_ID/SECRET` in Vercel.
4. Connect a real account, then verify: create → read → section insertion →
   conflict (edit in the provider between read and write) → history events →
   compare → recovery copy → Word eTag replacement refusal.
