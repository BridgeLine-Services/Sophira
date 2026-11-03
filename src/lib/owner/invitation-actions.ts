/**
 * Invitation actions (2026-11-03, phase 1).
 *
 * One implementation of the four invitation mutations, shared by the dashboard and the two
 * dedicated pages. Endpoints, payloads and result shapes are exactly what the dashboard used
 * before; only the location moved, so the screens cannot drift apart.
 */
export type InviteChannel = "email" | "sms" | "both";

export interface CreateInvitationInput {
  email: string;
  phone?: string;
  channel: InviteChannel;
  expiresDays: number;
}

export interface CreateInvitationResult {
  ok: boolean;
  /** The shareable link, present whenever the invitation was created. */
  link?: string | null;
  /** Provider wording about what it did or did not deliver. */
  emailNote?: string | null;
  /** "sent" | "partially_sent" | "not_configured" | "failed" - never upgraded by the UI. */
  delivery?: string;
  error?: string;
}

export async function createInvitation(input: CreateInvitationInput): Promise<CreateInvitationResult> {
  try {
    const res = await fetch("/api/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: input.email.trim(),
        phone: input.phone?.trim() || undefined,
        channel: input.channel,
        expires_days: input.expiresDays,
      }),
    });
    const json = (await res.json()) as { data?: Record<string, unknown>; error?: string };
    if (!res.ok) return { ok: false, error: json?.error || "Could not create the invitation." };
    const data = json?.data ?? {};
    return {
      ok: true,
      link: (data.link as string) ?? null,
      emailNote: (data.email_note as string) ?? null,
      delivery: (data.delivery as string) ?? undefined,
    };
  } catch {
    return { ok: false, error: "Could not reach Sophira. Check your connection and try again." };
  }
}

export async function revokeInvitation(id: string): Promise<boolean> {
  try {
    const res = await fetch("/api/invitations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteInvitation(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/invitations?id=${id}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function decideRequest(
  id: string,
  decision: "approve" | "reject",
): Promise<{ ok: boolean; link?: string | null; error?: string }> {
  try {
    const res = await fetch("/api/invitation-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, decision }),
    });
    const json = (await res.json()) as { data?: { link?: string }; error?: string };
    if (!res.ok) return { ok: false, error: json?.error || "Could not record the decision." };
    return { ok: true, link: json?.data?.link ?? null };
  } catch {
    return { ok: false, error: "Could not reach Sophira. Check your connection and try again." };
  }
}

/** Delivery is reported exactly as the provider reported it. */
export function deliveryMessage(delivery?: string): string {
  if (delivery === "sent") return "Invitation sent.";
  if (delivery === "partially_sent") return "Sent on one channel, not the other - see below and retry the failed one.";
  if (delivery === "not_configured") return "Automatic sending is not configured yet. Share the link below.";
  return "Sending failed. Retry, or share the link below.";
}
