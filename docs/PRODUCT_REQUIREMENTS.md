# Sophira — the Owner's product requirements

**Owner:** BridgeLine Services · **Established:** 2026-11-15
**This document is the authoritative product specification.** Where code, a comment, a README,
a historical note or an automated agent disagrees with it, this document wins.

---

## 1. Whose decisions these are

Sophira is an invitation-only, personalised, multi-user academic AI platform. Its purpose is
to help students learn, understand, research, write, organise, study and complete academic
assignments from elementary school through PhD level, across four dashboard roles: Owner,
Co-Owner, Tester and student/member.

**The Owner is the authority** over the product specification, platform configuration,
security, administration and approved development requirements.

An agent, developer, prompt, source comment, README or implementation note **may not** replace,
narrow or widen a product requirement. An agent may:

- implement what this document and an approved directive describe;
- report a technical or platform limitation and the specific evidence for it;
- propose a change, and wait.

An agent may **not** decide that a requested capability will never be built, and record that
decision as though it were the Owner's. That failure is the reason this document exists; see
§4 for the historical case and what was corrected.

## 2. How a decision enters this document

1. The Owner states a requirement (a directive, a message, a correction).
2. It is written here as a numbered requirement, in the Owner's terms, with a status.
3. The status is supported by **evidence**: a file, a test, a migration, a verification run.
   A capability is never marked done because code exists.
4. Implementation decisions, feasibility limits and platform constraints are recorded **in a
   separate section (§5)**, never mixed into the requirement itself.
5. A change to a requirement is a dated entry in §6. The previous value still happened; it is
   not silently rewritten.

Status vocabulary (this exact wording is used in the code and on the Owner dashboard):

| Label | Meaning |
| --- | --- |
| `IMPLEMENTED AND TESTED` | Built, regression-tested offline, evidence named. |
| `IMPLEMENTED, LIVE VERIFICATION REQUIRED` | Built and tested, but the proof needs a live service, credential or device. |
| `PARTIALLY IMPLEMENTED` | Some of the stated requirement is delivered; the remainder is named. |
| `BLOCKED` | Cannot proceed without something only the Owner can supply. The obstacle is named. |
| `NOT STARTED` | Recognised, not begun. Never hidden. |
| `EXISTING FUNCTIONALITY PRESERVED` | Pre-existing behaviour that must keep working exactly as it does. |
| `AWAITING OWNER APPROVAL` | Built as a proposal, or waiting for a decision the Owner has not made. |
| `DEPRECATED` | Approved for withdrawal by the Owner. Nothing is withdrawn without this label. |

## 3. Requirements

### R1 — The existing website keeps working (zero regression)
Every page, API route, dashboard, permission and database object that exists today continues
to exist and to behave as it does. No page deleted, no route removed or renamed, no response
contract changed without cause, no table dropped, no column dropped, no migration file edited
after it has been applied, no test disabled, no assertion relaxed to make new code pass.
*Status:* `EXISTING FUNCTIONALITY PRESERVED`. *Evidence:* `docs/PRESERVATION_AUDIT_2026-11-15.md`
(baseline 9017 assertions, 111 API routes, 82 pages recorded before any change).

### R2 — Additive by default
Extend existing functions, components, services, tables, guards and verification utilities.
A genuinely new table gets a new numbered migration. A genuinely new route is a new route.
A new workflow mode is an option beside the existing one.
*Status:* `IMPLEMENTED AND TESTED`. *Evidence:* migration `0059` is additive and new routes are
new paths; no applied migration file was modified.

### R3 — New functionality is independently controllable
Major new capability sits behind its own switch, defaulted **off**, with a documented rollback.
*Status:* `IMPLEMENTED AND TESTED`. *Evidence:* `src/lib/features/flags.ts`,
`docs/AUTONOMOUS_ASSIGNMENTS.md` §7.

