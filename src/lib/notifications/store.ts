/**
 * NOTIFICATION CENTRE RULES (2026-11-02).
 *
 * Stage 5 recorded notifications as partial: toasts and email digests existed, but nothing
 * survived a closed tab. This module holds the rules for the durable list, separated from
 * the database and the UI so they can be tested without either.
 *
 * Design choices that matter:
 *  - A fixed set of event kinds. An unknown kind is rejected rather than stored, so the
 *    list cannot fill with events no screen knows how to word or link.
 *  - A relative link only. A notification must never become a redirect to another site.
 *  - Deduplication by (member, dedupe key). A retried sync reports an event once.
 *  - Preferences default to ON. A member who never opened settings still gets their own
 *    due-date reminders; silence is never the accidental default.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationCategory = "canvas" | "deadlines" | "research" | "documents" | "account" | "system";

export const CATEGORIES: NotificationCategory[] = ["canvas", "deadlines", "research", "documents", "account", "system"];

/**
 * Every event Sophira can raise, and the category it belongs to.
 *
 * 2026-11-13: membership events were added. They use the EXISTING "account" category rather
 * than a new one, because that is the row a member already controls in preferences, and
 * because adding a category would mean changing the database's fixed category list for no
 * benefit to the person reading the notice. The notification centre still shows them under
 * their own heading (see presentationGroup), so "Invitations and membership" and "Account
 * and security" stay tellable apart in the interface.
 */
export const KINDS = {
  canvas_assignment_new: "canvas",
  canvas_assignment_changed: "canvas",
  canvas_assignment_missing: "canvas",
  due_soon: "deadlines",
  overdue: "deadlines",
  research_complete: "research",
  document_save_failed: "documents",
  document_recovered: "documents",
  account_security: "account",
  invitation_request_approved: "account",
  invitation_request_rejected: "account",
  invitation_accepted: "account",
  membership_role_changed: "account",
  account_restored: "account",
  system_maintenance: "system",
} as const;

export type NotificationKind = keyof typeof KINDS;

export const LIMITS = { title: 140, body: 600, dedupe: 200, link: 300 } as const;

export interface NewNotification {
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string | null;
  dedupeKey: string;
}

export type NotificationValidation =
  | { ok: true; value: { category: NotificationCategory; kind: NotificationKind; title: string; body: string; link: string | null; dedupeKey: string } }
  | { ok: false; reason: string };

/** A relative in-app path. Anything else is refused: a notice is not a redirect. */
export function safeLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const link = raw.trim();
  if (!link) return null;
  if (!link.startsWith("/") || link.startsWith("//")) return null;
  if (link.includes("\\") || link.toLowerCase().startsWith("/javascript:")) return null;
  return link.length > LIMITS.link ? null : link;
}

function clean(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

/** Dedupe keys are compared case-insensitively and must be meaningful, not accidental. */
function normaliseKey(raw: unknown): string | null {
  const key = clean(raw, LIMITS.dedupe).toLowerCase();
  return key.length >= 3 ? key : null;
}

export function validate(input: NewNotification): NotificationValidation {
  const kind = input?.kind as NotificationKind;
  if (!kind || !(kind in KINDS)) return { ok: false, reason: "unknown notification kind" };

  const title = clean(input.title, LIMITS.title);
  if (!title) return { ok: false, reason: "a notification needs a title the member can read" };

  const dedupeKey = normaliseKey(input.dedupeKey);
  if (!dedupeKey) return { ok: false, reason: "a notification needs a stable dedupe key" };

  return {
    ok: true,
    value: { category: KINDS[kind], kind, title, body: clean(input.body, LIMITS.body), link: safeLink(input.link), dedupeKey },
  };
}

export type Preferences = { categories: Partial<Record<NotificationCategory, boolean>>; email_enabled: boolean };

export const DEFAULT_PREFERENCES: Preferences = { categories: {}, email_enabled: true };

/** Absent means on: only an explicit false turns a category off. */
export function categoryEnabled(preferences: Preferences | null | undefined, category: NotificationCategory): boolean {
  if (!preferences) return true;
  return preferences.categories?.[category] !== false;
}

/** Human wording for the settings screen. */
export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  canvas: "Canvas assignments",
  deadlines: "Due dates and overdue work",
  research: "Finished research",
  documents: "Document saving and recovery",
  account: "Invitations, membership and account security",
  system: "Sophira maintenance",
};

/**
 * PRESENTATION HEADINGS (2026-11-13).
 *
 * The six stored categories are what a member switches on and off. This is only how the
 * list is grouped for reading, so invitation news is not buried among security notices.
 * Nothing here is stored, and nothing here can change what a member receives.
 */
