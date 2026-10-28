/**
 * INVITATION DELIVERY (2026-10-28) — provider-independent, server-only.
 *
 * Email: Resend if RESEND_API_KEY, otherwise any transactional JSON API
 *        (Postmark/Mailgun-style) via EMAIL_API_URL + EMAIL_API_KEY, with a
 *        verified EMAIL_FROM sender. SMTP is intentionally not bundled: it
 *        would add a dependency, and every provider above also offers SMTP.
 * SMS:   Twilio REST (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
 *        TWILIO_PHONE_NUMBER).
 *
 * Guarantees: credentials never leave the server, nothing is logged with a
 * token or a recipient address, and a provider ACCEPTING a message is
 * reported as "sent" — never as confirmed delivery.
 */

export type Channel = "email" | "sms";
export type DeliveryStatus = "sent" | "not_configured" | "failed" | "skipped";

export interface ChannelResult {
  status: DeliveryStatus;
  reason: string | null;
}

const EMAIL_FROM_DEFAULT = "Sophira <invitations@sophira.app>";

export function emailProviderConfigured(): boolean {
  if ((process.env.RESEND_API_KEY ?? "").trim()) return true;
  return Boolean((process.env.EMAIL_API_URL ?? "").trim() && (process.env.EMAIL_API_KEY ?? "").trim());
}

export function smsConfigured(): boolean {
  return Boolean(
    (process.env.TWILIO_ACCOUNT_SID ?? "").trim() &&
      (process.env.TWILIO_AUTH_TOKEN ?? "").trim() &&
      (process.env.TWILIO_PHONE_NUMBER ?? "").trim()
  );
}

