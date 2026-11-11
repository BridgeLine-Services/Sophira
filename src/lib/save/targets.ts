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
    table: "assignments",
    route: null,
    method: null,
    fields: ["title", "due_date", "instructions"],
    versionFrom: null,
    coverage: "no-editor",
    reason:
      "Assignments arrive from the schedule and the course pages; there is no member-facing assignment editor to autosave yet.",
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
    label: "Notebook note being written",
    table: "notebook_notes",
    route: "/api/notebooks/[id]/notes",
    method: "POST",
    fields: ["content"],
    versionFrom: null,
    coverage: "no-editor",
    reason:
      "A note is appended as a new row when the member presses Save, so there is no stored draft row to confirm; autosaving keystrokes would create a row per pause. Since 2026-11-10 the composer keeps a durable ENCRYPTED device draft (src/lib/save/composer-draft.ts via the offline store): it restores only into empty fields and is cleared once the note is saved, so a closed tab no longer loses pasted text.",
  },
  {
    id: "research_notes",
    label: "Research source approval",
    table: "research_sources",
    route: "/api/research",
    method: "PATCH",
    fields: ["approval"],
    versionFrom: null,
    coverage: "route-ready",
  },
  {
    id: "academic_memories",
    label: "Academic memories",
    table: "memories",
    route: "/api/memory/[id]",
    method: "PATCH",
    fields: ["content", "category"],
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
