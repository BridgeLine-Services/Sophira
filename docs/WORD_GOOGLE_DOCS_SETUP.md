# Microsoft Word and Google Docs Setup (Owner Guide)

Status: **NOT YET IMPLEMENTED IN CODE — this guide prepares the exact steps
you will take when the integration ships (next stage).** No OAuth apps exist
yet, and no credentials are configured. This document is written now so you
can see exactly what will be required; do not complete these steps until the
integration code is merged and the callback URLs are live.

## Why this is blocked

Direct Word and Google Docs editing means Sophira writes to documents in
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