### R4 — Autonomous assignment completion
Sophira can carry a whole academic assignment through plan → draft → audit → verify without the
student requesting each section, in an explicitly chosen `autonomous_draft` mode, while the
existing manual mode and its outline-approval gate remain exactly as they are.
*Status:* `IMPLEMENTED, LIVE VERIFICATION REQUIRED`. *Evidence:* `src/lib/essay/autonomous.ts`,
`src/lib/essay/runner.ts`, `/api/essay/autonomous*`, `tests/autonomous-assignment.ts`.
Live generation needs a configured AI provider (Owner key), which is not present today, so the
run reports `blocked` with that reason rather than producing a draft.

### R5 — Honest progress and honest completion
A run's state is what the server actually did. A section counts as drafted only when its text
is stored. A run is `completed` only when every section is stored **and** a final verification
verdict is recorded. Nothing reports completion because a request was submitted.
*Status:* `IMPLEMENTED AND TESTED`. *Evidence:* `canClaimCompletion()` and its assertions in
`tests/autonomous-assignment.ts`.

### R6 — Durable state, safe retries, resumable steps
Run state lives in the database, not in a browser timer. A retry resumes rather than duplicating.
A repeated callback cannot create a second artifact. A failed section never erases completed ones.
*Status:* `IMPLEMENTED, LIVE VERIFICATION REQUIRED`. Evidence: `assignment_runs` (lease token,
attempts, `step_index`), step idempotency assertions, and the migration's unique
`(user_id, idempotency_key)` index. Multi-process concurrency needs a live database to prove.

### R7 — No invented background execution
Sophira must not claim an assignment continues generating while the application is closed
unless a real worker is running. The status view states which continuation mode is active.
*Status:* `IMPLEMENTED AND TESTED`. *Evidence:* `continuationMode()`; the deployment has no cron
and no queue (`docs/PRESERVATION_AUDIT_2026-11-15.md` §5).

### R8 — One academic context for every AI path
Every new assignment path uses the existing shared context service: course, teacher
requirements, approved writing preferences, student memory and learning patterns, with
assignment > teacher > course > student precedence and per-user isolation.
*Status:* `IMPLEMENTED AND TESTED`. *Evidence:* `loadAcademicContext` is the only context path
used by the runner; `tests/academic-context.ts` and the precedence assertions.

### R9 — Personalisation never overrides a teacher
A student's habit never outranks an explicit teacher instruction, a rubric requirement or the
assignment's own constraints.
*Status:* `EXISTING FUNCTIONALITY PRESERVED` (the precedence line is in the context service and
is carried into the autonomous prompts). *Evidence:* `AUTHORITY_LINE` in
`src/lib/ai/academic-context.ts`; pinned in `tests/autonomous-assignment.ts`.

### R10 — The 17 writing dimensions, approvals and version history stay
No dimension removed or simplified; suggestions stay evidence-based, scoped, approval-gated and
reversible; profile history preserved; the analyser keeps working with no model configured.
*Status:* `EXISTING FUNCTIONALITY PRESERVED`. *Evidence:* `writing-profile-learning.ts`,
`profile_update_proposals`, `profile_versions`, `ProposalsPanel.tsx`, `ProfileVersionHistory.tsx`.

### R11 — Genuine document history, never manufactured authorship
Document history reflects changes actually confirmed by Google or Microsoft, versions observed
by Sophira, or local drafts, and is labelled by what established it. No mechanism may fabricate
revision activity to imply human authorship, and Sophira makes no authorship claim the provider
does not establish.
*Status:* `EXISTING FUNCTIONALITY PRESERVED`, extended by `docs/DOCUMENT_HISTORY_DISCLOSURE.md`
and the completed-work library. *Evidence:* `history-labels.ts`, `gradual-insert.ts`.

### R12 — Dashboards expand, permissions do not move
Owner, Co-Owner, Tester and student dashboards gain the new information; every existing block
and every role restriction stays. Co-Owners keep no Owner-only power.
*Status:* `PARTIALLY IMPLEMENTED`. Owner monitoring and the requirement/roadmap view are built;
Co-Owner task queue, Tester test-case library and the student assignment centre remain to build.

### R13 — Security and privacy are not traded for convenience
Every member-facing route uses the existing authentication guard and the user-scoped client;
run records are owner-scoped with RLS; no service-role client in a member route; no key or token
in a response or a component; teacher documents, sources and uploads stay untrusted data;
prompt-injection and SSRF protections preserved.
*Status:* `IMPLEMENTED AND TESTED`. *Evidence:* `requireUser` on every new route, RLS policies in
`0059`, the untrusted-content wrapping assertions, `npm run scan:secrets` clean.

