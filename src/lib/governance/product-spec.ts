/**
 * THE OWNER'S PRODUCT SPECIFICATION, IN CODE (2026-11-15).
 *
 * docs/PRODUCT_REQUIREMENTS.md is the authoritative document. This module is the SAME
 * content in a shape the Owner dashboard can render and the test suite can pin, so the two
 * can never drift: `tests/product-governance.ts` fails if a requirement here is missing from
 * the document, if a status is outside the agreed vocabulary, or if an "implemented" status
 * carries no evidence.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE
 * Historical implementation decisions taken by an automated development process are NOT
 * product requirements. They are recorded as history (`HISTORICAL_DECISIONS`) with who made
 * them and what happened, and they cannot forbid a future Owner requirement.
 *
 * PURE: no database, no network, no React, no clock. Everything is data.
 */

/** The directive's own status words. Never invented, never softened. */
export const REQUIREMENT_STATUSES = [
  "IMPLEMENTED AND TESTED",
  "IMPLEMENTED, LIVE VERIFICATION REQUIRED",
  "PARTIALLY IMPLEMENTED",
  "BLOCKED",
  "NOT STARTED",
  "EXISTING FUNCTIONALITY PRESERVED",
  "AWAITING OWNER APPROVAL",
  "DEPRECATED",
] as const;

export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export type RequirementGroup =
  | "Governance and preservation"
  | "Academic AI"
  | "Personalisation"
  | "Documents"
  | "Dashboards"
  | "Security"
  | "Verification";

export interface ProductRequirement {
  /** Matches the heading in docs/PRODUCT_REQUIREMENTS.md ("R4 — ..."). */
  id: string;
  title: string;
  group: RequirementGroup;
  /** The requirement in the Owner's terms. */
  statement: string;
  status: RequirementStatus;
  /** Concrete, checkable support. Never "the code exists". */
  evidence: readonly string[];
  /** What is still missing, or null when nothing is. */
  remaining: string | null;
  /** What only the Owner can supply, or null. */
  ownerAction: string | null;
}

