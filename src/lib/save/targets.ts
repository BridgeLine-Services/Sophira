/**
 * AUTOSAVE TARGETS (Phase 4C extension, 2026-11-09).
 *
 * One declarative list of every member-editable thing in Sophira, so the
 * autosave layer, the documentation and the tests all answer the same question:
 * what is autosaved, through which route, and what is the server's version
 * token for it.
 *
 * `coverage` is deliberately honest and is asserted by tests:
 *
 *   "wired"       an editor calls useAutosave() against this target and the page
 *                 renders a SaveStatus, so the member sees the saved/not-saved
 *                 state.
 *   "route-ready" the write route exists and is revision-safe, but no editor
 *                 uses it yet. Listed so the remaining work is explicit rather
 *                 than implied.
 *   "no-editor"   the data is written by a workflow (AI drafting, imports,
 *                 background processing) and there is nothing for a member to
 *                 type, so autosave does not apply. A reason is required.
 *
 * Never claim a target is wired unless the page really uses the hook.
 */

export type AutosaveCoverage = "wired" | "route-ready" | "no-editor";

export interface AutosaveTarget {
  id: string;
  /** Plain-English name shown in documentation. */
  label: string;
  /** Database table the write lands in. */
  table: string;
  /** API path, or null when nothing is written directly by a member. */
  route: string | null;
  method: "PATCH" | "PUT" | "POST" | null;
  /** Fields a member can change through this target. */
  fields: string[];
  /** Where the server's version token comes from in the response. */
  /** Path to the version token in the response body, e.g. "data.updated_at". */
  versionFrom: string | null;
  coverage: AutosaveCoverage;
  /** Required whenever coverage is "no-editor". */
  reason?: string;
}

/**
 * Where the version token sits in a response, as a path. Kept as data so the
 * saver and the tests read the same contract instead of a hard-coded guess.
 */
