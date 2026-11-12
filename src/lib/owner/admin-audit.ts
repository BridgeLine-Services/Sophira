/**
 * THE ADMINISTRATIVE HISTORY, IN ONE PLAIN LANGUAGE (2026-11-11).
 *
 * The Security page used to describe exactly one kind of record: a role change. Everything the
 * database now stores - an invitation, a refused delivery, a suspension, a restoration, a
 * removal, an invitation request, an integration connection - needed a sentence that an owner
 * without a technical background can read at a glance.
 *
 * This module is deliberately PURE: no database, no React, no server imports. It holds the
 * closed vocabulary, the label for each kind, the metadata filter, and the sentence each entry
 * becomes. The migration holds the same closed vocabulary, so a category cannot exist in the
 * code without existing in the database, and a test fails if the two drift.
 *
 * Two honesty rules carried through every sentence:
 *   - a refused action says Sophira refused it, and why, in the words the server used;
 *   - an unknown or missing piece of information is described as missing, never filled in.
 */

export type AdminActionValue =
  | "set_role"
  | "account_suspended"
  | "account_restored"
  | "member_removed"
  | "invite_permission_changed"
  | "invitation_created"
  | "invitation_delivery"
  | "invitation_revoked"
  | "invitation_deleted"
  | "invitation_accepted"
  | "invitation_request_approved"
  | "invitation_request_rejected"
  | "integration_connected"
  | "integration_disconnected";

export type AdminActionCategory = "Roles" | "Members" | "Invitations" | "Connections";

export interface AdminActionInfo {
  value: AdminActionValue;
  /** What the filter calls it. Short, plain, and never a database word. */
  label: string;
  category: AdminActionCategory;
}

/**
 * The closed vocabulary, in the order the filter offers it. `set_role` stays first because it is
 * the longest-running record and the one an owner is most used to seeing.
 */
export const ADMIN_ACTIONS: AdminActionInfo[] = [
  { value: "set_role", label: "Role change", category: "Roles" },
  { value: "invite_permission_changed", label: "Invitation permission changed", category: "Members" },
  { value: "account_suspended", label: "Access suspended", category: "Members" },
  { value: "account_restored", label: "Access restored", category: "Members" },
  { value: "member_removed", label: "Member removed", category: "Members" },
  { value: "invitation_created", label: "Invitation created", category: "Invitations" },
  { value: "invitation_delivery", label: "Invitation email", category: "Invitations" },
  { value: "invitation_revoked", label: "Invitation cancelled", category: "Invitations" },
  { value: "invitation_deleted", label: "Invitation record deleted", category: "Invitations" },
  { value: "invitation_accepted", label: "Invitation accepted", category: "Invitations" },
  { value: "invitation_request_approved", label: "Invitation request approved", category: "Invitations" },
  { value: "invitation_request_rejected", label: "Invitation request declined", category: "Invitations" },
  { value: "integration_connected", label: "Integration connected", category: "Connections" },
  { value: "integration_disconnected", label: "Integration disconnected", category: "Connections" },
];

const VALUES = new Set<string>(ADMIN_ACTIONS.map((a) => a.value));

export function isAdminAction(value: unknown): value is AdminActionValue {
  return typeof value === "string" && VALUES.has(value);
}

export function adminActionLabel(value: string): string {
  return ADMIN_ACTIONS.find((a) => a.value === value)?.label ?? value.replace(/_/g, " ");
}

/**
 * Metadata keys that may be stored. This mirrors `v_keys` in migration 0053 - a test reads both
 * and fails if they differ, because a key the database keeps and the reader ignores (or worse,
 * the other way round) is how a record ends up unable to explain itself.
 */
export const AUDIT_METADATA_KEYS = [
  "channel",
  "channels",
  "delivery",
  "provider",
  "reused",
  "member_label",
  "invitation_id",
  "status",
  "value",
  "source",
] as const;

export const AUDIT_METADATA_MAX_KEYS = 10;
export const AUDIT_METADATA_MAX_CHARS = 120;

export type AuditMetadata = Record<string, string>;

/**
 * Reduce whatever a caller passes to the small, safe shape the table accepts.
 *
 * Invitation tokens, email bodies, document text and anything else unrecognised are dropped
 * rather than truncated: a shortened secret is still a secret in a log.
 */
export function sanitizeAuditMetadata(input: Record<string, unknown> | null | undefined): AuditMetadata {
  if (!input || typeof input !== "object") return {};
  const allowed = new Set<string>(AUDIT_METADATA_KEYS);
  const out: AuditMetadata = {};
  let count = 0;
  for (const [key, raw] of Object.entries(input)) {
    if (count >= AUDIT_METADATA_MAX_KEYS) break;
    if (!allowed.has(key)) continue;
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "boolean") {
      out[key] = raw ? "true" : "false";
      count += 1;
      continue;
    }
    if (typeof raw === "number") {
      if (!Number.isFinite(raw)) continue;
      out[key] = String(raw).slice(0, AUDIT_METADATA_MAX_CHARS);
      count += 1;
      continue;
    }
    if (typeof raw === "string") {
      const text = raw.trim().slice(0, AUDIT_METADATA_MAX_CHARS);
      if (!text) continue;
      out[key] = text;
      count += 1;
      continue;
    }
    // Arrays, objects and anything else are not part of the vocabulary.
  }
  return out;
}

const PROVIDER_LABELS: Record<string, string> = {
  canvas: "Canvas",
  google: "Google Drive",
  microsoft: "Microsoft 365",
};

