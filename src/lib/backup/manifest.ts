import { createHash } from "crypto";

/**
 * BACKUP MANIFEST AND INTEGRITY RULES (Stage 1, 2026-11-03).
 *
 * A backup is only useful if it is COMPLETE, and a backup system is only trustworthy if
 * it says "incomplete" out loud. Everything here is built around one rule:
 *
 *   `ok` is true only when every REQUIRED component reports `pass`.
 *
 * There is no path by which a missing storage archive, an unverified checksum, or a
 * skipped component produces a green result. Blocked and not-run are distinct from fail
 * because they need different owner action, but neither one counts as success.
 */

export type ComponentStatus = "pass" | "fail" | "blocked" | "not_run";

export interface BackupComponent {
  key: string;
  /** Plain-language name shown to the owner, e.g. "Uploaded files". */
  label: string;
  required: boolean;
  status: ComponentStatus;
  /** Plain-language explanation. Never a stack trace, never a credential. */
  detail?: string;
}

export interface StorageObjectFact {
  bucket: string;
  path: string;
  bytes: number;
  sha256: string;
}

export interface BackupObjectIndex {
  bucket: string;
  count: number;
  bytes: number;
  /** SHA-256 of the sorted path:checksum listing (a checksum index, not the files). */
  indexSha256: string;
}

export interface BackupManifest {
  version: 1;
  id: string;
  createdAt: string;
  appCommit: string | null;
  schemaVersion: string | null;
  components: BackupComponent[];
  objects: BackupObjectIndex[];
  objectCount: number;
  objectBytes: number;
  /** Objects whose copied checksum did not match the source. */
  checksumMismatches: string[];
  warnings: string[];
  ok: boolean;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Builds the checksum index for a set of copied objects.
 *
 * Sorting before hashing makes the result independent of listing order, so two backups
 * of unchanged files produce the same index. That is what lets a later verification say
 * "these are the same files" rather than "there are the same number of files".
 */
export function objectIndex(objects: readonly StorageObjectFact[]): BackupObjectIndex[] {
  const byBucket = new Map<string, StorageObjectFact[]>();
  for (const o of objects) {
    const list = byBucket.get(o.bucket) ?? [];
    list.push(o);
    byBucket.set(o.bucket, list);
  }
  return [...byBucket.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, list]) => {
      const sorted = [...list].sort((a, b) => a.path.localeCompare(b.path));
      const material = sorted.map((o) => `${o.path}:${o.sha256}:${o.bytes}`).join("\n");
      return {
        bucket,
        count: sorted.length,
        bytes: sorted.reduce((sum, o) => sum + (Number.isFinite(o.bytes) ? o.bytes : 0), 0),
        indexSha256: sha256Hex(material),
      };
    });
}

export interface BuildInput {
  id: string;
  createdAt: string;
  appCommit?: string | null;
  schemaVersion?: string | null;
  components: BackupComponent[];
  objects: readonly StorageObjectFact[];
  /** Objects that failed their checksum comparison. Any entry fails the backup. */
  checksumMismatches?: readonly string[];
  warnings?: readonly string[];
}

export function buildManifest(input: BuildInput): BackupManifest {
  const indexes = objectIndex(input.objects);
  const mismatches = [...(input.checksumMismatches ?? [])];
  const objectCount = input.objects.length;

  const components = input.components.map((c) => ({ ...c }));
  // A storage component that claims success while a checksum failed is a lie; correct it
  // here rather than trusting the caller.
  if (mismatches.length > 0) {
    for (const c of components) {
      if (c.key === "storage" && c.status === "pass") {
        c.status = "fail";
        c.detail = "Some uploaded files did not match after copying.";
      }
    }
  }
  // Claiming files were protected when the copy found none is also a fail, not a pass.
  for (const c of components) {
    if (c.key === "storage" && c.status === "pass" && objectCount === 0) {
      c.status = "fail";
      c.detail = "No uploaded files were found, so file protection cannot be confirmed.";
    }
  }

  const ok = components.filter((c) => c.required).every((c) => c.status === "pass");

  return {
    version: 1,
    id: input.id,
    createdAt: input.createdAt,
    appCommit: input.appCommit ?? null,
    schemaVersion: input.schemaVersion ?? null,
    components,
    objects: indexes,
    objectCount,
    objectBytes: indexes.reduce((sum, i) => sum + i.bytes, 0),
    checksumMismatches: mismatches,
    warnings: [...(input.warnings ?? [])],
    ok,
  };
}

