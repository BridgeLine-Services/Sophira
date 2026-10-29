# Google Docs / Word + document history: verified state (2026-10-29)

**Headline: the scope of this task is already implemented on `master`.** I audited
it rather than rebuilding it, and found no missing core capability.

Verified just now: `npm test` 4090/4090, tsc, build, verify, secret-scan - all green.

## What already exists (file evidence)

| Capability | Location |
|---|---|
| History model + event types + provenance + disclaimer | `src/lib/integrations/history.ts` |
| History table, owner-only RLS, sequence uniqueness | `supabase/migrations/0040_document_history.sql` |
| History API: `observe`, `recovery_copy`, `restore_version` | `src/app/api/integrations/document-history/route.ts` |
| Google revision-guarded insert + history recording | `google/doc-update/route.ts` |
| Word eTag conditional write + provider version | `microsoft/documents/route.ts`, `overwriteDocxGuarded` |
| Version listing / restore | `listItemVersions`, `restoreItemVersion` |
| History UI in document browser | `src/components/app/DocumentBrowser.tsx` |
| Tests | `tests/document-history.ts` (47 assertions), `tests/provider-integrations.ts` (45) |

Safety properties confirmed in code, not assumed:

- `user_id ... on delete cascade` - deleting the account removes history; the
  delete route calls `admin.auth.admin.deleteUser`, so the cascade actually fires.
- `using (auth.uid() = user_id)` RLS; no client policies on `provider_connections`.
- No token fields in the history schema; snapshots are fingerprints or
  provider-version references, never OAuth secrets.
- `external_change_observed` events are labelled `actor: "external"`,
  `provenance: "external-observed"` - observed change is never written up as
  proven authorship, and no code path emits a misconduct verdict.
- Restore records `restore_refused` on eTag mismatch instead of retrying as an
  unconditional overwrite.
- Word bytes are **not** stored by Sophira; the API says so plainly and points at
  OneDrive version history rather than implying a recoverable local copy.

## What I could NOT verify here (blocked, not complete)

No Google or Microsoft credentials exist in this environment, so **everything
above is offline/mocked verification only**. Not tested against a real account:

1. Real OAuth consent, callback round-trip, and scope grant (Google + Microsoft).
2. Real Google Docs insert on a live document with a real `requiredRevisionId`
   race between read and write.
3. Real Word `If-Match` 412 from Microsoft Graph on a concurrently edited file.
4. Real provider version restore (OneDrive) and Google recovery-copy restore.
5. Whether Google app verification / Microsoft consent-screen review is needed
   for accounts outside the owner's tenant.

Owner actions still required (unchanged by code): register the Google Cloud
OAuth client with the documented redirect URI, enable Docs + Drive APIs, publish
the consent screen; register the Entra app with delegated `Files.ReadWrite` and
`offline_access`; set `GOOGLE_CLIENT_ID/SECRET` and `MICROSOFT_CLIENT_ID/SECRET`
in Vercel; then connect both accounts once and run one real edit + one real
conflict against a throwaway document.

## Gaps I did find (none blocking)

- The setup guide mentions history only in passing (4 references); the owner
  steps above are not yet written out in it as a checklist.
- No live-provider test harness exists, so the conflict paths are proven by
  unit-level simulation only.
- ~~`npm run lint` unavailable~~ **RESOLVED 2026-10-29**: eslint now installed with a
  correctness-only ruleset. 0 errors, 107 warnings (102 unused vars, 5 hook deps),
  frozen as a ratchet at `--max-warnings=107` so no new debt can land.

## Recommendation

Do not rebuild this feature. The next useful work is (a) the setup-guide
checklist, and (b) a live smoke test once the four client secrets exist.
