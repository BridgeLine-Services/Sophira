/**
 * NOTIFICATION CENTRE (2026-11-02).
 *
 * Stage 5 reported notifications as partial: toasts and digests existed but nothing was
 * durable. These tests pin the rules that keep the new list safe and quiet: a fixed set of
 * events, in-app links only, duplicate suppression, and preferences that default to on.
 */
import { readFileSync } from "node:fs";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  KINDS,
  categoryEnabled,
  safeLink,
  validate,
} from "../src/lib/notifications/store";

export function runNotificationTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): void {
  section("notification centre (own notices, quiet by default)");

  // Only known events can be stored, so the list cannot fill with unwordingable entries.
  const unknown = validate({ kind: "something_new" as never, title: "Hi", dedupeKey: "abc" });
  assert(!unknown.ok, "notifications: an unknown event kind is refused, not stored");
  assert(!validate({ kind: "due_soon", title: "", dedupeKey: "abc" }).ok,
    "notifications: a notice with no readable title is refused");
  assert(!validate({ kind: "due_soon", title: "Due soon", dedupeKey: "x" }).ok,
    "notifications: a notice with a meaningless dedupe key is refused");

  const good = validate({ kind: "due_soon", title: "Essay due Friday", body: " You still have time. ", dedupeKey: " Due-Essay-1 " });
  assert(good.ok, "notifications: a valid notice is accepted");
  if (good.ok) {
    assert(good.value.category === "deadlines", "notifications: the category is derived from the event kind");
    assert(good.value.dedupeKey === "due-essay-1", "notifications: dedupe keys are compared case-insensitively");
    assert(good.value.body === "You still have time.", "notifications: body text is trimmed and collapsed");
  }

  // Size bounds: a hostile payload cannot create an unbounded wall of text.
  const huge = validate({ kind: "overdue", title: "t".repeat(500), body: "b".repeat(5000), dedupeKey: "abc" });
  assert(huge.ok && huge.value.title.length <= 140 && huge.value.body.length <= 600,
    "notifications: title and body are bounded");

  // A notification must never become a redirect.
  assert(safeLink("/assignments/123") === "/assignments/123", "notifications: an in-app link is allowed");
  assert(safeLink("https://evil.example/x") === null, "notifications: an absolute external link is refused");
  assert(safeLink("//evil.example") === null, "notifications: a protocol-relative link is refused");
  assert(safeLink("/javascript:alert(1)") === null, "notifications: a script link is refused");
  assert(safeLink("back\\slash") === null, "notifications: a backslash path is refused");
  assert(safeLink(null) === null && safeLink("") === null, "notifications: no link is a valid outcome");

  // Quiet by default, and only an explicit false silences a category.
  assert(categoryEnabled(null, "canvas") === true, "notifications: a member who never opened settings still gets notices");
  assert(categoryEnabled({ categories: {}, email_enabled: true }, "canvas") === true,
    "notifications: an empty preference set means everything is on");
  assert(categoryEnabled({ categories: { canvas: false }, email_enabled: true }, "canvas") === false,
    "notifications: an explicit off is respected");
  assert(categoryEnabled({ categories: { canvas: false }, email_enabled: true }, "deadlines") === true,
    "notifications: turning one category off does not silence the others");

  assert(CATEGORIES.every((c) => typeof CATEGORY_LABELS[c] === "string" && CATEGORY_LABELS[c].length > 3),
    "notifications: every category has plain-language wording for the settings screen");
  assert(Object.values(KINDS).every((c) => (CATEGORIES as string[]).includes(c)),
    "notifications: every event kind maps to a known category");

  section("notification centre (schema and surfaces)");

  const sql = readFileSync("supabase/migrations/0042_member_notifications.sql", "utf8");
  assert(/enable row level security/.test(sql) && (sql.match(/enable row level security/g) ?? []).length === 2,
    "notifications: RLS is enabled on both new tables");
  assert(/unique \(user_id, dedupe_key\)/.test(sql),
    "notifications: the unique key prevents the same event being reported twice");
  assert(/auth\.uid\(\) = user_id/.test(sql), "notifications: policies are scoped to the member's own rows");
  assert(!/is_owner|owner.*using \(true\)/i.test(sql),
    "notifications: there is no owner policy, so the owner cannot read a member's notifications");
  assert(!/for delete/i.test(sql), "notifications: members cannot delete notices, so history survives");

  const markers = readFileSync("scripts/migration-markers.mjs", "utf8");
  assert(markers.includes("0042_member_notifications.sql"),
    "notifications: the migration is registered with the shared marker table");

  const api = readFileSync("src/app/api/notifications/route.ts", "utf8");
  assert(/requireUser/.test(api) && /guard\.data\.user\.id/.test(api),
    "notifications: the API identifies the member from the session, never from the request body");
  assert(/couldn't/.test(api), "notifications: failures are explained in plain words, not API errors");

  const page = readFileSync("src/app/notifications/page.tsx", "utf8");
  assert(/safeLink/.test(page), "notifications: the page validates the link before offering it");
  assert(/listNotifications\(supabase, user\.id\)/.test(page), "notifications: the page reads only this member's notices");

  const shell = readFileSync("src/components/app/AppShell.tsx", "utf8");
  assert(shell.includes('href: "/notifications"'), "notifications: the page is reachable from the app navigation");
}