### R14 — No database change without a plan
New schema is additive, reversible where possible, RLS-enabled, indexed, ordered after 0058,
with updated generated types and the mandatory migration marker.
*Status:* `IMPLEMENTED AND TESTED`. *Evidence:* `0059_assignment_runs.sql`,
`scripts/migration-markers.mjs`, `docs/BACKUP_INVENTORY.md` counts, migration self-test.

### R15 — Verification is real
The repository's own commands are run and reported: tests, type check, lint, build, verify,
release-gate self-test, secret scan, migration check. Live tests are distinguished from offline
tests. If a command cannot run, that is stated.
*Status:* `IMPLEMENTED AND TESTED`. Evidence: the report in `docs/AUTONOMOUS_ASSIGNMENTS.md` §9
and the round section in `docs/SOPHIRA_CURRENT_STATE_2026-11-13.md`.

### R16 — Product requirements are visible to the Owner
The Owner dashboard shows approved requirements, implemented, in-progress, blocked, unstarted and
deprecated features, and awaiting-approval items, each backed by repository or operational
evidence, plus a change log of specification, agent, flag, permission, migration and deployment
changes.
*Status:* `IMPLEMENTED, LIVE VERIFICATION REQUIRED` for the change log (it reads real audit rows
and needs a signed-in Owner to display). Evidence: `src/lib/governance/product-spec.ts`,
`/owner/requirements`.

## 4. Historical implementation decisions that were not Owner decisions

These were made by an earlier automated development process. They are recorded here **as
history**, because deleting them would falsify the record. None of them binds future work.

| Date | Decision | Made by | Status |
| --- | --- | --- | --- |
| 2026-10-29 | Simulated human typing (injected typos, artificial delays) and staggered partial Word drafts would not be built; `docs/WRITING_PROFILE_LEARNING.md` said "do not rebuild it". | Automated development process | **Reclassified 2026-11-15**: a historical implementation decision and an integrity constraint, not an Owner decision. It no longer forbids anything. The reasoning is preserved; the authority claim is removed. |
| 2026-11-02 | "Gradual insertion" is real chunked insertion with provider-confirmed progress, not a typing simulation. | Automated development process | Reclassified 2026-11-15: this is a description of what the feature *is*, and it stays true. It is not a statement about what the Owner may ask for. |

### The integrity boundary that does still apply

This is not a product preference; it is the line between honest assistance and deception, and
it holds for every future build:

> Sophira does not manufacture false evidence of authorship, fabricate revision activity,
> conceal AI authorship, or attempt to evade plagiarism or AI-detection systems.

A request for these is refused **as such a request**, with the reason, and the refusal is
recorded here. The Owner may overrule a *product* decision at any time; this boundary is about
what the artefact claims to be true, and it is reported rather than assumed.

## 5. Implementation limits, kept separate from requirements

These are technical facts about *this* deployment. They are not statements about what the
product should be, and they do not remove anything from the roadmap.

1. **No durable worker exists.** `vercel.json` has no `crons`; there is no queue service and no
   background function. Assignment runs advance on an open page or on the next visit, and say so.
   A cron line or an external queue is a one-line/one-account change the Owner can approve.
2. **Serverless time is bounded.** One function invocation cannot generate a whole essay. Hence
   one bounded step per call.
3. **Vercel plan limits cron frequency.** A schedule the plan does not permit fails the
   deployment, which is why the schedule line is the Owner's decision rather than a default.
4. **Live AI needs a provider key.** Without it every AI capability reports "requires provider
   configuration" and no draft text is generated.
5. **Tesseract and Whisper cannot run inside a Vercel request.** They belong on the separate
   inference server (see the provider-key round, current-state §21).

## 6. Change log for this document

| Date | Change | By |
| --- | --- | --- |
| 2026-11-15 | Document created. Owner authority established; the 2026-10-29 decline reclassified as a historical implementation decision; implementation limits separated into §5. | Directive of 2026-11-15 |