/** Credentials and tokens that must never appear inside a manifest, log or report. */
const SECRET_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
  /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/i, // database URL with a password
  /\b(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|sbp_[a-f0-9]{20,})\b/,
  /service_role[_-]?key\s*[:=]\s*\S{8,}/i,
];

export function looksSecret(value: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(value));
}

export interface ManifestValidation {
  ok: boolean;
  problems: string[];
}

/**
 * Re-validates a manifest that came from disk or another machine.
 *
 * Deliberately independent of how it was built: a manifest is untrusted input, and an
 * archive can be edited. This reports problems instead of throwing, because the owner
 * needs a sentence, not an exception.
 */
export function validateManifest(raw: unknown): ManifestValidation {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { ok: false, problems: ["The backup summary could not be read."] };
  }
  const m = raw as Partial<BackupManifest>;

  if (m.version !== 1) problems.push("This backup was made by a different version of Sophira and cannot be verified here.");
  if (!m.id || typeof m.id !== "string") problems.push("The backup has no identifier.");
  if (!m.createdAt || Number.isNaN(Date.parse(String(m.createdAt)))) problems.push("The backup has no valid creation date.");
  if (!Array.isArray(m.components) || m.components.length === 0) problems.push("The backup does not list what it protected.");

  const components = Array.isArray(m.components) ? m.components : [];
  const required = components.filter((c) => c.required);
  if (required.length === 0 && components.length > 0) {
    problems.push("The backup marks nothing as required, so completeness cannot be judged.");
  }
  for (const c of components) {
    if (!["pass", "fail", "blocked", "not_run"].includes(c.status)) {
      problems.push(`A protection step reported an unknown state: ${String(c.status)}.`);
    }
  }
  const notPassing = required.filter((c) => c.status !== "pass");
  if (notPassing.length > 0) {
    problems.push(
      `These parts were not confirmed: ${notPassing.map((c) => c.label).join(", ")}.`,
    );
  }

  if (Array.isArray(m.checksumMismatches) && m.checksumMismatches.length > 0) {
    problems.push("Some uploaded files did not match their original checksums.");
  }

  const serialized = JSON.stringify(raw);
  if (looksSecret(serialized)) {
    problems.push("The backup summary contains something that looks like a credential and must not be shared.");
  }

  // The manifest's own claim must agree with its contents.
  if (m.ok === true && problems.length > 0) {
    problems.push("The backup claimed success but did not meet the requirements for success.");
  }

  return { ok: problems.length === 0, problems };
}

export interface ManifestSummary {
  ok: boolean;
  title: string;
  lines: string[];
}

/** Plain-language summary for the owner. No paths, no checksums, no jargon. */
export function manifestSummary(m: BackupManifest): ManifestSummary {
  const lines: string[] = [];
  for (const c of m.components) {
    const state =
      c.status === "pass" ? "protected"
      : c.status === "fail" ? "needs attention"
      : c.status === "blocked" ? "could not be checked"
      : "not checked";
    lines.push(`${c.label}: ${state}.${c.detail ? ` ${c.detail}` : ""}`);
  }
  if (m.objectCount > 0) lines.push(`Uploaded files: ${m.objectCount} protected.`);
  const ok = m.ok && lines.every((l) => !l.includes("needs attention"));
  return {
    ok,
    title: ok ? "Sophira backup completed" : "Sophira backup needs attention",
    lines,
  };
}
