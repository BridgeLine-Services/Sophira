/**
 * WHICH DATABASE IS THIS CONNECTION STRING POINTING AT? (2026-11-09)
 *
 * Sophira applies migrations over a direct Postgres connection, so a wrong
 * connection string does not merely fail - it can migrate somebody else's
 * database. The original guard asked "does the string CONTAIN our project ref?",
 * which is true for `db.<ref>.supabase.co.attacker.example` and for a foreign host
 * that mentions our ref anywhere in the string (CodeQL alerts #43/#33/#26/#24/
 * #21/#20). Substring containment is not identity.
 *
 * This module answers the question structurally instead: parse the URL, then match
 * the host and username against the exact shapes Supabase uses.
 *
 *   direct  postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
 *   pooled  postgres://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres
 *
 * Anything else is `foreign`, and `foreign` is never used for a migration.
 * Plain ASCII scanning only: no backtracking regex touches untrusted input.
 */

export type ConnectionKind = "direct" | "pooled" | "foreign" | "invalid";

export type ConnectionRejection =
  | "malformed"
  | "protocol"
  | "port"
  | "credentials"
  | "host"
  | "project-mismatch";

export interface ConnectionIdentity {
  /** True only for a well-formed Supabase URL for exactly this project. */
  allowed: boolean;
  kind: ConnectionKind;
  /** The ref this URL demonstrably belongs to, when one can be read. */
  projectRef: string | null;
  reason?: ConnectionRejection;
}

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
/** Supabase direct (5432) and supavisor transaction/session (6543/5432). */
const ALLOWED_PORTS = new Set(["", "5432", "6543"]);
/** Ref characters we will even consider; production refs are lowercase alnum. */
const REF_CHARS = /^[a-z0-9]{1,40}$/;
/** Pooler hosts: aws-0-<region>.pooler.supabase.com, aws-1-..., aws-0... */
const POOLER_HOST = /^aws-\d+(?:-[a-z0-9-]+)?\.pooler\.supabase\.com$/;
/** Usernames that cannot be a Postgres role name we expect. */
const SAFE_ROLE = /^[a-z0-9_][a-z0-9._-]*$/i;

function normalizeRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const value = ref.trim().toLowerCase();
  return REF_CHARS.test(value) ? value : null;
}

function reject(reason: ConnectionRejection, projectRef: string | null = null): ConnectionIdentity {
  return {
    allowed: false,
    kind: reason === "malformed" || reason === "protocol" || reason === "port" ? "invalid" : "foreign",
    projectRef,
    reason,
  };
}

/**
 * Classifies `rawUrl` against `expectedRef`.
 *
 * The returned `kind` is only "direct" or "pooled" when `allowed` is true; a
 * foreign host is never described as a usable connection.
 */
export function analyzeConnection(rawUrl: string, expectedRef: string): ConnectionIdentity {
  const ref = normalizeRef(expectedRef);
  if (!ref) return reject("project-mismatch");

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return reject("malformed");
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) return reject("protocol");
  if (!ALLOWED_PORTS.has(parsed.port)) return reject("port");
  // A connection string has no legitimate fragment. One here is either a mistake or
  // an attempt to make two parsers disagree about where the host ends.
  if (parsed.hash) return reject("malformed");

  // Credentials: a decoded username must read as a role name. This rejects
  // "postgres@attacker.example" style smuggling and percent-encoded separators
  // that would change where a naive parser thinks the host ends.
  let user: string;
  try {
    user = decodeURIComponent(parsed.username);
  } catch {
    return reject("credentials");
  }
  if (!user || !SAFE_ROLE.test(user)) return reject("credentials");

  const host = parsed.hostname.toLowerCase();
  if (!host) return reject("host");

  // DIRECT: host must BE db.<ref>.supabase.co - not merely contain the ref.
  if (host === `db.${ref}.supabase.co`) {
    return { allowed: true, kind: "direct", projectRef: ref };
  }

  // POOLED: the host is a Supabase pooler AND the role names this exact project.
  if (POOLER_HOST.test(host)) {
    const parts = user.toLowerCase().split(".");
    const named = parts[0] === "postgres" && parts.length === 2 ? parts[1] : null;
    if (named === ref) return { allowed: true, kind: "pooled", projectRef: ref };
    return reject("project-mismatch", named);
  }

  // A host that embeds our ref but is not one of the two exact shapes (for
  // example db.<ref>.supabase.co.attacker.example) is a different database.
  return reject("host");
}

/** True only when the URL is a usable connection to exactly this project. */
export function isSameProjectConnection(rawUrl: string, expectedRef: string): boolean {
  return analyzeConnection(rawUrl, expectedRef).allowed;
}
