/**
 * RELEASE READINESS (2026-11-11).
 *
 * The owner has one release-gate engine already (scripts/release-gate.mjs) and a System Health
 * page that translates its checks. What was missing was a single page that answers the question
 * the owner actually asks - "is the app ready to go out, and if not, what is missing?" - grouped
 * the way a release is judged: deployment, application, database, security, recovery, legal.
 *
 * This module adds NO new gate and NO new check. It reads the gate's own machine-readable
 * report (produced by `node scripts/release-gate.mjs --report --json`) and arranges the SAME
 * statuses. Three rules are enforced here, because a readiness page is exactly where an
 * optimistic lie is most damaging:
 *
 *   1. A check that did not run, or was blocked, is never counted as passed. The final word is
 *      READY only when a report exists AND every check in it passed.
 *   2. No report means UNKNOWN, never READY and never "no problems found".
 *   3. A snapshot is dated. A report older than the staleness limit is shown, but the page stops
 *      calling it current - a three-week-old green run says nothing about today's code.
 *
 * Pure: the report text, the deployment values, the database state, the backup facts and the
 * clock all come from the caller. Nothing here reads a file or a process variable.
 */

import type { GateCheck, GateStatus } from "./gate-translate";

export type ReadinessWord = "READY" | "NOT READY" | "BLOCKED" | "UNKNOWN";
export type FactState = "ready" | "not-ready" | "blocked" | "unknown";

export interface ReadinessFact {
  key: string;
  label: string;
  state: FactState;
  /** What this fact means for the release, in plain words. */
  detail: string;
  /** What the owner can do, or null when there is nothing for them to do. */
  action: string | null;
  /** Where the owner resolves it. */
  href?: string;
}

export interface ReadinessSection {
  key: "deployment" | "application" | "database" | "security" | "recovery" | "legal";
  title: string;
  /** One sentence saying what this section is about. */
  intro: string;
  facts: ReadinessFact[];
}

export interface GateSnapshot {
  generatedAt: string | null;
  /** Age in whole days, or null when the date could not be read. */
  ageDays: number | null;
  /** True when the snapshot is older than STALE_AFTER_DAYS, or undated. */
  stale: boolean;
  checks: GateCheck[];
  counts: { total: number; pass: number; fail: number; blocked: number; notRun: number };
  /** The gate's own verdict line, if the report carried one. */
  gateVerdict: "GO" | "BLOCKED" | null;
}

export interface ReadinessReport {
  verdict: ReadinessWord;
  /** The single sentence under the verdict. Never longer than two sentences. */
  summary: string;
  gate: GateSnapshot | null;
  /** Plain-language reason the report could not be used, when gate is null. */
  gateUnavailableReason: string | null;
  sections: ReadinessSection[];
  /** Required evidence that has not run, in the owner's words. */
  missing: string[];
  /** True only when every section is ready and the gate snapshot is current and fully green. */
  ready: boolean;
}

/** A gate snapshot older than this is reported as dated rather than current. */
export const STALE_AFTER_DAYS = 7;

const VALID_STATUSES: GateStatus[] = ["PASS", "FAIL", "BLOCKED", "NOT RUN"];

