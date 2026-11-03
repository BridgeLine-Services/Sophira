/**
 * RECENT ACTIVITY (2026-11-03).
 *
 * Built ONLY from timestamps the database already stores: when a profile was created, when an
 * invitation was sent or accepted, and when access was revoked. Nothing is simulated and no
 * event type is invented to fill the panel - if the data does not exist, the list is shorter,
 * not padded. This also means the feed works retroactively, with no schema change and no
 * backfill that could mislabel old records.
 */
import { memberIdentity } from "./member-identity";

export type ActivityKind = "joined" | "revoked" | "invitation_accepted" | "invitation_sent";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  at: string;
  title: string;
  detail: string;
}

export interface ActivitySource {
  members?: Array<{
    user_id: string;
    display_name: string;
    email: string | null;
    created_at: string;
    access_revoked_at: string | null;
  }>;
  invitations?: Array<{
    id: string;
    email: string;
    status: string;
    created_at: string;
    accepted_at: string | null;
  }>;
  limit?: number;
}

const DEFAULT_LIMIT = 8;

function valid(at: string | null | undefined): at is string {
  if (!at) return false;
  const time = Date.parse(at);
  return Number.isFinite(time);
}

/** Who is this? The chosen name if there is one, otherwise the address on file. */
function who(displayName: string, email: string | null): string {
  const identity = memberIdentity({ display_name: displayName, email, user_id: "" });
  return identity.title;
}

export function buildActivity(source: ActivitySource): ActivityItem[] {
  const raw: ActivityItem[] = [];

  for (const m of source.members ?? []) {
    const name = who(m.display_name, m.email);
    if (valid(m.created_at)) {
      raw.push({
        id: `joined:${m.user_id}`,
        kind: "joined",
        at: m.created_at,
        title: `${name} joined`,
        detail: "New member account created.",
      });
    }
    if (valid(m.access_revoked_at)) {
      raw.push({
        id: `revoked:${m.user_id}:${m.access_revoked_at}`,
        kind: "revoked",
        at: m.access_revoked_at,
        title: `Access revoked for ${name}`,
        detail: "Their sessions were ended and protected pages are closed to them.",
      });
    }
  }

  for (const i of source.invitations ?? []) {
    if (valid(i.created_at)) {
      raw.push({
        id: `invited:${i.id}`,
        kind: "invitation_sent",
        at: i.created_at,
        title: `Invitation sent to ${i.email}`,
        detail: "Only the owner can revoke a pending invitation.",
      });
    }
    if (valid(i.accepted_at)) {
      raw.push({
        id: `accepted:${i.id}`,
        kind: "invitation_accepted",
        at: i.accepted_at as string,
        title: `${i.email} accepted their invitation`,
        detail: "Single-use link consumed.",
      });
    }
  }

  const seen = new Set<string>();
  const unique = raw.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
  unique.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const limit = Math.min(Math.max(Math.trunc(source.limit ?? DEFAULT_LIMIT), 1), 50);
  return unique.slice(0, limit);
}
