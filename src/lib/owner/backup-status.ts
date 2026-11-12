/**
 * BACKUP AND RECOVERY, TOLD HONESTLY (2026-11-13).
 *
 * The owner needed one page that answers "if the database vanished tonight, could we get it
 * back?" Sophira has backup tooling (scripts/backup-sophira.mjs, the derived inventory in
 * lib/backup/inventory.ts, and the manifest rules that refuse a false "ok"), but tooling is not
 * a backup, a backup is not a verified backup, and a verified backup is not a tested restore.
 *
 * Those are FIVE different facts and this module keeps them apart:
 *
 *   1. tooling     - Sophira can take a backup at all
 *   2. configured  - the backup has what it needs (database + storage access)
 *   3. completed   - a backup actually ran, with a date
 *   4. verified    - the saved manifest's checksums were re-checked
 *   5. restore     - a restore was rehearsed somewhere that is NOT production
 *
 * Sophira cannot take a backup from a web page: the job runs on the owner's machine or a
 * scheduler with database credentials. So this page reads a REPORT that the backup writes, and
 * if no report has arrived it says exactly that. "We have never seen a backup" and "the last
 * backup was fine" must never look alike, and a missing report is never rendered as success.
 *
 * Pure: parsing, classification and wording only. No files read here, no clock invented.
 */

export type StepState = "done" | "not-done" | "failed" | "blocked" | "unknown";

export interface BackupStep {
  key: "tooling" | "configured" | "completed" | "verified" | "restore";
  label: string;
  state: StepState;
  /** One plain sentence: what this step means and what the state says about it. */
  detail: string;
}

export interface BackupReportInput {
  /** Raw report text (the JSON the backup writes), or null when there is no report. */
  raw: string | null;
  /** Why there is no report, when Sophira knows (a missing file, an unreadable deployment). */
  unavailableReason?: string | null;
  /** The coverage summary derived from the migration inventory, when it could be read. */
  coverage?: { tables: number; buckets: number; missing: string[] } | null;
}

export interface BackupReport {
  /** True only when a real report was parsed. */
  reported: boolean;
  /** ISO date of the last SUCCESSFUL backup run, or null when none is recorded. */
  lastRunAt: string | null;
  /** ISO date the saved manifest was last re-checked, or null. */
  lastVerifiedAt: string | null;
  /** ISO date of the last restore rehearsal, or null. */
  lastRestoreTestAt: string | null;
  /** The single sentence at the top of the page. */
  headline: string;
  /** True only when all five steps are done - the one condition for calling backups recom-
   *  mendable. Anything less is reported as an open item, never softened. */
  recoverable: boolean;
  steps: BackupStep[];
  coverage: { tables: number; buckets: number; missing: string[] } | null;
  /** What the owner should do next, in order. Empty when nothing is outstanding. */
  nextActions: string[];
  /** Anything in the report Sophira refused to trust, in plain language. */
  ignored: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** A date we will print. Anything else is treated as absent rather than guessed. */
function readDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed)) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function daysBetween(fromIso: string, nowIso: string): number | null {
  const from = new Date(fromIso).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(now)) return null;
  return Math.floor((now - from) / 86_400_000);
}

/** A backup older than this is not "current", whatever the report says. */
export const STALE_AFTER_DAYS = 8;
/** A restore rehearsal older than this no longer proves the current system restores. */
export const RESTORE_STALE_AFTER_DAYS = 180;

