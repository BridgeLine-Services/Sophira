"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, CardContent, EmptyState, Input, Label } from "@/components/ui";
import {
  createInvitation as createInvitationRequest,
  deleteInvitation,
  deliveryMessage,
  revokeInvitation,
  type InviteChannel,
} from "@/lib/owner/invitation-actions";
import { memberIdentity } from "@/lib/member-identity";
import type { Invitation, NetworkMemberStats } from "@/lib/types";

/**
 * INVITATIONS PANEL (2026-11-03, phase 1).
 *
 * The dedicated invitation page. The form, channels, expiry, delivery wording and copy-link
 * fallback are the dashboard's, reusing the shared actions. Delivery is only ever reported as
 * the provider reported it: "sent" requires the provider to have accepted it.
 */
export function InvitationsPanel({ initialInvitations, members, siteUrl }: {
  initialInvitations: Invitation[];
  members: NetworkMemberStats[];
  siteUrl: string;
}) {
  const [invitations, setInvitations] = useState<Invitation[]>(initialInvitations);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<InviteChannel>("email");
  const [expires, setExpires] = useState(14);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<string | null>(null);
  const [copyFirst, setCopyFirst] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Never offer a channel Sophira cannot actually deliver on.
  const [cap, setCap] = useState<{ email: boolean; sms: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/setup-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j?.delivery) return;
        setCap({ email: Boolean(j.delivery.email), sms: Boolean(j.delivery.sms) });
        if (j.delivery.email) setChannel("email");
        else if (j.delivery.sms) setChannel("sms");
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function refresh() {
    const res = await fetch("/api/network/stats", { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    if (Array.isArray(json?.data?.invitations)) setInvitations(json.data.invitations);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createInvitationRequest({ email, phone, channel, expiresDays: expires });
      if (!result.ok) {
        setError(result.error ?? "Could not create the invitation.");
        return;
      }
      setLink(result.link ?? null);
      setNote(result.emailNote ?? null);
      setDelivery(deliveryMessage(result.delivery));
      setCopyFirst(result.delivery !== "sent");
      setEmail("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      setError("Copying is blocked in this browser. Select the link and copy it by hand.");
    }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString();
  const isExpired = (i: Invitation) => new Date(i.expires_at).getTime() < Date.now() && i.status === "pending";
  const joinedFor = (inviteEmail: string | null) =>
    members.find((m) => m.email && inviteEmail && m.email.toLowerCase() === inviteEmail.toLowerCase()) ?? null;

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-4">
          <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="min-w-0 md:col-span-2 xl:col-span-1">
              <Label htmlFor="invite-email">Their email</Label>
              <Input id="invite-email" type="email" required className="h-11 w-full text-base"
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@example.com" />
            </div>
            <div className="min-w-0">
              <Label htmlFor="invite-expires">Expires in</Label>
              <select id="invite-expires" className="h-11 w-full rounded-lg border border-line bg-card px-3 text-base text-ink"
                value={expires} onChange={(e) => setExpires(Number(e.target.value))}>
                {[1, 7, 14, 30, 90].map((d) => (
                  <option key={d} value={d}>{d} {d === 1 ? "day" : "days"}</option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="invite-channel">Send by</Label>
              <select id="invite-channel" className="h-11 w-full rounded-lg border border-line bg-card px-3 text-base text-ink"
                value={channel} onChange={(e) => setChannel(e.target.value as InviteChannel)}>
                <option value="email">Email</option>
                <option value="sms">Text message</option>
                <option value="both">Email and text</option>
              </select>
            </div>
            <div className="min-w-0 md:col-span-2">
              <Label htmlFor="invite-phone">Phone (with country code)</Label>
              <input id="invite-phone" type="tel" inputMode="tel" disabled={channel === "email"}
                className="h-11 w-full rounded-lg border border-line bg-card px-3 text-base text-ink disabled:bg-ink/5"
                placeholder="+1 555 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)}
                aria-describedby="invite-phone-hint" />
              <p id="invite-phone-hint" className="mt-1 text-sm text-ink-soft">
                {channel === "email" ? "Only needed when you send by text message."
                  : "Use the full international number, e.g. +1 555 123 4567."}
              </p>
            </div>
            <div className="flex items-end md:col-span-2 xl:col-span-1">
              <Button type="submit" className="h-11 w-full sm:w-auto" disabled={busy}>
                {busy ? "Sending…" : "Send invitation"}
              </Button>
            </div>
          </form>

          {cap && (
            <p className="mt-3 text-sm text-ink-soft">
              {cap.email ? "Email is ready to send." : "Email is not configured yet."}{" "}
              {cap.sms ? "Text messaging is ready to send." : "Text messaging is not configured yet."}{" "}
              Either way you can create the invitation and copy the link to send it yourself.
            </p>
          )}

          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          {delivery && <p className="mt-2 text-sm text-ink-soft">{delivery}</p>}
          {note && (
            <p className={"mt-1 text-sm " + (note.includes("Email sent to") ? "text-success" : "text-danger")}>{note}</p>
          )}

          {link && copyFirst && (
            <div className="mt-3 rounded-card border border-accent/40 bg-accent-soft/50 p-4">
              <p className="text-sm font-medium text-ink">
                Send this link to your friend by text or any messaging app. They open it, choose a
                password, and they&apos;re in.
              </p>
              <Button className="mt-3 w-full sm:w-auto" onClick={() => void copy(link)}>Copy invitation link</Button>
            </div>
          )}
          {link && (
            <div className="mt-3 flex items-center gap-2 rounded-card border border-accent/30 bg-accent-soft/40 p-2">
              <code className="min-w-0 flex-1 truncate text-xs text-accent">{link}</code>
              <Button size="sm" variant="secondary" onClick={() => void copy(link)}>Copy</Button>
            </div>
          )}
          {copied && <p role="status" className="mt-1 text-xs text-success">Copied to clipboard.</p>}
          <p className="mt-2 text-xs text-ink-soft">
            Each link is single-use, tied to that email, expires automatically, and you can revoke it
            any time.
          </p>
        </CardContent>
      </Card>

      {invitations.length === 0 ? (
        <EmptyState icon={<span aria-hidden>·</span>} title="No invitations yet"
          description="Invite someone with the form above. You can copy the link and send it yourself if automatic sending is not set up." />
      ) : (
        <div className="space-y-2">
          {invitations.map((i) => {
            const joined = joinedFor(i.email);
            return (
              <Card key={i.id}>
                <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      {i.email}
                      <Badge>{isExpired(i) ? "expired" : i.status}</Badge>
                    </p>
                    {joined && (
                      <p className="mt-0.5 text-xs text-ink">
                        joined as <span className="font-medium">{memberIdentity(joined).title}</span>
                        {joined.phone ? ` · ${joined.phone}` : " · no phone yet"}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-ink-soft">
                      created {fmt(i.created_at)}
                      {i.accepted_at ? ` · accepted ${fmt(i.accepted_at)}` : ""}
                      {i.status === "pending" ? ` · expires ${fmt(i.expires_at)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {i.status === "pending" && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => void copy(`${siteUrl}/signup?invite=${i.token}`)}>
                          Copy link
                        </Button>
                        <Button size="sm" variant="secondary" disabled={busyId === i.id} onClick={async () => {
                          setBusyId(i.id);
                          try {
                            const ok = await revokeInvitation(i.id);
                            if (!ok) setError("That invitation could not be revoked. Reload and try again.");
                            await refresh();
                          } finally { setBusyId(null); }
                        }}>Revoke</Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" disabled={busyId === i.id} onClick={async () => {
                      setBusyId(i.id);
                      try {
                        const ok = await deleteInvitation(i.id);
                        if (!ok) setError("That invitation could not be deleted. Reload and try again.");
                        await refresh();
                      } finally { setBusyId(null); }
                    }}>Delete</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