/** E.164 or null. Accepts +1 (555) 123-4567, 15551234567, +44 7700 900123. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const plus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return null;
  const e164 = plus ? `+${digits}` : `+${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null;
  return e164;
}

function invitationHtml(link: string, siteUrl: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2430">
    <h2 style="color:#5647ED;margin:0 0 12px">You're invited to Sophira</h2>
    <p style="margin:0 0 16px;line-height:1.5">Sophira is a private academic assistant. Open the link below to create your account.</p>
    <p style="margin:0 0 24px"><a href="${link}" style="background:#5647ED;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">Accept your invitation</a></p>
    <p style="margin:0 0 8px;font-size:13px;color:#667">Or open this link directly:</p>
    <p style="margin:0;font-size:13px;word-break:break-all">${link}</p>
    <p style="margin:16px 0 0;font-size:12px;color:#889">Sent by ${siteUrl}</p>
  </div>`;
}

type FetchLike = typeof fetch;

export async function sendEmail(opts: {
  to: string;
  link: string;
  siteUrl: string;
  fetchImpl?: FetchLike;
}): Promise<ChannelResult> {
  const f = opts.fetchImpl ?? fetch;
  const from = (process.env.EMAIL_FROM ?? "").trim() || EMAIL_FROM_DEFAULT;
  const subject = "Your invitation to Sophira";
  const html = invitationHtml(opts.link, opts.siteUrl);
  const text = `You're invited to Sophira. Create your account: ${opts.link}`;

  const resendKey = (process.env.RESEND_API_KEY ?? "").trim();
  try {
    if (resendKey) {
      const res = await f("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [opts.to], subject, html, text }),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (res.ok && json.id) return { status: "sent", reason: null };
      return { status: "failed", reason: describeEmailFailure(res.status, json.message) };
    }
    const url = (process.env.EMAIL_API_URL ?? "").trim();
    const key = (process.env.EMAIL_API_KEY ?? "").trim();
    if (url && key) {
      const res = await f(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: opts.to, subject, html, text }),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; error?: string };
      if (res.ok) return { status: "sent", reason: null };
      return { status: "failed", reason: describeEmailFailure(res.status, json.message ?? json.error) };
    }
    return {
      status: "not_configured",
      reason: "Email is not configured. Add RESEND_API_KEY, or EMAIL_API_URL + EMAIL_API_KEY + EMAIL_FROM, in the server environment.",
    };
  } catch {
    return { status: "failed", reason: "The email provider could not be reached. Check connectivity and try again." };
  }
}

function describeEmailFailure(status: number, message?: string): string {
  const m = String(message ?? "");
  if (status === 403 || /domain|testing|not verified/i.test(m)) {
    return "Your email provider only allows sending to your own verified address until a domain is verified. Use the copy link, or verify a sending domain.";
  }
  if (status === 401 || status === 422) return "The email provider rejected the credentials or the sender address. Check EMAIL_FROM and the API key.";
  if (status === 429) return "The email provider is rate limiting sends. Wait a moment and retry this invitation.";
  return `The email provider rejected the send (HTTP ${status}). Retry, or use the copy link.`;
}

export async function sendSms(opts: {
  to: string;
  link: string;
  fetchImpl?: FetchLike;
}): Promise<ChannelResult> {
  if (!smsConfigured()) {
    return {
      status: "not_configured",
      reason: "Text messaging is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER in the server environment.",
    };
  }
  const to = normalizePhone(opts.to);
  if (!to) return { status: "failed", reason: "That phone number is not valid. Use the country code, e.g. +1 555 123 4567." };

  const sid = (process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const token = (process.env.TWILIO_AUTH_TOKEN ?? "").trim();
  const from = normalizePhone(process.env.TWILIO_PHONE_NUMBER) ?? (process.env.TWILIO_PHONE_NUMBER ?? "").trim();
  const f = opts.fetchImpl ?? fetch;
  try {
    const res = await f(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        From: from,
        Body: `You're invited to Sophira. Create your account: ${opts.link}`,
      }).toString(),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
    if (res.ok && json.sid) return { status: "sent", reason: null };
    return { status: "failed", reason: describeSmsFailure(res.status, json.code, json.message) };
  } catch {
    return { status: "failed", reason: "The text-message provider could not be reached. Check connectivity and retry." };
  }
}

function describeSmsFailure(status: number, code?: number, message?: string): string {
  if (code === 21211) return "Twilio rejected the recipient number as invalid. Check the country code and digits.";
  if (code === 21610) return "That number has opted out of messages from this sender.";
  if (code === 21608) return "The recipient number is unverified on a Twilio trial account. Verify it in Twilio, or use the copy link.";
  if (status === 429) return "Twilio is rate limiting messages. Wait a moment and retry.";
  if (status === 401) return "Twilio rejected the credentials. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.";
  return `The text-message provider rejected the send${code ? ` (code ${code})` : ""}${message ? "" : ""}. Retry, or share the copy link.`;
}

export interface InvitationDelivery {
  email: ChannelResult;
  sms: ChannelResult;
  overall: "sent" | "partially_sent" | "failed" | "not_configured";
}

/** Deliver one logical invitation over the selected channels. */
export async function deliverInvitation(opts: {
  channels: Channel[];
  email: string;
  phone?: string | null;
  link: string;
  siteUrl: string;
  fetchImpl?: FetchLike;
}): Promise<InvitationDelivery> {
  const email: ChannelResult = opts.channels.includes("email")
    ? await sendEmail({ to: opts.email, link: opts.link, siteUrl: opts.siteUrl, fetchImpl: opts.fetchImpl })
    : { status: "skipped", reason: null };
  const sms: ChannelResult = opts.channels.includes("sms")
    ? await sendSms({ to: opts.phone ?? "", link: opts.link, fetchImpl: opts.fetchImpl })
    : { status: "skipped", reason: null };

  const attempted = [email, sms].filter((r) => r.status !== "skipped");
  const sent = attempted.filter((r) => r.status === "sent").length;
  const overall: InvitationDelivery["overall"] =
    attempted.length === 0
      ? "not_configured"
      : sent === attempted.length
        ? "sent"
        : sent > 0
          ? "partially_sent"
          : attempted.every((r) => r.status === "not_configured")
            ? "not_configured"
            : "failed";
  return { email, sms, overall };
}
