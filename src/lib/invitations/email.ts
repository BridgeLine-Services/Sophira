/**
 * INVITATION EMAIL DELIVERY (server-only, 2026-10-13).
 *
 * The invitation lifecycle previously STOPPED at creating the database row
 * and handing the owner a copy link — no email was ever sent. This module
 * sends the invitation email through the configured provider (Resend) and
 * reports the HONEST result. Nothing here ever claims a delivery that the
 * provider did not accept, and no secret ever appears in a status message.
 *
 * States:
 *   sent           — the provider ACCEPTED the send request (message id kept)
 *   not_configured — no email provider is configured; the copy link is the path
 *   failed         — the provider refused or could not be reached (safe reason)
 */
export interface InvitationEmailResult {
  status: "sent" | "not_configured" | "failed";
  providerId?: string;
  reason?: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendInvitationEmail(opts: {
  to: string;
  link: string;
  siteUrl: string;
}): Promise<InvitationEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return {
      status: "not_configured",
      reason: "Sophira cannot send email yet. Copy the invitation link below and send it to your friend by text or any messaging app.",
    };
  }
  const from = process.env.SOPHIRA_INVITE_FROM_EMAIL?.trim() || "Sophira <onboarding@resend.dev>";
  const body = {
    from,
    to: [opts.to],
    subject: "Your invitation to Sophira",
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2430">
      <h2 style="color:#5647ED;margin:0 0 12px">Your invitation to Sophira</h2>
      <p style="margin:0 0 16px;line-height:1.5">You have been invited to a private Sophira network — a personal AI academic assistant. The link below creates your account and is valid for the invitation window.</p>
      <p style="margin:0 0 24px"><a href="${opts.link}" style="background:#5647ED;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">Accept your invitation</a></p>
      <p style="margin:0 0 8px;font-size:13px;color:#667">If the button does not work, open this link directly:</p>
      <p style="margin:0;font-size:13px;word-break:break-all">${opts.link}</p>
    </div>`,
    text: `Your invitation to Sophira: ${opts.link}`,
  };
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (res.ok && json.id) {
      return { status: "sent", providerId: json.id };
    }
    // 2026-10-27: Resend's default sender (onboarding@resend.dev) only accepts
    // the account owner's own address until a domain is verified - that
    // rejection is otherwise cryptic. Status values are unchanged.
    const providerMessage = String(json.message ?? "");
    if (res.status === 403 || /domain|testing/i.test(providerMessage)) {
      return {
        status: "failed",
        reason: "Your email service only allows sending to your own address until you verify a domain. Use the copy link instead.",
      };
    }
    return {
      status: "failed",
      reason: `The email provider rejected the send${providerMessage ? ` (${providerMessage.slice(0, 120)})` : ""}. Share the invitation link below.`,
    };
  } catch {
    return {
      status: "failed",
      reason: "The email provider could not be reached. Share the invitation link below.",
    };
  }
}

/** Human-readable status line for the owner UI — never includes secrets. */
export function invitationEmailNote(r: InvitationEmailResult, to: string): string {
  if (r.status === "sent") return `Email sent to ${to} — the provider accepted the send.`;
  if (r.status === "not_configured") return r.reason ?? "No email provider is configured yet.";
  return r.reason ?? "The email could not be sent.";
}
