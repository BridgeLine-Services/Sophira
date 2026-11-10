/**
 * EMAIL VALIDATION THAT CANNOT BE SLOWED DOWN (2026-11-09)
 *
 * The invitation routes validated with /^[^\s@]+@[^\s@]+\.[^\s@]+$/ and
 * /^[^\s@]+@[^\s@]+\.[^\s@]+$/-style patterns (CodeQL alerts #11/#10, polynomial
 * regular expressions). Nested quantifiers over untrusted input give an attacker a
 * lever: a long string with no "@" makes the engine explore an enormous number of
 * ways to split it before failing.
 *
 * This validator is a single left-to-right scan with hard length caps, so the cost
 * is exactly linear in the input and bounded by EMAIL_MAX_INPUT before any work
 * happens. It is deliberately a VALIDATOR, not an attempt at RFC 5322 completeness:
 * it accepts the addresses people actually type, rejects everything structurally
 * impossible, and never looks up DNS.
 *
 * Rules:
 *   - at most 320 characters are even considered (254 is the practical maximum for
 *     a full address, 64 for the local part, 63 per label);
 *   - exactly one "@";
 *   - local part: allowed characters only, no leading/trailing dot, no "..";
 *   - domain: at least two labels, each 1-63 characters, alphanumeric or hyphen,
 *     no leading/trailing hyphen, final label at least two letters;
 *   - no spaces or control characters anywhere; no IP-literal domains.
 */

export const EMAIL_MAX_INPUT = 320;
export const EMAIL_MAX_ADDRESS = 254;
export const EMAIL_MAX_LOCAL = 64;
export const EMAIL_MAX_DOMAIN = 253;
export const EMAIL_MAX_LABEL = 63;

/** Local-part characters permitted by the common interpretation of RFC 5321/5322. */
const LOCAL_CHARS = new Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!#$%&'*+/=?^_`{|}~-".split(""));
const LETTERS = /^[a-z]+$/;

export type EmailProblem =
  | "empty"
  | "too-long"
  | "not-a-string"
  | "spaces"
  | "no-at"
  | "several-at"
  | "local"
  | "domain";

export interface EmailCheck {
  ok: boolean;
  /** Normalized address when ok: trimmed and lowercased. */
  email: string;
  problem?: EmailProblem;
}

function fail(problem: EmailProblem): EmailCheck {
  return { ok: false, email: "", problem };
}

/** True when the string contains any control character or whitespace. */
function hasSpaceOrControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function validLocal(local: string): boolean {
  if (!local || local.length > EMAIL_MAX_LOCAL) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  for (const ch of local) if (!LOCAL_CHARS.has(ch)) return false;
  return true;
}

function validDomain(domain: string): boolean {
  if (!domain || domain.length > EMAIL_MAX_DOMAIN) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  // Bracketed IP literals are structurally legal but are never a real invitation
  // target, and letting them through would let "[::1]" look like a hostname.
  if (domain.startsWith("[") || domain.endsWith("]")) return false;

  const labels = domain.split(".");
  if (labels.length < 2) return false;

  for (const label of labels) {
    if (!label || label.length > EMAIL_MAX_LABEL) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    for (const ch of label) {
      const isAlnum = (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9");
      if (!isAlnum && ch !== "-") return false;
    }
  }

  // A numeric TLD ("user@example.12") is a typo or an attack, not an address.
  const tld = labels[labels.length - 1];
  return tld.length >= 2 && LETTERS.test(tld.toLowerCase());
}

/** Validates and normalizes an invitation email address. */
export function checkEmail(input: unknown): EmailCheck {
  if (typeof input !== "string") return fail("not-a-string");
  if (input.length > EMAIL_MAX_INPUT) return fail("too-long");

  const trimmed = input.trim();
  if (!trimmed) return fail("empty");
  if (hasSpaceOrControl(trimmed)) return fail("spaces");
  if (trimmed.length > EMAIL_MAX_ADDRESS) return fail("too-long");

  const at = trimmed.indexOf("@");
  if (at === -1) return fail("no-at");
  if (trimmed.indexOf("@", at + 1) !== -1) return fail("several-at");

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  if (!validLocal(local)) return fail("local");
  if (!validDomain(domain)) return fail("domain");

  return { ok: true, email: `${local.toLowerCase()}@${domain.toLowerCase()}` };
}

/** One sentence a member can act on; never echoes the input back. */
export function emailProblemMessage(problem: EmailProblem | undefined): string {
  switch (problem) {
    case "too-long":
      return "That email address is too long. Please check it and try again.";
    case "spaces":
      return "Please remove any spaces from the email address.";
    case "no-at":
    case "several-at":
      return "Please enter a complete email address, like name@example.com.";
    case "local":
      return "The part before the @ does not look like an email address. Please check it.";
    case "domain":
      return "The part after the @ is not a valid domain, like example.com.";
    case "empty":
    case "not-a-string":
    default:
      return "Please enter an email address.";
  }
}
