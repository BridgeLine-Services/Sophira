# Backup inventory — what must survive

**Status:** Stage 1 of the backup/restoration programme. This document is enforced by
`tests/backup-integrity.ts`: every table below is derived from `supabase/migrations/*.sql`,
and the test fails if a table exists in the schema but is missing from this inventory.

**How these numbers are kept true:** `tests/doc-counts.ts` reads this line, counts the
migrations, the tables they create (minus any dropped later) and the storage buckets,
and fails the suite when they disagree. A migration added without updating this line
is a test failure, not a stale document.

**Scope at time of writing:** 44 migrations, 55 application tables, 1 private storage bucket (`private-docs`).

---

## 1. Two separate things get backed up

Sophira stores information in two places that fail independently:

1. **The database** — members, permissions, invitations, and all academic records.
2. **Object storage** — the actual uploaded files. These are *not* inside a database dump.

A backup that has one and not the other is incomplete. A database row can point at a file
that no longer exists; a file can exist with no row that references it. Both cases are
detected by the verification in `src/lib/backup/manifest.ts`, which refuses to report
success when either side is missing.

---

## 2. Member identity and permissions

These must be restored with their **original identifiers**. A restored member keeps their
existing account id; nothing is ever recreated from an email address.

| Table | Why it is protected | Member-owned | Sensitive |
|---|---|---|---|
| `profiles` | The member's account record: role (`owner` / `user`) and status (active, pending, revoked). Its id equals the authentication id. | yes | yes |
| `invitations` | Outstanding invitations, their state, and their acceptance relationships. | no | yes |
| `invitation_requests` | Requests to invite, which are not the same thing as an invitation. | yes | yes |
| `owner_bootstrap` | Protects the single-owner rule; restored so a second owner is never created on import. | no | no |
| `profile_update_proposals` | Proposed profile changes awaiting the member's approval. | yes | yes |
| `profile_versions` | Prior profile states used for recovery. | yes | yes |
| `provider_connections` | Google, Microsoft, and Canvas connection records. Tokens live here and are never copied into any report or manifest. | yes | yes |

**Restoration rule:** a revoked member stays revoked. A restoration that quietly reactivates
a revoked account fails verification, because revocation is a security decision, not a
temporary state.

**What can and cannot be promised:** application tables preserve identity, role, and status.
Whether a member's *existing password* still works after a restore depends on the
authentication provider's own export and restore support, which has not been tested here.
That limitation is stated rather than glossed over.

---

## 3. Academic records

Every table below is owned by exactly one member and must come back to that same member.

| Table | Why it is protected | Member-owned | Sensitive |
|---|---|---|---|
| `courses` | A member's courses. | yes | no |
| `teachers` | Teacher records. | yes | no |
| `teacher_profiles` | Teacher instructions and preferences that shape assistance. | yes | yes |
| `assignments` | The core academic unit: title, instructions, due date, status. | yes | yes |
| `assignment_files` | Metadata linking an assignment to an uploaded file (`storage_path`). | yes | yes |
| `work_sessions` | Recorded study sessions per assignment. | yes | yes |
| `responses` | A member's own answers and drafts. | yes | yes |
| `feedback` | Feedback attached to work. | yes | yes |
| `essay_sessions` | Essay planning sessions. | yes | yes |
| `writing_samples` | Samples used to learn a member's writing voice. | yes | yes |
| `writing_profiles` | The learned style profile, applied only with member approval. | yes | yes |
| `learning_patterns` | Observed study patterns used for personalisation. | yes | yes |
| `student_memories` | Long-term academic memories. | yes | yes |
| `student_memory_evidence` | The evidence behind each memory. | yes | yes |
| `study_materials` | Generated and saved study material. | yes | yes |
| `subject_preferences` | Per-subject settings. | yes | yes |
| `workload_selections` | Which workload items a member chose. | yes | yes |
| `work_schedules` | Schedules. | yes | yes |
| `schedule_executions` | Runs of those schedules. | yes | yes |
| `typing_attempts` | Typing calibration attempts. | yes | yes |
| `typing_profiles` | Typing baseline used for calibration. | yes | yes |
| `academic_sources` | Sources a member has collected. | yes | yes |
| `document_history` | The truthful record of document operations: what Sophira changed, what changed externally, and recovery copies. | yes | yes |
| `rubric_audits` | Records of rubric reading, kept separate from generated suggestions. | yes | yes |

---

## 4. Research

| Table | Why it is protected | Member-owned | Sensitive |
|---|---|---|---|
| `research_projects` | A research assignment. | yes | yes |
| `research_queries` | Questions asked during research. | yes | yes |
| `research_sources` | Sources retrieved and their verification state. | yes | yes |
| `research_citations` | Citation records tied to sources. | yes | yes |
| `research_claims` | Claims extracted from sources. | yes | yes |
| `research_verifications` | The verification outcome for each source, which is what makes an unverified source honestly say so. | yes | yes |