export function providerLabel(value: string | null | undefined): string | null {
  const key = (value ?? "").trim().toLowerCase();
  if (!key) return null;
  return PROVIDER_LABELS[key] ?? null;
}

function channelWords(metadata: AuditMetadata): string {
  const raw = (metadata.channels || metadata.channel || "").toLowerCase();
  if (raw.includes("sms") && raw.includes("email")) return "by email and text message";
  if (raw.includes("sms")) return "by text message";
  if (raw.includes("email")) return "by email";
  return "";
}

/** How an invitation's confirmed email outcome reads. Never guesses "sent". */
function deliveryWords(metadata: AuditMetadata, reason: string | null): string {
  const status = (metadata.delivery || metadata.status || "").toLowerCase();
  if (status === "sent") return "The email was sent.";
  if (status === "partially_sent") return "Part of it was sent, but not every part.";
  if (status === "not_configured") {
    return "The email was not sent, because no mail provider is connected to Sophira yet.";
  }
  if (status === "failed") return `The email could not be sent${reason ? `: ${reason}` : "."}`;
  return "";
}

export interface AdminEventDescription {
  action: string;
  actorName: string;
  targetName: string;
  success: boolean;
  reason: string | null;
  metadata: AuditMetadata;
  /** Role changes only. */
  fromRole?: string;
  toRole?: string;
}

/** "Alex tried to suspend Jordan's access." - used when Sophira refused. */
function attemptPhrase(event: AdminEventDescription): string | null {
  const who = event.targetName;
  switch (event.action) {
    case "account_suspended":
      return `suspend ${who}'s access`;
    case "account_restored":
      return `restore ${who}'s access`;
    case "member_removed":
      return `remove ${who} from Sophira`;
    case "invite_permission_changed":
      return `change whether ${who} may request invitations`;
    case "invitation_created":
      return "create an invitation";
    case "invitation_revoked":
      return "cancel an invitation";
    case "invitation_deleted":
      return "delete an invitation record";
    case "invitation_request_approved":
      return "approve an invitation request";
    case "invitation_request_rejected":
      return "decline an invitation request";
    default:
      return null;
  }
}

/**
 * One entry, one sentence, no decoding. Kept as a switch so a new action added to the vocabulary
 * cannot silently render as a bare database word.
 */
export function describeAdminEvent(event: AdminEventDescription): string {
  const actor = event.actorName || "Someone";
  const target = event.targetName;
  const reason = event.reason;
  const meta = event.metadata ?? {};

  if (event.action === "set_role") {
    const from = event.fromRole || "their previous role";
    const to = event.toRole || "a new role";
    if (!event.success) {
      return `${actor} tried to change ${target} from ${from} to ${to}. Sophira refused it: ${reason ?? "not allowed"}`;
    }
    return `${actor} changed ${target} from ${from} to ${to}.`;
  }

  // A refused action is the entry an owner most needs to see, so it is never dropped.
  if (!event.success) {
    const attempt = attemptPhrase(event);
    if (attempt) return `${actor} tried to ${attempt}. Sophira refused it: ${reason ?? "not allowed"}`;
  }

  switch (event.action) {
    case "account_suspended":
      return `${actor} suspended ${target}'s access. They can no longer sign in.`;
    case "account_restored":
      return `${actor} restored ${target}'s access. They can sign in again.`;
    case "member_removed":
      return `${actor} removed ${target} from Sophira, along with their account.`;
    case "invite_permission_changed": {
      const granted = (meta.value ?? "").toLowerCase() === "true";
      return granted
        ? `${actor} allowed ${target} to request invitations.`
        : `${actor} stopped ${target} from requesting invitations.`;
    }
    case "invitation_created": {
      const how = channelWords(meta);
      const reused = (meta.reused ?? "").toLowerCase() === "true";
      const opening = reused
        ? `${actor} reused the invitation that was already waiting${how ? `, ${how}` : ""}.`
        : `${actor} created an invitation${how ? ` ${how}` : ""}.`;
      const delivery = deliveryWords(meta, reason);
      return delivery ? `${opening} ${delivery}` : `${opening} Whether the email arrived is recorded separately.`;
    }
    case "invitation_delivery":
      return `Sophira could not deliver an invitation email${reason ? `: ${reason}` : "."}`;
    case "invitation_revoked":
      return `${actor} cancelled an invitation that had not been used yet. The link no longer works.`;
    case "invitation_deleted":
      return `${actor} deleted an invitation record from the list.`;
    case "invitation_accepted":
      return `${target || "A new member"} accepted an invitation and joined Sophira.`;
    case "invitation_request_approved":
      return `${actor} approved an invitation request${
        (meta.delivery ?? "").toLowerCase() === "sent" ? ", and the email was sent." : "."
      }`;
    case "invitation_request_rejected":
      return `${actor} declined an invitation request. No invitation was created.`;
    case "integration_connected": {
      const provider = providerLabel(meta.provider);
      return provider
        ? `${target || "A member"} connected ${provider}. Sophira can now use it for their own work.`
        : `${target || "A member"} connected an integration Sophira does not recognise by name.`;
    }
    case "integration_disconnected": {
      const provider = providerLabel(meta.provider);
      return provider
        ? `${target || "A member"} disconnected ${provider}.`
        : `${target || "A member"} disconnected an integration Sophira does not recognise by name.`;
    }
    default:
      // An action outside this module's vocabulary still gets described honestly as unknown.
      return `${actor} recorded an administrative event Sophira has no description for (${event.action || "unknown"}).`;
  }
}