const SECTION_TITLES: Record<ReadinessSection["key"], { title: string; intro: string }> = {
  deployment: {
    title: "Deployment",
    intro: "Which version is published, where, and whether the publish itself succeeded.",
  },
  application: {
    title: "The application itself",
    intro: "Whether Sophira starts, answers, and passes its own tests.",
  },
  database: {
    title: "Your database",
    intro: "Whether every database update is in place and the data can be read.",
  },
  security: {
    title: "Security checks",
    intro: "The checks that prove members cannot reach each other's work, and that no secret is exposed.",
  },
  recovery: {
    title: "Backup and recovery",
    intro: "Whether your work could be restored if the database were lost.",
  },
  legal: {
    title: "Legal information",
    intro: "Whether the published legal pages still contain placeholders only you can fill in.",
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse the gate's JSON report strictly. A malformed report is not "no failures": it is
 * unreadable evidence, and the caller is told so.
 */
export function parseGateReport(raw: string | null): { snapshot: GateSnapshot | null; reason: string | null } {
  const text = (raw ?? "").trim();
  if (!text) {
    return {
      snapshot: null,
      reason:
        "No release report is stored with this deployment, so Sophira cannot say whether the release checks passed. That is unknown, not ready.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      snapshot: null,
      reason:
        "The stored release report could not be read as a report, so its checks cannot be used. Sophira will not guess what it said.",
    };
  }

  if (!isObject(parsed) || !Array.isArray(parsed.checks)) {
    return {
      snapshot: null,
      reason: "The stored release report does not contain a list of checks, so it cannot support a readiness answer.",
    };
  }

  const checks: GateCheck[] = [];
  for (const item of parsed.checks) {
    if (!isObject(item)) continue;
    const status = String(item.status ?? "").toUpperCase();
    if (!VALID_STATUSES.includes(status as GateStatus)) continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) continue;
    checks.push({
      id: typeof item.id === "number" || typeof item.id === "string" ? Number(item.id) || 0 : 0,
      name,
      status: status as GateStatus,
      detail: typeof item.detail === "string" ? item.detail.slice(0, 400) : "",
    });
  }

  if (checks.length === 0) {
    return {
      snapshot: null,
      reason: "The stored release report listed no usable checks, so it cannot support a readiness answer.",
    };
  }

  const counts = { total: checks.length, pass: 0, fail: 0, blocked: 0, notRun: 0 };
  for (const c of checks) {
    if (c.status === "PASS") counts.pass += 1;
    else if (c.status === "FAIL") counts.fail += 1;
    else if (c.status === "BLOCKED") counts.blocked += 1;
    else counts.notRun += 1;
  }

  const generatedAt = typeof parsed.generatedAt === "string" ? parsed.generatedAt : null;
  const gateVerdict =
    parsed.verdict === "GO" || parsed.verdict === "BLOCKED" ? (parsed.verdict as "GO" | "BLOCKED") : null;

  return {
    snapshot: { generatedAt, ageDays: null, stale: false, checks, counts, gateVerdict },
    reason: null,
  };
}

/** Attach the age of the snapshot to the report, using the caller's clock. */
export function dateGateSnapshot(snapshot: GateSnapshot, nowMs: number): GateSnapshot {
  if (!snapshot.generatedAt) return { ...snapshot, ageDays: null, stale: true };
  const at = new Date(snapshot.generatedAt).getTime();
  if (Number.isNaN(at)) return { ...snapshot, ageDays: null, stale: true };
  const ageDays = Math.max(0, Math.floor((nowMs - at) / 86_400_000));
  return { ...snapshot, ageDays, stale: ageDays > STALE_AFTER_DAYS };
}

function stateFor(status: GateStatus): FactState {
  if (status === "PASS") return "ready";
  if (status === "FAIL") return "not-ready";
  return "blocked";
}

function actionFor(status: GateStatus): string | null {
  if (status === "PASS") return null;
  if (status === "NOT RUN") return "This check has to be run before the release can be called ready.";
  if (status === "BLOCKED") return "Something this check needs is not set up yet. The System Health page names it.";
  return "This check ran and failed. It has to be fixed before release.";
}

function factsFromChecks(checks: GateCheck[]): ReadinessFact[] {
  return checks.map((check) => ({
    key: `check-${check.id}-${check.name}`.slice(0, 80),
    label: check.name,
    state: stateFor(check.status),
    detail: check.detail || "No detail was recorded for this check.",
    action: actionFor(check.status),
    href: "/owner/health",
  }));
}

export interface DeploymentFacts {
  /** e.g. "production" | "preview" | "development" | null when unknown. */
  environment: string | null;
  /** Short commit identifier, or null when this deployment does not expose one. */
  commit: string | null;
  /** The deployment's own address, or null. */
  url: string | null;
}

export interface DatabaseFacts {
  reachable: boolean;
  applied: number;
  pending: number;
}

export interface BackupFacts {
  reported: boolean;
  recoverable: boolean;
  lastRunAt: string | null;
  lastVerifiedAt: string | null;
  lastRestoreTestAt: string | null;
}

export interface ReadinessInput {
  gateReportText: string | null;
  deployment: DeploymentFacts;
  database: DatabaseFacts | null;
  backup: BackupFacts | null;
  /** True while the legal documents still contain owner-supplied placeholders; null when unread. */
  legalIncomplete: boolean | null;
  now?: number;
}

function deploymentSection(deployment: DeploymentFacts, snapshot: GateSnapshot | null): ReadinessSection {
  const facts: ReadinessFact[] = [];

  facts.push({
    key: "deployment-environment",
    label: "Where this is running",
    state: deployment.environment ? "ready" : "unknown",
    detail: deployment.environment
      ? `This copy is running as ${deployment.environment}.`
      : "This copy does not say which environment it is. That is a gap in the deployment's own information, not a fault in Sophira.",
    action: deployment.environment ? null : "Nothing for you to do; the hosting provider records this automatically.",
  });

  facts.push({
    key: "deployment-commit",
    label: "Published version",
    state: deployment.commit ? "ready" : "unknown",
    detail: deployment.commit
      ? `The published version is ${deployment.commit}.`
      : "This deployment does not carry a version identifier, so it cannot be tied to an exact version.",
    action: null,
  });

  facts.push({
    key: "deployment-address",
    label: "Web address",
    state: deployment.url ? "ready" : "unknown",
    detail: deployment.url
      ? "Sophira knows its own web address, so links in emails and invitations point at the right place."
      : "Sophira does not know its own web address here, so an invitation link could point at the wrong place.",
    action: deployment.url ? null : "Set the app URL in your hosting settings (System Health names the exact setting).",
    href: "/owner/health",
  });

  if (snapshot) {
    const deployChecks = snapshot.checks.filter((c) => /deploy|release|version/i.test(c.name + " " + c.detail));
    facts.push(...factsFromChecks(deployChecks));
  } else {
    facts.push({
      key: "deployment-unverified",
      label: "Whether this deployment works",
      state: "unknown",
      detail: "Without a stored release report, Sophira cannot say from here whether the published copy passed its checks.",
      action: "Run the release checks from the project's normal release process; the report is stored automatically.",
      href: "/owner/health",
    });
  }

  return { key: "deployment", ...SECTION_TITLES.deployment, facts };
}

function applicationSection(snapshot: GateSnapshot | null): ReadinessSection {
  const facts: ReadinessFact[] = [];
  if (!snapshot) {
    facts.push({
      key: "application-unverified",
      label: "Application checks",
      state: "unknown",
      detail: "No release report is stored, so the application's own checks cannot be reported.",
      action: "Run the release checks; every result is then shown here.",
      href: "/owner/health",
    });
  } else {
    const appChecks = snapshot.checks.filter((c) => /test|suite|build|smoke|health|search|ai |device|native/i.test(c.name));
    const chosen = appChecks.length > 0 ? appChecks : snapshot.checks;
    facts.push(...factsFromChecks(chosen));
  }
  return { key: "application", ...SECTION_TITLES.application, facts };
}

function databaseSection(database: DatabaseFacts | null, snapshot: GateSnapshot | null): ReadinessSection {
  const facts: ReadinessFact[] = [];

  if (!database) {
    facts.push({
      key: "database-unknown",
      label: "Your database",
      state: "unknown",
      detail: "Sophira could not check your database from here, so it will not claim the updates are in place.",
      action: "Open Database updates and press the check button; it reads the live database directly.",
      href: "/owner/database",
    });
  } else if (!database.reachable) {
    facts.push({
      key: "database-unreachable",
      label: "Your database",
      state: "blocked",
      detail: "Sophira could not reach your database, so nothing about its state can be confirmed.",
      action: "Open Database updates; it will retry and say whether the database is reachable.",
      href: "/owner/database",
    });
  } else if (database.pending > 0) {
    facts.push({
      key: "database-pending",
      label: "Database updates",
      state: "blocked",
      detail: `${database.pending} database ${database.pending === 1 ? "update is" : "updates are"} not applied yet, so some abilities are missing. Nothing has been lost: updates only add things.`,
      action: "Open Database updates and press the update button. It is safe to run more than once.",
      href: "/owner/database",
    });
  } else {
    facts.push({
      key: "database-current",
      label: "Database updates",
      state: "ready",
      detail: `Every database update is in place (${database.applied} applied).`,
      action: null,
      href: "/owner/database",
    });
  }

  if (snapshot) {
    const dbChecks = snapshot.checks.filter((c) => /database|migration|schema|postgres|supabase/i.test(c.name + " " + c.detail));
    facts.push(...factsFromChecks(dbChecks));
  }

  return { key: "database", ...SECTION_TITLES.database, facts };
}

function securitySection(snapshot: GateSnapshot | null): ReadinessSection {
  const facts: ReadinessFact[] = [];
  if (!snapshot) {
    facts.push({
      key: "security-unverified",
      label: "Security checks",
      state: "unknown",
      detail: "No security result is stored with this deployment, so none is displayed. That is not the same as passing.",
      action: "Run the release checks; the security results appear here afterwards.",
      href: "/owner/health",
    });
  } else {
    const securityChecks = snapshot.checks.filter((c) =>
      /security|secret|codeql|dependabot|invitation|signup|isolation|audit|permission|rls|privacy/i.test(c.name + " " + c.detail),
    );
    if (securityChecks.length === 0) {
      facts.push({
        key: "security-none",
        label: "Security checks",
        state: "unknown",
        detail: "The stored release report contains no security check, so Sophira has no security result to show.",
        action: "Nothing to do from here; this is a gap in the report, not a passed check.",
      });
    } else {
      facts.push(...factsFromChecks(securityChecks));
      const notRun = securityChecks.filter((c) => c.status === "NOT RUN").length;
      const blocked = securityChecks.filter((c) => c.status === "BLOCKED").length;
      if (notRun > 0 || blocked > 0) {
        facts.push({
          key: "security-incomplete",
          label: "Security checks that have not proved anything",
          state: "blocked",
          detail: `${blocked} security ${blocked === 1 ? "check is" : "checks are"} waiting on a missing prerequisite and ${notRun} ${notRun === 1 ? "has" : "have"} not run. Neither is a pass.`,
          action: "The System Health page names what each one needs.",
          href: "/owner/health",
        });
      }
    }
  }
  return { key: "security", ...SECTION_TITLES.security, facts };
}

function recoverySection(backup: BackupFacts | null): ReadinessSection {
  const facts: ReadinessFact[] = [];
  if (!backup) {
    facts.push({
      key: "recovery-unknown",
      label: "Backup and recovery",
      state: "unknown",
      detail: "Sophira could not read the backup picture, so it will not say whether you could recover.",
      action: "Open Backup and recovery; it explains the one command that takes a backup.",
      href: "/owner/backup",
    });
    return { key: "recovery", ...SECTION_TITLES.recovery, facts };
  }

  facts.push({
    key: "backup-reported",
    label: "A backup has been reported",
    state: backup.reported ? "ready" : "unknown",
    detail: backup.reported
      ? "Sophira has seen a backup report, so it knows a backup exists."
      : "No backup report has reached Sophira, so it cannot say a backup exists. That is unknown, not protected.",
    action: backup.reported ? null : "Run the backup from the Backup page's instructions; it writes the report Sophira reads.",
    href: "/owner/backup",
  });

  facts.push({
    key: "backup-verified",
    label: "The backup was checked",
    state: backup.lastVerifiedAt ? "ready" : "unknown",
    detail: backup.lastVerifiedAt
      ? "The saved backup's checksums were re-checked."
      : "No saved backup has been re-checked yet, so its integrity is unproven.",
    action: backup.lastVerifiedAt ? null : "Run the verify step on the Backup page.",
    href: "/owner/backup",
  });

  facts.push({
    key: "restore-rehearsal",
    label: "A restore has been rehearsed",
    state: backup.lastRestoreTestAt ? "ready" : "blocked",
    detail: backup.lastRestoreTestAt
      ? "A backup was restored somewhere that is not production, which is the only real proof that recovery works."
      : "A backup has never been restored in a test, so recovery is unproven even if the backup exists.",
    action: backup.lastRestoreTestAt ? null : "Follow the restore rehearsal steps on the Backup page, in a separate test copy.",
    href: "/owner/backup",
  });

  facts.push({
    key: "recovery-verdict",
    label: "Could your work be recovered tonight?",
    state: backup.recoverable ? "ready" : "blocked",
    detail: backup.recoverable
      ? "A recent backup exists, it was checked, and a restore has been rehearsed."
      : "Not guaranteed yet: at least one of a recent backup, a checked backup, or a rehearsed restore is missing.",
    action: backup.recoverable ? null : "The Backup page lists the exact remaining steps in order.",
    href: "/owner/backup",
  });

  return { key: "recovery", ...SECTION_TITLES.recovery, facts };
}

function legalSection(legalIncomplete: boolean | null): ReadinessSection {
  const facts: ReadinessFact[] = [];
  if (legalIncomplete === null) {
    facts.push({
      key: "legal-unknown",
      label: "Legal pages",
      state: "unknown",
      detail: "Sophira could not read the legal pages here, so it will not claim they are complete.",
      action: "Open the status page; it reads the published documents.",
      href: "/owner/status",
    });
  } else if (legalIncomplete) {
    facts.push({
      key: "legal-placeholders",
      label: "Legal pages",
      state: "not-ready",
      detail:
        "The Terms and Privacy pages still contain placeholders where your own details belong. Members can read them, but they are not yet yours.",
      action: "Fill in the owner facts and have the wording reviewed before inviting people outside your household.",
      href: "/owner/status",
    });
  } else {
    facts.push({
      key: "legal-complete",
      label: "Legal pages",
      state: "ready",
      detail:
        "No placeholders remain in the published legal pages. A professional review is still recommended and cannot be automated.",
      action: null,
      href: "/owner/status",
    });
  }
  return { key: "legal", ...SECTION_TITLES.legal, facts };
}

/**
 * A cheap release word for the overview, from the stored report alone.
 *
 * The dashboard must not spin up database connections to answer a banner, so this uses only the
 * gate report. Null means "no usable report", and the overview then says nothing about release
 * readiness rather than inventing a state.
 */
export function quickReleaseWord(
  raw: string | null,
  now: number = Date.now(),
): { word: "READY" | "NOT READY" | "BLOCKED" | "UNKNOWN" | null; snapshot: GateSnapshot | null } {
  const { snapshot } = parseGateReport(raw);
  if (!snapshot) return { word: null, snapshot: null };
  const dated = dateGateSnapshot(snapshot, now);
  if (dated.counts.fail > 0) return { word: "NOT READY", snapshot: dated };
  if (dated.counts.blocked > 0 || dated.counts.notRun > 0 || dated.stale) return { word: "BLOCKED", snapshot: dated };
  return { word: "READY", snapshot: dated };
}

/** Security-related checks that have not run, from a stored report. Null when there is no report. */
export function securityNotRunCount(snapshot: GateSnapshot | null): number | null {
  if (!snapshot) return null;
  return snapshot.checks.filter(
    (c) =>
      c.status === "NOT RUN" &&
      /security|secret|codeql|dependabot|invitation|signup|isolation|audit|permission|rls|privacy/i.test(
        c.name + " " + c.detail,
      ),
  ).length;
}

/**
 * The final word. READY requires a current, fully green report AND no section in a failing
 * state. Anything else is named precisely:
 *   - FAIL -> NOT READY
 *   - BLOCKED / NOT RUN -> BLOCKED
 *   - no usable report -> UNKNOWN
 */
export function buildReadinessReport(input: ReadinessInput): ReadinessReport {
  const now = input.now ?? Date.now();
  const { snapshot: rawSnapshot, reason } = parseGateReport(input.gateReportText);
  const gate = rawSnapshot ? dateGateSnapshot(rawSnapshot, now) : null;

  const sections: ReadinessSection[] = [
    deploymentSection(input.deployment, gate),
    applicationSection(gate),
    databaseSection(input.database, gate),
    securitySection(gate),
    recoverySection(input.backup),
    legalSection(input.legalIncomplete),
  ];

  const missing: string[] = [];
  if (!gate) {
    missing.push("The release checks have not been run and stored for this deployment.");
  } else {
    for (const check of gate.checks) {
      if (check.status === "NOT RUN") missing.push(`${check.name} has not been run.`);
      else if (check.status === "BLOCKED") missing.push(`${check.name} is waiting on something that is not set up.`);
    }
    if (gate.stale) {
      missing.push(
        gate.ageDays === null
          ? "The stored release report is undated, so it cannot be shown to describe the current version."
          : `The stored release report is ${gate.ageDays} days old, so it does not describe the current version.`,
      );
    }
  }
  if (input.database && (!input.database.reachable || input.database.pending > 0)) {
    missing.push("Your database has updates that are not applied yet.");
  }
  if (!input.backup || !input.backup.recoverable) {
    missing.push("Recovery is not proven yet (a recent backup, a checked backup and a rehearsed restore).");
  }

  const anyNotReady = sections.some((s) => s.facts.some((f) => f.state === "not-ready"));
  const anyBlocked = sections.some((s) => s.facts.some((f) => f.state === "blocked"));
  const gateGreen =
    gate !== null && gate.counts.fail === 0 && gate.counts.blocked === 0 && gate.counts.notRun === 0 && !gate.stale;

  let verdict: ReadinessWord;
  let summary: string;

  if (!gate) {
    verdict = "UNKNOWN";
    summary =
      "Sophira has no stored release result for this deployment, so it cannot say the app is ready. Nothing here is a pass by default.";
  } else if (gate.counts.fail > 0 || anyNotReady) {
    verdict = "NOT READY";
    summary = `${gate.counts.fail} release ${gate.counts.fail === 1 ? "check failed" : "checks failed"}. A release cannot go out until that is fixed.`;
  } else if (gate.counts.blocked > 0 || gate.counts.notRun > 0 || gate.stale || anyBlocked) {
    verdict = "BLOCKED";
    summary = gate.stale
      ? "The stored release result is out of date, so it cannot vouch for the current version."
      : `${gate.counts.blocked} ${gate.counts.blocked === 1 ? "check is" : "checks are"} waiting on a missing prerequisite and ${gate.counts.notRun} ${gate.counts.notRun === 1 ? "has" : "have"} not run. Neither is a pass.`;
  } else if (gateGreen) {
    verdict = "READY";
    summary = `All ${gate.counts.total} release checks passed in a run dated ${
      gate.generatedAt ? gate.generatedAt.slice(0, 10) : "unknown"
    }. This is a technical result, not a guarantee of legal compliance.`;
  } else {
    verdict = "BLOCKED";
    summary = "A required part of the picture is missing, so readiness cannot be confirmed.";
  }

  // READY additionally requires the live sections to agree. A green gate plus an un-applied
  // database update is not ready, and the page must not let the older green report win.
  const ready = verdict === "READY" && !anyNotReady && !anyBlocked;
  if (verdict === "READY" && !ready) {
    verdict = "BLOCKED";
    summary = "The stored release checks passed, but something they cannot see is still outstanding. The sections below say what.";
  }

  return { verdict, summary, gate, gateUnavailableReason: reason, sections, missing, ready };
}