---

## 5. Notebooks

| Table | Why it is protected | Member-owned | Sensitive |
|---|---|---|---|
| `notebooks` | A member's notebooks. | yes | yes |
| `notebook_notes` | Notes inside a notebook. | yes | yes |
| `notebook_sources` | Sources attached to a notebook. | yes | yes |
| `notebook_questions` | Questions raised. | yes | yes |
| `notebook_evidence` | Evidence attached to notebook claims. | yes | yes |
| `notebook_artifacts` | Generated artifacts. | yes | yes |

---

## 6. Integrations

| Table | Why it is protected | Member-owned | Sensitive |
|---|---|---|---|
| `canvas_courses` | Canvas courses discovered for a member. | yes | no |
| `canvas_assignments` | Imported Canvas assignments, including rubric and attachment references, and the `sync_state` that keeps a removed assignment from vanishing. | yes | yes |
| `canvas_sync_events` | Audit trail of connections and sync runs (no tokens). | yes | no |

`provider_connections` (Section 2) holds the connection records themselves. Its content is
sensitive and is never printed by any backup report.

---

## 7. Notifications and preferences

| Table | Why it is protected | Member-owned | Sensitive |
|---|---|---|---|
| `member_notifications` | A member's own durable notices. | yes | yes |
| `notification_preferences` | Which categories a member wants. Restoring these preserves the member's choices rather than resetting them to defaults. | yes | no |
| `media_assets` | Uploaded lecture audio/video: the member's own file record (name, size, duration, processing state). | yes | yes |
| `media_transcripts` | The transcript of one recording, including which engine produced it and how much of the audio it actually covers. | yes | yes |
| `media_segments` | Timed speech segments (start/end, text, speaker when the engine reported one) that make a quotation citable. | yes | yes |
| `media_frames` | Sampled frames and the text that was actually recognised in them. | yes | yes |

---

## 8. Deliberately excluded from the member backup scope

These are operator or system tables. They are listed so the exclusion stays a visible
decision rather than an oversight:

| Table | Why excluded |
|---|---|
| `sophira_meta` | Internal installation metadata, recreated by setup. |
| `app_config` | Non-secret application settings, rebuilt from the environment. |
| `provider_usage` | Spend telemetry, not member content. |
| `owner_bootstrap` | Included above, not excluded — listed here because it is the one system table that must survive, since it protects the single-owner rule. |

If a future migration adds a table, `checkCoverage` in `src/lib/backup/inventory.ts` reports
it as **missing** until the backup scope includes it. That is the mechanism preventing silent
gaps.

---

## 9. Uploaded files

| Resource | Detail |
|---|---|
| Bucket | `private-docs`, created private in `0001_init.sql` |
| Ownership | Each object lives under a folder named for the member's account id; storage policies restrict access to the owning member |
| Linking | `assignment_files.storage_path` points at the object |
| Backup method | Copied object by object with a SHA-256 checksum each |
| Restore method | Copied back to the same bucket and the same path, so existing database references still resolve |
| Verification | Size and checksum compared against the source; a mismatch fails the backup |

The bucket must never be made public to simplify a test or a restore.

---

## 10. What is verified, and what is not yet

| Check | State |
|---|---|
| Inventory covers every table in the migration chain | verified by test |
| An uncovered table fails the check | verified by test |
| A checksum mismatch fails the whole backup | verified by test |
| A missing member-account component fails the backup | verified by test |
| Credentials cannot appear in a manifest | verified by test |
| A real database dump has been taken and restored | **not run** — needs owner database credentials and a separate environment |
| Real uploaded files have been copied and checksum-compared | **not run** — same reason |
| Existing member passwords survive a restore | **not tested**, and not claimed |

The last three rows are the reason Stage 1 is not marked complete. The rules are proven; the
live run is blocked on access this environment does not have.

## What each line means (2026-11-10)

A backup line is only marked **protected** when there is evidence behind it.

| Line | Marked protected only when |
|---|---|
| Your database | the export file was actually written |
| Member accounts | the account rows were counted inside the database being exported |
| Uploaded files | every listed file was copied |
| File integrity | every copied file has a checksum |
| Database structure | the tables the migrations expect were found in the **live** database |
| Member sign-in after a restore | a practice restore ran, members signed in, and the record is under 180 days old |

The last line is deliberately separate from "Member accounts". Having the account rows in a
database file is not the same as proving somebody can sign in again, and a file count is not a
backup. Until a practice restore has been recorded, Sophira reports the backup as needing
attention instead of calling it complete.

To record a practice restore, write a small file and point Sophira at it:

```json
{ "verified_at": "2026-11-08T15:00:00.000Z", "signin_verified": true }
```

```
SOPHIRA_RESTORE_DRILL=/path/to/restore-drill.json node scripts/backup-sophira.mjs --run
```

A record that says sign-in was not confirmed, or one older than 180 days, never reports as
protected.
