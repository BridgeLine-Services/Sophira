/**
 * DATE FORMATTING (2026-11-12).
 *
 * The member table rendered the literal text "Invalid Date" whenever a timestamp
 * was missing, malformed, or a value the browser could not parse. That is not a
 * cosmetic problem: it is a false statement about a member's account, and it made
 * the owner distrust the whole directory.
 *
 * These helpers never invent a date. An absent value returns an empty string, an
 * unparseable one returns an honest word from the caller's vocabulary, and the
 * caller always decides what "no date" means ("Never active", "Unavailable").
 */

export function isValidDate(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  return Number.isFinite(time);
}

export function fmtDate(iso: string | null | undefined, fallback = ""): string {
  if (!isValidDate(iso)) return fallback;
  return new Date(iso as string).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

export function fmtDateTime(iso: string | null | undefined, fallback = ""): string {
  if (!isValidDate(iso)) return fallback;
  return new Date(iso as string).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/**
 * Relative time in words, for scanability: "just now", "3 minutes ago",
 * "yesterday", "12 days ago".
 *
 * `neverLabel` is used when there is genuinely no timestamp (a member who has never
 * been active), `invalidLabel` when a timestamp exists but cannot be read. The two
 * are different facts and are never collapsed into one.
 */
export function relativeTime(
  iso: string | null | undefined,
  opts: { now?: number; neverLabel?: string; invalidLabel?: string } = {},
): string {
  const never = opts.neverLabel ?? "Never active";
  const invalid = opts.invalidLabel ?? "Unavailable";
  if (iso === null || iso === undefined || iso === "") return never;
  if (!isValidDate(iso)) return invalid;
  const now = opts.now ?? Date.now();
  const then = new Date(iso as string).getTime();
  const seconds = Math.round((now - then) / 1000);
  if (seconds <= 0) return "just now";
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  // "yesterday" is a calendar fact, not a 24-hour bucket: compare local days.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfThen = new Date(then);
  startOfThen.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfToday.getTime() - startOfThen.getTime()) / 86400000);
  if (dayDiff <= 1) return "yesterday";
  if (dayDiff < 30) return `${dayDiff} days ago`;
  const months = Math.round(dayDiff / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(dayDiff / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** Short activity phrasing used in the directory: "Active just now". */
export function activityPhrase(iso: string | null | undefined, opts: { now?: number } = {}): string {
  const rel = relativeTime(iso, { now: opts.now });
  if (rel === "Never active") return rel;
  if (rel === "Unavailable") return "Last active unavailable";
  if (rel === "just now") return "Active just now";
  return `Last active ${rel}`;
}
