# Canvas LMS integration (Stage 2, 2026-11-02)

Sophira can read a student's own Canvas courses and assignments and create matching
Sophira assignments for them. It never submits work, never writes to Canvas, and
never touches another student's data.

## What a student sees

1. Settings → Integrations → **Canvas** card.
2. "Connect your Canvas account" → Canvas's own sign-in and consent screen.
3. Back in Sophira: "Your Canvas account is connected."
4. "Check for assignments" → plain-language result, e.g. "2 new assignments and
   1 updated assignment." Each row links to its Sophira workspace.

Every state is a sentence. Canvas API errors, status codes and payloads never
reach the screen; they are recorded as audit events instead.

## Owner setup (one time)

Server-side environment variables — never in chat, files, or the browser:

| Variable | Meaning |
|---|---|
| `CANVAS_CLIENT_ID` | The Developer Key's client id, from the Canvas instance's Admin → Developer Keys |
| `CANVAS_CLIENT_SECRET` | The matching secret |
| `CANVAS_BASE_URL` | The institution's Canvas URL, e.g. `https://school.instructure.com` |

Redirect URI to register on the developer key:
`https://<your-sophira-domain>/api/integrations/canvas/callback`

The card says "Canvas is not available in this copy of Sophira yet" until all three
are present. A configured variable alone never shows as connected: the status route
only reports `verified` after a real Canvas API call succeeds.

## Least privilege

Requested scopes are read-only and course-scoped:

```
url:GET|/api/v1/courses
url:GET|/api/v1/courses/:course_id/assignments
url:GET|/api/v1/courses/:course_id/assignments/:id
url:GET|/api/v1/users/:user_id/profile
```

No administrative scopes, no gradebook access, no write scopes. Tokens are stored in
`provider_connections` (service-role only, no RLS policies) and are removed on
disconnect.

## How discovery stays correct

`planAssignmentSync` is pure and decides what to write by comparing a content
fingerprint (title, instructions, due date, points, submission types, published
state, rubric, attachment names):

- unseen assignment → **create** one Sophira assignment
- changed fingerprint → **update** (never a duplicate)
- absent from Canvas → marked **missing**, never deleted (the student may have work on it)
- previously missing, now present → **restored**
- duplicate rows from Canvas paging → collapsed

Because the fingerprint ignores attachment URLs, a re-signed CDN link does not
manufacture a false "instructions changed" notice.

## Security model

- Every query is user-scoped; `canvas_*` tables have RLS with `user_id = auth.uid()`.
- Sync writes use the *user-scoped* client, so RLS stays the authority. The service
  role is used only to read the requesting student's own token row.
- The instance URL comes from server config, never from the request (no SSRF).
- `normalizeInstanceUrl` rejects non-https and loopback hosts.
- Attachment metadata is stored; `attachmentAllowed` refuses plain http and files
  over the size cap. **Files are not downloaded in this stage** — see limits.
- Canvas assignment text is stored as data and never treated as instructions.
- Account export includes the three Canvas tables (metadata only, no tokens).

## Tests

`tests/run.ts` → `runCanvasIntegrationTests`. Pure logic: instance-URL rejection,
due-date normalisation (never invents a date), fingerprint stability and sensitivity,
first-run create, re-run no-op, update-in-place, duplicate collapse, missing marking,
restore, attachment rules, plain-language summaries, least-privilege scopes. Source
pins: every route authenticates, no JSON payload carries a token, sync never deletes,
migration is additive and re-runnable, the panel is mounted and accessible.

## Known limits (honest list)

- **No live Canvas connection has been exercised.** Everything above is verified by
  unit tests, type-checks and a production build, not by an authorised real account.
- **No webhooks.** Canvas requires an institution-registered developer key and a
  public HTTPS endpoint; students can't do that, so sync is manual/future-scheduled.
  This is the documented polling fallback, not a silent gap.
- **Attachments are referenced, not downloaded.** Metadata is stored so the workspace
  can show them; fetching untrusted files needs its own size/type handling.
- Taxonomy mapping (subject, assignment type) uses existing Sophira defaults; a
  Canvas-native mapping would need real course data to validate.

## Rollback

1. `git revert <merge-commit>` restores code and the integration disappears from the UI.
2. The migration is additive; to remove the schema too, drop `canvas_sync_events`,
   `canvas_assignments`, `canvas_courses`, drop `provider_connections.base_url`, and
   restore the 3-value provider constraint. Existing assignments created from Canvas
   remain valid rows in `assignments` and are unaffected.
3. Unset the three environment variables to disable the feature immediately without
   touching data.