export type PresentationGroup = "membership" | "security" | "canvas" | "deadlines" | "research" | "documents" | "system";

export const PRESENTATION_LABELS: Record<PresentationGroup, string> = {
  membership: "Invitations and membership",
  security: "Account and security",
  canvas: "Canvas",
  deadlines: "Due dates",
  research: "Research",
  documents: "Documents",
  system: "System maintenance",
};

const MEMBERSHIP_KINDS = new Set<string>([
  "invitation_request_approved",
  "invitation_request_rejected",
  "invitation_accepted",
  "membership_role_changed",
  "account_restored",
]);

/** Which heading a notice is shown under. Derived from the event, never from stored text. */
export function presentationGroup(kind: string): PresentationGroup {
  if (MEMBERSHIP_KINDS.has(kind)) return "membership";
  switch (kind) {
    case "account_security":
      return "security";
    case "canvas_assignment_new":
    case "canvas_assignment_changed":
    case "canvas_assignment_missing":
      return "canvas";
    case "due_soon":
    case "overdue":
      return "deadlines";
    case "research_complete":
      return "research";
    case "document_save_failed":
    case "document_recovered":
      return "documents";
    case "system_maintenance":
      return "system";
    default:
      return "system";
  }
}

/** The heading text for one notice. Always something a member can read. */
export function presentationLabel(kind: string): string {
  return PRESENTATION_LABELS[presentationGroup(kind)];
}

export interface NotificationRow {
  id: string;
  category: NotificationCategory;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export async function listNotifications(
  supabase: SupabaseClient,
  userId: string,
  limit = 50,
): Promise<{ items: NotificationRow[]; unread: number }> {
  const { data } = await supabase
    .from("member_notifications")
    .select("id, category, kind, title, body, link, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const items = (data ?? []) as NotificationRow[];
  const { count } = await supabase
    .from("member_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);

  return { items, unread: count ?? items.filter((i) => !i.read_at).length };
}

export async function markRead(supabase: SupabaseClient, userId: string, id: string): Promise<boolean> {
  const { error } = await supabase
    .from("member_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("read_at", null);
  return !error;
}

export async function markAllRead(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from("member_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  return !error;
}

export async function readPreferences(supabase: SupabaseClient, userId: string): Promise<Preferences> {
  const { data } = await supabase.from("notification_preferences").select("categories, email_enabled").eq("user_id", userId).maybeSingle();
  if (!data) return DEFAULT_PREFERENCES;
  return {
    categories: (data.categories ?? {}) as Preferences["categories"],
    email_enabled: data.email_enabled !== false,
  };
}

/**
 * Raise a notice. Called with a service-role client from server code; the dedupe key makes
 * a retry harmless. Returns false when the member has turned this category off, so a caller
 * can skip work it would otherwise do (an email digest, for example).
 */
/**
 * DEDUPE KEYS for Canvas events (2026-11-03).
 *
 * A sync run can repeat (manual check, retries, a second device). The same Canvas change
 * must produce ONE notification, so the key derives from what changed, not when.
 */
export function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h * 33) ^ input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function canvasNewKey(canvasId: string): string {
  return `canvas-new-${String(canvasId).trim()}`;
}

/**
 * Changes are keyed by the values a student cares about: re-running a sync with the same
 * title and due date is silent, while a genuinely different one is a new event.
 */
export function canvasChangedKey(canvasId: string, parts: ReadonlyArray<string | number | null | undefined>): string {
  const material = parts.map((p) => (p === null || p === undefined ? "none" : String(p))).join("|");
  return `canvas-changed-${String(canvasId).trim()}-${shortHash(material)}`;
}

export async function raiseNotification(
  admin: SupabaseClient,
  userId: string,
  input: NewNotification,
): Promise<{ created: boolean; reason?: string }> {
  const checked = validate(input);
  if (!checked.ok) return { created: false, reason: checked.reason };

  const preferences = await readPreferences(admin, userId);
  if (!categoryEnabled(preferences, checked.value.category)) {
    return { created: false, reason: "member turned this category off" };
  }

  const { error } = await admin.from("member_notifications").insert({
    user_id: userId,
    category: checked.value.category,
    kind: checked.value.kind,
    title: checked.value.title,
    body: checked.value.body,
    link: checked.value.link,
    dedupe_key: checked.value.dedupeKey,
  });

  // 23505 = unique violation: this exact event was already reported. Not an error.
  if (error && error.code !== "23505") return { created: false, reason: "could not record the notification" };
  return { created: !error };
}