export function formatDay(iso: string | null): string {
  if (!iso) return "Never recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never recorded";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function baseSteps(): BackupStep[] {
  return [
    {
      key: "tooling",
      label: "Sophira can take a backup",
      state: "done",
      detail:
        "The backup tool is part of Sophira and is kept in step with the database automatically: a new table is added to its scope by the same change that creates it.",
    },
    {
      key: "configured",
      label: "The backup has what it needs",
      state: "unknown",
      detail: "Whether the backup can reach your database and your uploaded files is recorded in the backup report.",
    },
    {
      key: "completed",
      label: "A backup has actually run",
      state: "not-done",
      detail: "No successful backup has been reported to Sophira.",
    },
    {
      key: "verified",
      label: "The saved backup was checked",
      state: "not-done",
      detail: "A backup is only trustworthy once its contents have been re-checked against its own checksums.",
    },
    {
      key: "restore",
      label: "A restore has been rehearsed",
      state: "not-done",
      detail:
        "Rehearsing a restore somewhere that is not your live system is the only proof that a backup can bring Sophira back. Sophira never rehearses against your live database.",
    },
  ];
}

/**
 * Turn a backup report into the five-step picture.
 *
 * The report is data, not instructions: only known fields are read, every date is validated, and
 * anything unexpected is listed in `ignored` rather than trusted.
 */
export function buildBackupReport(input: BackupReportInput, nowIso: string = new Date().toISOString()): BackupReport {
  const steps = baseSteps();
  const ignored: string[] = [];
  const coverage = input.coverage ?? null;

  let reported = false;
  let lastRunAt: string | null = null;
  let lastVerifiedAt: string | null = null;
  let lastRestoreTestAt: string | null = null;
  let reportedFailure: string | null = null;

  if (input.raw) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(input.raw);
    } catch {
      ignored.push("The backup report could not be read as a report, so none of it is being trusted.");
    }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      reported = true;
      lastRunAt = readDate(record.last_run_at ?? record.completed_at ?? record.run_at);
      lastVerifiedAt = readDate(record.last_verified_at ?? record.verified_at);
      lastRestoreTestAt = readDate(record.restore_tested_at ?? record.restore_drill_at);
      if (typeof record.error === "string" && record.error.trim()) reportedFailure = record.error.trim();
      // A report that claims a date Sophira cannot read is not a date.
      for (const key of ["last_run_at", "last_verified_at", "restore_tested_at"]) {
        if (key in record && record[key] && !readDate(record[key])) {
          ignored.push(`The report's "${key.replace(/_/g, " ")}" was not a date Sophira recognises, so it is treated as missing.`);
        }
      }
    }
  }

  const set = (key: BackupStep["key"], state: StepState, detail: string) => {
    const step = steps.find((s) => s.key === key)!;
    step.state = state;
    step.detail = detail;
  };

  if (reportedFailure) {
    set("completed", "failed", `The last backup did not finish: ${reportedFailure}. Nothing from that run should be relied on.`);
  }

  if (lastRunAt) {
    const age = daysBetween(lastRunAt, nowIso);
    if (age !== null && age > STALE_AFTER_DAYS) {
      set(
        "completed",
        "failed",
        `The newest successful backup Sophira knows about is ${age} days old, which is not current. Treat the network as unprotected until a new backup runs.`,
      );
    } else if (!reportedFailure) {
      // A recorded failure outranks a recent date: the run said it did not finish, so a
      // timestamp alone must never turn it into a success.
      set("completed", "done", `A backup completed on ${formatDay(lastRunAt)}.`);
    }
    set("configured", "done", "The backup that ran could reach the database and the uploaded files it was asked to protect.");
  } else if (!input.raw) {
    set(
      "completed",
      "not-done",
      input.unavailableReason
        ? `No backup report could be read (${input.unavailableReason}), so Sophira cannot confirm any backup exists.`
        : "No backup has reported to Sophira. This is not a failure and not a success: it is simply unknown.",
    );
  } else {
    set("completed", "not-done", "The report does not record a completed backup.");
  }

  if (lastVerifiedAt) {
    const age = daysBetween(lastVerifiedAt, nowIso);
    if (age !== null && age > STALE_AFTER_DAYS) {
      set("verified", "blocked", `The last check of a saved backup was ${age} days old, so it no longer describes the current backup.`);
    } else {
      set("verified", "done", `The saved backup's contents were re-checked against its checksums on ${formatDay(lastVerifiedAt)}.`);
    }
  } else {
    set("verified", "not-done", "No backup has been re-checked against its own checksums, so its completeness is unproven.");
  }

  if (lastRestoreTestAt) {
    const age = daysBetween(lastRestoreTestAt, nowIso);
    if (age !== null && age > RESTORE_STALE_AFTER_DAYS) {
      set(
        "restore",
        "blocked",
        `The last restore rehearsal was ${age} days ago, which predates too many changes to prove today's system restores.`,
      );
    } else {
      set("restore", "done", `A restore was rehearsed away from your live system on ${formatDay(lastRestoreTestAt)}.`);
    }
  } else {
    set("restore", "not-done", "No restore has been rehearsed, so recovery is untested even if a backup exists.");
  }

  if (coverage && coverage.missing.length > 0) {
    set(
      "tooling",
      "failed",
      `The backup's scope is missing ${coverage.missing.length} ${coverage.missing.length === 1 ? "table" : "tables"} that Sophira stores member data in. Those would not be protected.`,
    );
  }

  const done = steps.filter((s) => s.state === "done").length;
  const recoverable = steps.every((s) => s.state === "done");

  const nextActions: string[] = [];
  if (steps.find((s) => s.key === "completed")?.state !== "done") {
    nextActions.push("Take a backup from the machine that holds your database details, then let Sophira read its report.");
  }
  if (steps.find((s) => s.key === "verified")?.state !== "done") {
    nextActions.push("Re-check the saved backup so Sophira can confirm it is complete.");
  }
  if (steps.find((s) => s.key === "restore")?.state !== "done") {
    nextActions.push("Rehearse a restore in a separate, empty database so recovery is proven before it is needed.");
  }
  if (coverage && coverage.missing.length > 0) {
    nextActions.push("Add the missing tables to the backup scope, then run the backup again.");
  }

  const headline = !reported
    ? "Sophira has no backup report, so it cannot tell you whether your network is protected tonight."
    : recoverable
      ? `Backups are current and a restore has been rehearsed. Latest backup: ${formatDay(lastRunAt)}.`
      : `Backups are not fully proven yet. ${done} of ${steps.length} steps are done.`;

  return {
    reported,
    lastRunAt,
    lastVerifiedAt,
    lastRestoreTestAt,
    headline,
    recoverable,
    steps,
    coverage,
    nextActions,
    ignored,
  };
}

/** Where the backup report is expected, and how it gets there - one source of truth. */
export const BACKUP_REPORT_ENV = "SOPHIRA_BACKUP_REPORT";

export function readBackupReport(env: NodeJS.ProcessEnv = process.env): BackupReportInput {
  const raw = (env[BACKUP_REPORT_ENV] ?? "").trim();
  if (!raw) {
    return {
      raw: null,
      unavailableReason: "no backup report has been provided to this deployment",
    };
  }
  return { raw };
}