export const PRODUCT_REQUIREMENTS: readonly ProductRequirement[] = [
  {
    id: "R1",
    title: "The existing website keeps working",
    group: "Governance and preservation",
    statement: "Every page, route, dashboard, permission and database object that exists today continues to exist and behave as it does. No test is disabled and no assertion relaxed.",
    status: "EXISTING FUNCTIONALITY PRESERVED",
    evidence: ["docs/PRESERVATION_AUDIT_2026-11-15.md (baseline recorded before any change)", "npm test 9017/9017 at baseline", "tests/autonomous-assignment.ts (manual essay contract unchanged)"],
    remaining: null,
    ownerAction: null,
  },
  {
    id: "R2",
    title: "Additive by default",
    group: "Governance and preservation",
    statement: "Extend existing functions, components, services, tables and guards. New schema gets a new numbered migration; new routes are new paths; a new mode is an option beside the old one.",
    status: "IMPLEMENTED AND TESTED",
    evidence: ["supabase/migrations/0059_assignment_runs.sql (additive)", "no applied migration file modified"],
    remaining: null,
    ownerAction: null,
  },
  {
    id: "R3",
    title: "Independently controllable",
    group: "Governance and preservation",
    statement: "Major new functionality sits behind its own switch, defaulted off, with a documented rollback.",
    status: "IMPLEMENTED AND TESTED",
    evidence: ["src/lib/features/flags.ts", "docs/AUTONOMOUS_ASSIGNMENTS.md §7"],
    remaining: null,
    ownerAction: null,
  },
  {
    id: "R4",
    title: "Autonomous assignment completion",
    group: "Academic AI",
    statement: "Sophira carries a whole assignment through plan, draft, audit and verification without the student asking for each section, in an explicitly chosen mode, while the manual mode and its outline gate are unchanged.",
    status: "IMPLEMENTED, LIVE VERIFICATION REQUIRED",
    evidence: ["src/lib/essay/autonomous.ts", "src/lib/essay/runner.ts", "src/app/api/essay/autonomous/**", "tests/autonomous-assignment.ts"],
    remaining: "Live end-to-end generation needs a configured AI provider; without one the run reports blocked with that reason instead of drafting.",
    ownerAction: "Configure the AI provider key (the same one every other AI feature uses).",
  },
  {
    id: "R5",
    title: "Honest progress and honest completion",
    group: "Academic AI",
    statement: "A run's state is what the server actually did. A section exists only when its text is stored. A run completes only with every section stored and a stored verification verdict.",
    status: "IMPLEMENTED AND TESTED",
    evidence: ["canClaimCompletion() in src/lib/essay/autonomous.ts", "assertions in tests/autonomous-assignment.ts"],
    remaining: null,
    ownerAction: null,
  },
  {
    id: "R6",
    title: "Durable state, safe retries, resumable steps",
    group: "Academic AI",
    statement: "Run state lives in the database. A retry resumes instead of duplicating. A repeated callback cannot create a second artifact. A failed section never erases completed ones.",
    status: "IMPLEMENTED, LIVE VERIFICATION REQUIRED",
    evidence: ["assignment_runs: lease_token, attempts, step_index", "unique (user_id, idempotency_key) index", "step-idempotency assertions"],
    remaining: "Two workers racing on one run needs a live database to demonstrate; the lease is unit-tested, not proof against a live race.",
    ownerAction: null,
  },
  {
    id: "R7",
    title: "No invented background execution",
    group: "Academic AI",
    statement: "Sophira never claims an assignment keeps generating while the app is closed unless a real worker is running. The status view names the mode.",
    status: "IMPLEMENTED AND TESTED",
    evidence: ["continuationMode() in src/lib/essay/autonomous.ts", "docs/PRESERVATION_AUDIT_2026-11-15.md §5"],
    remaining: null,
    ownerAction: "Optional: approve a cron line or an external queue to make continuation run with the page closed.",
  },
  {
    id: "R8",
    title: "One academic context for every AI path",
    group: "Personalisation",
    statement: "New assignment paths use the shared context service: course, teacher requirements, approved preferences, memory and learning patterns, scoped and isolated per student.",
    status: "IMPLEMENTED AND TESTED",
    evidence: ["loadAcademicContext in src/lib/essay/runner.ts", "tests/academic-context.ts"],
    remaining: null,
    ownerAction: null,
  },
  {
    id: "R9",
    title: "Personalisation never overrides a teacher",
    group: "Personalisation",
    statement: "A student's habit never outranks an explicit teacher instruction, a rubric criterion or the assignment's own constraints.",
    status: "EXISTING FUNCTIONALITY PRESERVED",
    evidence: ["AUTHORITY_LINE in src/lib/ai/academic-context.ts", "pinned in tests/autonomous-assignment.ts"],
    remaining: null,
    ownerAction: null,
  },
  {
    id: "R10",
    title: "The 17 writing dimensions, approvals and history stay",
    group: "Personalisation",
    statement: "No dimension removed or simplified; suggestions stay evidence-based, scoped, approval-gated and reversible; version history preserved; the analyser works with no model configured.",
    status: "EXISTING FUNCTIONALITY PRESERVED",
    evidence: ["src/lib/ai/writing-profile-learning.ts", "profile_update_proposals", "profile_versions", "ProposalsPanel.tsx", "ProfileVersionHistory.tsx"],
    remaining: null,
    ownerAction: null,
  },
  {
    id: "R11",
    title: "Genuine document history, never manufactured authorship",
    group: "Documents",
    statement: "History reflects changes the provider actually confirmed, versions Sophira observed, or local drafts, labelled by what established them. No fabricated revision activity, no authorship claim the provider does not establish.",
    status: "PARTIALLY IMPLEMENTED",
    evidence: ["src/lib/integrations/history-labels.ts", "src/lib/integrations/gradual-insert.ts", "docs/DOCUMENT_HISTORY_DISCLOSURE.md"],
    remaining: "The completed-work library makes exports and genuine versions reachable; inline version comparison in the panel is not built yet.",
    ownerAction: null,
  },
  {
    id: "R12",
    title: "Dashboards expand, permissions do not move",
    group: "Dashboards",
    statement: "All four dashboards gain the new information while every existing block and role restriction stays. Co-Owners keep no Owner-only power.",
    status: "PARTIALLY IMPLEMENTED",
    evidence: ["/owner/requirements", "Owner autonomous monitoring (src/lib/owner/autonomous-monitor.ts)", "existing dashboard blocks untouched"],
    remaining: "Co-Owner operational queue, Tester test-case library and the student assignment centre are not built yet.",
    ownerAction: null,
  },
  {
    id: "R13",
    title: "Security and privacy are not traded for convenience",
    group: "Security",
    statement: "Every member route uses the existing guard and the user-scoped client; run records are owner-scoped under RLS; no service-role client in a member route; no key in a response or component; untrusted content stays untrusted.",
    status: "IMPLEMENTED AND TESTED",
    evidence: ["requireUser on every new route", "RLS policies in 0059", "tests/autonomous-assignment.ts security assertions", "npm run scan:secrets"],
    remaining: null,
    ownerAction: null,
  },
  {
    id: "R14",
    title: "No database change without a plan",
    group: "Security",
    statement: "New schema is additive, RLS-enabled, indexed, ordered after 0058, with updated types and the mandatory marker.",
    status: "IMPLEMENTED AND TESTED",
    evidence: ["supabase/migrations/0059_assignment_runs.sql", "scripts/migration-markers.mjs", "docs/BACKUP_INVENTORY.md"],
    remaining: null,
    ownerAction: null,
  },
  {
    id: "R15",
    title: "Verification is real",
    group: "Verification",
    statement: "The repository's own commands are run and reported, and live checks are distinguished from offline ones. A command that cannot run is stated, not claimed.",
    status: "IMPLEMENTED AND TESTED",
    evidence: ["docs/AUTONOMOUS_ASSIGNMENTS.md §9", "docs/SOPHIRA_CURRENT_STATE_2026-11-13.md §22"],
    remaining: null,
    ownerAction: null,
  },
  {
    id: "R16",
    title: "Product requirements are visible to the Owner",
    group: "Dashboards",
    statement: "The Owner can see approved, implemented, in-progress, blocked, unstarted and awaiting-approval requirements with evidence, and a change log of specification, agent, flag, permission, migration and deployment changes.",
    status: "IMPLEMENTED, LIVE VERIFICATION REQUIRED",
    evidence: ["src/lib/governance/product-spec.ts", "src/app/owner/requirements/page.tsx", "src/lib/owner/change-log.ts"],
    remaining: "The change log reads real audit rows, so it needs a signed-in Owner against the live database to display.",
    ownerAction: null,
  },
];