export const AUTOSAVE_TARGETS: AutosaveTarget[] = [
  {
    id: "essay_outline",
    label: "Essay outline",
    table: "essay_sessions",
    route: "/api/essay/draft-section",
    method: "PATCH",
    fields: ["outline"],
    versionFrom: "data.version",
    coverage: "wired",
  },
  {
    id: "essay_sections",
    label: "Essay sections (drafted text)",
    table: "essay_sections",
    route: null,
    method: null,
    fields: ["draft"],
    versionFrom: "data.version",
    coverage: "no-editor",
    reason:
      "Sections are written by the drafting workflow from the approved outline, not typed by the member; an edit-and-save editor for section text does not exist yet.",
  },
  {
    id: "outlines",
    label: "Assignment outlines",
    table: "essay_sessions",
    route: "/api/essay/draft-section",
    method: "PATCH",
    fields: ["outline", "outline_approved"],
    versionFrom: "data.version",
    coverage: "wired",
  },
  {
    id: "writing_samples",
    label: "Writing samples (voice profile)",
    table: "writing_samples",
    route: null,
    method: null,
    fields: ["title", "content"],
    versionFrom: null,
    coverage: "wired",
    reason:
      "A sample is inserted straight into writing_samples from the editor (one row per sample, no draft row exists to reconcile). Since 2026-11-10 the editor keeps the title and the writing in the encrypted device store while the member types and clears it after a confirmed insert, so a refresh or a closed tab cannot lose the paste.",
  },
  {
    id: "assignments",
    label: "Assignment details",
    // The earlier entry named a `due_date` field: assignments has no such column
    // (the study schedule owns due dates) and the brief is `instructions_text`,
    // not `instructions`. Since 2026-11-10 the assignment page edits both the
    // title and the brief through PATCH /api/assignments/[id], revision-checked,
    // with "Saved" only after the server confirms.
    table: "assignments",
    route: "/api/assignments/[id]",
    method: "PATCH",
    fields: ["title", "instructions_text"],
    versionFrom: "data.updated_at",
    coverage: "wired",
    reason:
      "Typing in the assignment details editor saves through the revision-aware route; a concurrent change is a visible choice and a closed tab leaves an encrypted device draft.",
  },
  {
    id: "assignment_responses",
    label: "Assignment responses",
    table: "assignments",
    route: null,
    method: null,
    fields: ["response"],
    versionFrom: null,
    coverage: "no-editor",
    reason:
      "Sections are written by the drafting pipeline, not by a member editor: no page lets a member type a section, and no API route writes this table. The declared route was removed after the audit because /api/essay/draft-section persists essay_sessions, not essay_sections.",
  },
  {
    id: "notebook_notes",
    label: "Notebook title and description",
    table: "notebooks",
    route: "/api/notebooks/[id]",
    method: "PATCH",
    fields: ["title", "description"],
    versionFrom: "notebook.updated_at",
    coverage: "wired",
  },
  {
    id: "notebook_note_composer",
    label: "Notebook note being written (device draft; row appended on Save)",
    table: "notebook_notes",
    route: "/api/notebooks/[id]/notes",
    method: "POST",
    fields: ["content"],
    versionFrom: null,
    // Deliberately NOT "wired": wired means the autosave engine has a server-confirmed
    // row to report on, and this composer appends a new row only on Save. It is not
    // left unprotected either — the durable device draft below covers a closed tab,
    // so "no-editor" here means "no server-confirmed autosave", nothing more.
    coverage: "no-editor",
    reason:
      "A note is appended as a new row on Save, so autosaving keystrokes would create a row per pause. Instead the composer keeps a durable ENCRYPTED device draft (src/app/notebooks/[id]/page.tsx via src/lib/save/composer-draft.ts): it restores only into an empty field and is cleared once the note is saved, so a closed tab no longer loses pasted text.",
  },
  {
    id: "research_notes",
    label: "Research source approval",
    // Approving or rejecting a source is a single click that saves immediately
    // (PATCH /api/research { source_id, action: approve|reject }). No text is typed
    // anywhere in that flow, so there is nothing a draft could protect and nothing
    // to recover after a refresh — the earlier "route-ready" label implied a missing
    // editor that was never needed.
    table: "research_sources",
    route: "/api/research",
    method: "PATCH",
    fields: [],
    versionFrom: null,
    coverage: "wired",
    reason:
      "A one-click approve or reject saves straight through the route; nothing is typed, so no draft is needed and no work can be lost.",
  },
  {
    id: "academic_memories",
    label: "Academic memories",
    table: "memories",
    route: "/api/memory/[id]",
    method: "PATCH",
    // The route revises `statement` and `details`. The earlier entry named
    // `content` and `category`, which the PATCH does not accept at all.
    fields: ["statement", "details"],
    versionFrom: "data.updated_at",
    coverage: "wired",
    reason:
      "The correction panel saves through the memory PATCH route and, since 2026-11-10, keeps a half-written correction in the encrypted device draft under that memory's id: reopening the panel restores it, and a confirmed save clears it.",
  },
  {
    id: "teacher_preferences",
    label: "Teacher preferences",
    table: "teacher_profiles",
    route: null,
    method: null,
    fields: ["preferences"],
    versionFrom: null,
    coverage: "no-editor",
    reason: "Teacher preferences are recorded from corrections, not typed into an editor.",
  },
  {
    id: "scheduling",
    label: "Study schedule plan inputs",
    // The schedule itself is produced by the server from these inputs; there is no
    // "blocks" field to PATCH (the earlier entry named a table and field that do not
    // exist). Since 2026-11-10 the inputs a member types are kept in the encrypted
    // device draft (src/components/app/SchedulePanel.tsx), so a refresh does not
    // make them re-enter a due date.
    table: "work_schedules",
    route: "/api/schedule",
    method: "POST",
    fields: ["due_at", "urgency", "estimated_work_minutes"],
    versionFrom: null,
    coverage: "wired",
    reason:
      "The plan is created by the server on submit; the typed inputs live in a durable encrypted device draft that is cleared once the plan is saved.",
  },
  {
    id: "profile_settings",
    label: "Settings: profile and study preferences",
    table: "profiles",
    // Saved with the Supabase client from src/app/settings/page.tsx, not through a
    // route: the page reads data.updated_at first and sends it as the base
    // version, so a concurrent change is a conflict rather than an overwrite.
    route: null,
    method: null,
    fields: ["display_name", "academic_level", "explanation_level", "answer_style", "formatting_pref", "preferred_language"],
    versionFrom: "data.updated_at",
    coverage: "wired",
    reason:
      "Client-side revision-checked save on the Settings page (no HTTP route). Added during the 2026-11-09 audit: the Settings profile autosave existed in code but was missing from this registry.",
  },
  {
    id: "integration_settings",
    label: "Integration selections",
    // The earlier entry named "enabled" and "folder_id" fields; the route accepts
    // neither. It revises scope_description and status only. The scope statement the
    // member types before confirming a document is now kept in the encrypted device
    // draft (src/components/app/DocumentBrowser.tsx) and cleared once it is saved.
    table: "integration_selections",
    route: "/api/integrations/selections/[id]",
    method: "PATCH",
    fields: ["scope_description", "status"],
    versionFrom: "data.updated_at",
    coverage: "wired",
    reason:
      "Scope statements are typed once and saved on confirm; the typed text lives in a durable encrypted device draft so a closed page does not lose it, and nothing is stored until the member confirms.",
  },
  {
    id: "document_revisions",
    label: "Document revisions",
    table: "document_history",
    route: null,
    method: null,
    fields: ["body"],
    versionFrom: null,
    coverage: "no-editor",
    reason:
      "Revisions are appended by the document pipeline as new rows; they are immutable by design, so there is nothing to autosave.",
  },
];

export function targetById(id: string): AutosaveTarget | undefined {
  return AUTOSAVE_TARGETS.find((t) => t.id === id);
}

/** Targets a member can currently type into with autosave active. */
export function wiredTargets(): AutosaveTarget[] {
  return AUTOSAVE_TARGETS.filter((t) => t.coverage === "wired");
}

/** Targets that still need an editor wired up. */
export function pendingTargets(): AutosaveTarget[] {
  return AUTOSAVE_TARGETS.filter((t) => t.coverage === "route-ready");
}
