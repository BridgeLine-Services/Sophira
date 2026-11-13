# Integration and Owner Readiness

**Phase 4 deliverable (directive Part 13). Generated 2026-11-13 from real probes, not from memory.**

Every row below was produced by one of three things in this session: `GET /api/health` on
production, `node scripts/release-gate.mjs` (41 checks: 25 pass, 1 fail, 14 blocked, 1 not run),
or a read-only probe of the live database. Nothing here is inferred from a configuration field
existing; Part 13 says a green state needs a real service answer, so each row says which of the
five states it has actually reached.

**The five states, in plain words**

| State | Means |
|---|---|
| Implemented | The code exists and its tests pass |
| Configured | The setting or key is present in the running deployment |
| Operational | The service answered a real request |
| Tested | A live, signed-in or end-to-end check passed |
| Blocked | Something outside the code is needed first |

## 1. Where each integration stands

| Integration | What it does for students | Implemented | Configured | Operational | Tested | What is missing |
|---|---|---|---|---|---|---|
| Supabase (database, sign-in, storage) | Holds every account, course, notebook and study record | Yes (0057 migrations) | **Yes** (`supabase: true`, `supabase_service_role: true`) | **Yes**: live tables and functions answer | **Yes**: read-only live checks pass, RLS enforced | nothing |
| Migrations 0057 | The three flashcard tables the new study screens read | Yes | **No**: the live database does not have it yet | No | No | **one owner action**: press Update database at `/owner`. The release gate names it exactly: `flashcard_decks (0057_flashcard_decks.sql)` |
| AI provider (all seven modes) | Tutoring, assignment help, checking, writing, study, explanation | Yes: 7 modes preserved, one shared academic context | **No** (`ai: false`, `ai_selfhost: false`) | **No**: every AI route answers with the plain readiness message | Offline only: 27 deterministic cases pass, live cases are skipped and never counted as passes | a provider key. The free path is a Gemini key; OpenAI only counts if paid use is explicitly allowed. The owner decides; nothing paid was enabled |
| Local / self-hosted inference | The intended primary engine | Yes: the provider architecture supports it | **No** (`ai_selfhost: false`) | No | No | an inference server, then a benchmark (this is the Phase 2 dev item still open) |
| Research / web search | Live source-backed research and citations | **Yes**: URL safety, authority, claims, citations, READY/NOT READY gate all preserved | **No** (`search: false`) | No | Offline only: scope and SSRF tests pass | a search provider key. Research degrades gracefully: study tools still work |
| Google / Microsoft document save | Saving an artifact to Docs or OneDrive | **Yes**: routes exist and handle 401/503 in plain words | **Now reported** by `/api/health` as `google_documents` / `microsoft_documents`, from the same functions the feature calls (§1a) | No: no OAuth app is registered | No | the two OAuth apps (owner decision). Nothing to build: the state is now visible |
| Invitation email | Delivering an invitation to a new member | **Yes**: `invitations.email_status` and the delivery layer exist | **Now reported** by `/api/health` as `invitation_email` (§1a) | No | No: no email has been delivered end to end | a mail provider setting (Resend, or a compatible endpoint), then one real invitation |
| Backups and restore | Recovering the network | **Yes**: `scripts/backup-sophira.mjs` with a restore drill row | Credentials unverified this round | No | **No**: no restore drill has been run | credentials, then an actual drill |
| Signed-in / multi-member testing | Proving roles, privacy and isolation live | **Yes**: the matrices exist | **No**: `SUPABASE_TEST_URL` and the two keys are absent | No | **No** | a usable test member. Invitation-only access is a standing owner rule and no usable member exists |
| Native app builds | An Android/iOS build | Partly: Tauri and Android scaffolding | No | No | No | a Gradle build, then a device |
| Physical-device testing | Phone and tablet behaviour | Yes: responsive layouts and a PWA | n/a | n/a | **No**: no device available to this agent | an owner with a phone, five minutes, and `docs/DEVICE_ACCEPTANCE.md` |
| Legal documents | Terms, privacy, licence | Yes | **No**: owner facts are still placeholders | n/a | n/a | the owner's real business details. They will not be invented |

## 1a. The capabilities that used to be "unknown"

The first version of this report had to write "unknown" for Google, Microsoft and invitation
email, because nothing exposed their state. They are now reported by `GET /api/health` as
`google_documents`, `microsoft_documents`, `invitation_email` and `sms`, derived from the SAME
functions the features call, so a green light cannot appear while the feature is off.

Booleans only: no value, variable name or hostname is ever returned. The owner-facing version of
the same facts is on **Owner Dashboard → System Status**, in plain words, with what still works
when something is off.

| Capability | Production value at the last probe |
|---|---|
| Google document save | **not configured** - no OAuth app registered |
| Microsoft document save | **not configured** - no OAuth app registered |
| Invitation email | **not configured** - invitations still work by sharing the link |
| SMS | **not configured** - not used by any member feature yet |

These four rows are now self-reporting: the next report reads them from `/api/health` instead of
asking anybody to remember whether a setting exists.

## 2. The one thing the owner can do today

The live database is missing exactly one migration, and until it is applied the new study screens
have no tables to read in production. The release gate reports it by name rather than pretending
the database is ready:

```
flashcard_decks (0057_flashcard_decks.sql) — run the /setup repair to apply the missing tail
```

Press **Update database** once at https://sophira.vercel.app/owner and paste back the message it
shows. That closes the only code-side blocker in this report.

## 3. What is blocked, and on whom

| Blocker | Needed from | Consequence if it stays blocked |
|---|---|---|
| AI provider key | Owner (a choice, not a task) | No AI answer can be verified against a real model. Every AI route stays honest and unavailable |
| Search provider key | Owner | Research stays unavailable; nothing else degrades |
| Test member account | Owner (an invitation) | Roles, privacy and isolation stay offline-tested only |
| Physical device | Owner | Phone and tablet behaviour stays unverified |
| Legal owner facts | Owner | Legal pages stay explicitly placeholder-blocked |
| Restore drill | Credentials, then a run | Backup recovery stays unproven |
| Inference server + benchmark | Development | The local-AI-primary goal is unmeasured |

## 4. What this report does not claim

- It does not claim any signed-in screen has been seen working. None has.
- It does not claim AI, research or integrations work. None is configured.
- It does not claim the study screens are device-tested.
- It does not treat a present configuration field as proof of a working service.

Every claim above maps to a probe that was actually run in this session, and any row marked
unknown says so rather than guessing.

## 5. The honest headline

Sophira's **code** is ready for Phase 5 acceptance. Sophira's **deployment** is not: it lacks an AI
provider, a search provider, a test member, device access, backup credentials and one migration.
That is a configuration list, not a code list, and most of it needs the owner's decision, not more
development.