/* ------------------------------------------------------------------ */
/* Historical decisions that were not the Owner's                      */
/* ------------------------------------------------------------------ */

export type DecisionAuthority =
  | "owner_approved"
  | "owner_declined"
  | "historical_implementation_decision"
  | "integrity_boundary";

export interface HistoricalDecision {
  id: string;
  date: string;
  what: string;
  /** Who actually made it. Never "the product requires". */
  madeBy: string;
  authority: DecisionAuthority;
  /** Where the reasoning is preserved. */
  recordedIn: string;
  /** Reclassified on this date, with the reason, or null if never reclassified. */
  reclassified: string | null;
}

export const HISTORICAL_DECISIONS: readonly HistoricalDecision[] = [
  {
    id: "H1",
    date: "2026-10-29",
    what: "Simulated human typing (injected typos, artificial delays) and staggered partial Word drafts would not be built; the document said \"do not rebuild it\".",
    madeBy: "Automated development process",
    authority: "historical_implementation_decision",
    recordedIn: "docs/WRITING_PROFILE_LEARNING.md §What was declined, and why",
    reclassified: "2026-11-15 — the reasoning is preserved as history; the claim of permanent authority is removed. Product decisions belong to the Owner.",
  },
  {
    id: "H2",
    date: "2026-11-02",
    what: "Gradual insertion is real chunked insertion with provider-confirmed progress, not a typing simulation.",
    madeBy: "Automated development process",
    authority: "historical_implementation_decision",
    recordedIn: "src/lib/integrations/gradual-insert.ts header, docs/DOCUMENT_ACTIVITY.md",
    reclassified: "2026-11-15 — kept as an accurate description of what the feature is, not as a limit on what may be requested.",
  },
  {
    id: "H3",
    date: "2026-11-15",
    what: "Sophira does not manufacture false evidence of authorship, fabricate revision activity, conceal AI authorship, or attempt to evade plagiarism or AI-detection systems.",
    madeBy: "Owner directive 2026-11-15 (Part 1)",
    authority: "integrity_boundary",
    recordedIn: "docs/PRODUCT_REQUIREMENTS.md §4",
    reclassified: null,
  },
];

/* ------------------------------------------------------------------ */
/* Change governance categories (directive Part 7.1 D)                 */
/* ------------------------------------------------------------------ */

export const CHANGE_CATEGORIES = [
  "product_specification",
  "agent_development",
  "feature_flag",
  "permission",
  "migration",
  "deployment",
] as const;

export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number];

export const CHANGE_CATEGORY_LABELS: Record<ChangeCategory, string> = {
  product_specification: "Product specification",
  agent_development: "Agent development",
  feature_flag: "Feature flag",
  permission: "Permission",
  migration: "Database migration",
  deployment: "Deployment",
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function requirementsByStatus(status: RequirementStatus): ProductRequirement[] {
  return PRODUCT_REQUIREMENTS.filter((r) => r.status === status);
}

/** Requirements that need something only the Owner can give. */
export function ownerBlockedRequirements(): ProductRequirement[] {
  return PRODUCT_REQUIREMENTS.filter((r) => r.ownerAction !== null);
}

/** True only for a requirement carrying at least one named piece of evidence. */
export function hasEvidence(req: ProductRequirement): boolean {
  return req.evidence.length > 0 && req.evidence.every((e) => e.trim().length > 0);
}

/**
 * Is a requirement finished? Deliberately strict: "preserved" counts, "implemented with live
 * verification required" does NOT - the proof is outstanding, and saying otherwise is exactly
 * the overclaiming this document exists to stop.
 */
export function isFinished(req: ProductRequirement): boolean {
  return req.status === "IMPLEMENTED AND TESTED" || req.status === "EXISTING FUNCTIONALITY PRESERVED";
}

export function summariseRequirements(): { total: number; finished: number; outstanding: number; blocked: number } {
  const finished = PRODUCT_REQUIREMENTS.filter(isFinished).length;
  return {
    total: PRODUCT_REQUIREMENTS.length,
    finished,
    outstanding: PRODUCT_REQUIREMENTS.length - finished,
    blocked: PRODUCT_REQUIREMENTS.filter((r) => r.status === "BLOCKED").length,
  };
}

/** Historical decisions that were never the Owner's, for the dashboard's governance block. */
export function agentDecisions(): HistoricalDecision[] {
  return HISTORICAL_DECISIONS.filter((d) => d.authority === "historical_implementation_decision");
}
