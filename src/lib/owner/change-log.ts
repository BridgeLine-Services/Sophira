/**
 * CHANGE GOVERNANCE LOG (2026-11-15, directive Part 7.1 D).
 *
 * The directive asks for a record of product-specification, agent-development, feature-flag,
 * permission, migration and deployment changes. This module is the DATA for that record: typed
 * entries with a date, a category, and the evidence a reader can check. It adds no new source of
 * truth — it assembles what the repository already asserts, so nothing here can quietly disagree
 * with the code.
 *
 * What it deliberately does not do: invent entries. An entry exists because a dated event
 * happened in this repository, and its `evidence` names where to verify it. A category with no
 * events says so rather than looking empty-and-fine.
 *
 * PURE: no database, no network, no clock.
 */
import { CHANGE_CATEGORIES, type ChangeCategory } from "@/lib/governance/product-spec";

export interface ChangeEntry {
  date: string;
  category: ChangeCategory;
  title: string;
  /** What changed, in plain language. */
  detail: string;
  /** Where a reader can verify it. */
  evidence: readonly string[];
  /** Who decided: the Owner, or an implementation decision inside a directive. */
  decidedBy: string;
}

export const CHANGE_ENTRIES: readonly ChangeEntry[] = [
  {
    date: "2026-11-15",
    category: "product_specification",
    title: "The Owner's specification became the authoritative document",
    detail: "docs/PRODUCT_REQUIREMENTS.md was created and named as the source of truth. A historical decline recorded in 2026-10-29 was reclassified as an implementation decision, not an Owner decision, with its reasoning preserved.",
    evidence: ["docs/PRODUCT_REQUIREMENTS.md", "docs/WRITING_PROFILE_LEARNING.md", "src/lib/governance/product-spec.ts"],
    decidedBy: "Owner directive of 2026-11-15",
  },
  {
    date: "2026-11-15",
    category: "agent_development",
    title: "Autonomous assignment mode added beside the manual workflow",
    detail: "A new mode carries an assignment through plan, draft, audit and verification without a per-section request. The manual workflow and its outline gate are unchanged.",
    evidence: ["src/lib/essay/autonomous.ts", "src/lib/essay/runner.ts", "src/app/api/essay/autonomous/", "tests/autonomous-assignment.ts"],
    decidedBy: "Owner directive of 2026-11-15 (Part 4)",
  },
  {
    date: "2026-11-15",
    category: "feature_flag",
    title: "SOPHIRA_AUTONOMOUS_ESSAY added, default off",
    detail: "The first feature switch in the repository. Unset means off; the manual workflow is not behind any flag.",
    evidence: ["src/lib/features/flags.ts", "docs/AUTONOMOUS_ASSIGNMENTS.md"],
    decidedBy: "Owner directive of 2026-11-15 (Part 2.4)",
  },
  {
    date: "2026-11-15",
    category: "migration",
    title: "Migration 0059 adds public.assignment_runs",
    detail: "Additive table with row level security, per-owner policies, a worker lease and a unique index that prevents a second live run for the same request. Migrations 0001-0058 are untouched.",
    evidence: ["supabase/migrations/0059_assignment_runs.sql", "scripts/migration-markers.mjs", "docs/BACKUP_INVENTORY.md"],
    decidedBy: "Owner directive of 2026-11-15 (Part 6)",
  },
  {
    date: "2026-11-15",
    category: "agent_development",
    title: "The Owner can read the requirement record in the app, not only in a file",
    detail: "A new Owner screen renders every requirement with its status, where it can be checked, what is still missing and what waits on the Owner, beside the dated change record. It reads the same data the test suite pins, so the screen and the evidence cannot drift apart.",
    evidence: ["src/app/owner/requirements/page.tsx", "src/lib/navigation/owner-nav.ts", "tests/autonomous-assignment.ts"],
    decidedBy: "Owner directive of 2026-11-15 (Parts 13 and 15)",
  },
  {
    date: "2026-11-15",
    category: "agent_development",
    title: "A finished assignment can leave as a file the student owns",
    detail: "A completed run now downloads as markdown or plain text, carrying its own provenance block: the sources used, what the final check actually said, and every limitation recorded. An unfinished run is refused with the reason instead of arriving named like a finished document.",
    evidence: ["src/lib/essay/export.ts", "src/app/api/essay/autonomous/[id]/export/route.ts", "tests/autonomous-assignment.ts"],
    decidedBy: "Owner directive of 2026-11-15 (Part 7)",
  },
  {
    date: "2026-11-15",
    category: "deployment",
    title: "Production has served every pushed commit, and is checked rather than assumed",
    detail: "The app reports the commit it is running, so a push is never mistaken for a deployment. Production currently serves the same commit as master, and the scheduled sweep now fails its own run when production is unreachable instead of reporting a quiet success.",
    evidence: ["https://sophira.vercel.app/api/health", ".github/workflows/autonomous-sweep.yml", "scripts/production-verification.mjs"],
    decidedBy: "Owner directive of 2026-11-15 (Part 13)",
  },
  {
    date: "2026-11-15",
    category: "permission",
    title: "No permission was widened",
    detail: "Every new member route uses the existing authentication guard and the user-scoped database client. The one privileged caller is the scheduled sweep, which authenticates with its own bearer secret before it can reach the database, and it acts as the run's own owner.",
    evidence: ["src/app/api/essay/autonomous/tick/route.ts", "tests/data-preservation.ts", "tests/autonomous-assignment.ts"],
    decidedBy: "Owner directive of 2026-11-15 (Part 9)",
  },
];

/** Newest first, and stable for equal dates. */
export function recentChanges(limit = 20): ChangeEntry[] {
  return [...CHANGE_ENTRIES]
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (a.entry.date === b.entry.date ? b.index - a.index : a.entry.date < b.entry.date ? 1 : -1))
    .slice(0, Math.max(1, limit))
    .map((wrapped) => wrapped.entry);
}

export function changesIn(category: ChangeCategory): ChangeEntry[] {
  return CHANGE_ENTRIES.filter((e) => e.category === category);
}

/**
 * Which categories have no recorded change yet. Shown to the Owner as "nothing recorded",
 * which is different from "nothing changed" — and the label says which.
 */
export function silentCategories(): ChangeCategory[] {
  return CHANGE_CATEGORIES.filter((c) => changesIn(c).length === 0);
}

export function changeSummary(): { total: number; categories: number; silent: number } {
  return {
    total: CHANGE_ENTRIES.length,
    categories: new Set(CHANGE_ENTRIES.map((e) => e.category)).size,
    silent: silentCategories().length,
  };
}
