"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { memberIdentity } from "@/lib/member-identity";
import { MemberDirectory } from "@/components/app/MemberDirectory";
import { buildActivity } from "@/lib/owner-activity";
import { Badge, Button, Card, CardContent, ConfirmDialog, EmptyState, Input, Label, Spinner } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import type { Invitation, InvitationRequest, NetworkMemberStats } from "@/lib/types";
import {
  Copy, Mail, MailQuestion, ShieldOff, Trash2, UserPlus, Users, XCircle,
  Activity,
} from "lucide-react";

/**
 * Owner Dashboard (workflow §4, §5, §22): membership management,
 * invitations, invitation-request approvals, and privacy-safe aggregate
 * activity. Every action calls a real API that enforces owner-only
 * authorization server-side; the analytics show counts and timestamps —
 * never another member's academic content.
 */
export function OwnerDashboard({ initialMembers, initialInvitations, initialRequests, siteUrl }: {
  initialMembers: NetworkMemberStats[];
  initialInvitations: Invitation[];
  initialRequests: InvitationRequest[];
  siteUrl: string;
}) {
  const [members, setMembers] = useState(initialMembers);
  // Revoking is reversible but disruptive (it signs the member out), so it takes two
  // deliberate clicks. Real revocation logic is untouched.
  const [invitations, setInvitations] = useState(initialInvitations);
  const [requests, setRequests] = useState(initialRequests);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteExpires, setInviteExpires] = useState(14);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteNote, setInviteNote] = useState<string | null>(null);
  // 2026-10-28: delivery channels (email / text / both) for one invitation.
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteChannel, setInviteChannel] = useState<"email" | "sms" | "both">("email");
  // 2026-10-28: never offer a channel Sophira cannot actually deliver on.
  const [cap, setCap] = useState<{
    email: boolean;
    sms: boolean;
    detail?: { email: { missing: string[] }; sms: { missing: string[] } };
  } | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/setup-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j?.delivery) return;
        const d = j.delivery;
        setCap({ email: Boolean(d.email), sms: Boolean(d.sms), detail: d.detail });
        // A channel that cannot deliver must not stay selected.
        if (d.email) setInviteChannel("email");
        else if (d.sms) setInviteChannel("sms");
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const smsReady = cap ? cap.sms : false;
  const emailReady = cap ? cap.email : false;
  const [inviteDelivery, setInviteDelivery] = useState<string | null>(null);
  // 2026-10-27: when the provider cannot email (default Resend sender can only
  // reach the owner's own address), the COPY LINK becomes the primary result.
  const [inviteEmailBlocked, setInviteEmailBlocked] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<NetworkMemberStats | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The invite form lives in a dialog so the directory stays the focus of the page.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const toast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const refresh = useCallback(async () => {
    const res = await fetch("/api/network/stats", { cache: "no-store" });
    if (!res.ok) { toast("Could not refresh the member list — reload to retry."); return; }
    const json = await res.json();
    setMembers(json.data.members);
    setInvitations(json.data.invitations);
    const rres = await fetch("/api/invitation-requests", { cache: "no-store" });
    if (rres.ok) {
      const rjson = await rres.json();
      setRequests(rjson.data);
    }
  }, []);

  useEffect(() => {
    if (toastMsg) void 0; // toast rendered inline
  }, [toastMsg]);

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast("Copied to clipboard."));
  };

  async function createInvitation(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteBusy(true);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          phone: invitePhone.trim() || undefined,
          channel: inviteChannel,
          expires_days: inviteExpires,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setInviteLink(json.data.link);
        setInviteNote(json.data.email_note ?? null);
        setInviteDelivery(
          json.data.delivery === "sent"
            ? "Invitation sent."
            : json.data.delivery === "partially_sent"
              ? "Sent on one channel, not the other - see below and retry the failed one."
              : json.data.delivery === "not_configured"
                ? "Automatic sending is not configured yet. Share the link below."
                : "Sending failed. Retry, or share the link below."
        );
        setInviteEmailBlocked(json.data.delivery !== "sent");
        setInviteEmail("");
        await refresh();
      } else {
        toast(json.error || "Could not create the invitation.");
      }
    } finally {
      setInviteBusy(false);
    }
  }

  async function revokeInvitation(id: string) {
    setBusyId(id);
    try {
      await fetch("/api/invitations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteInvitation(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/invitations?id=${id}`, { method: "DELETE" });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function decideRequest(id: string, decision: "approve" | "reject") {
    setBusyId(id);
    try {
      const res = await fetch("/api/invitation-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      const json = await res.json();
      if (res.ok && json.data.link) setInviteLink(json.data.link);
      else if (!res.ok) toast(json.error || "Could not record the decision.");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function memberAction(member: NetworkMemberStats, action: string, value?: boolean) {
    setBusyId(member.user_id);
    try {
      const res = await fetch("/api/network/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, user_id: member.user_id, value }),
      });
      const json = await res.json();
      if (!res.ok) toast(json.error || "The action failed.");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function removeMember() {
    if (!removeTarget) return;
    await memberAction(removeTarget, "remove");
    setRemoveTarget(null);
  }

  // After someone accepts, the invitation row must say WHO joined - the name they chose and
  // the phone they gave - so the owner can identify a person before revoking anyone.
  const joinedFor = (email: string | null) =>
    members.find((m) => m.email && email && m.email.toLowerCase() === email.toLowerCase()) ?? null;

  const activity = buildActivity({ members, invitations });
  const activeMembers = members.filter((m) => m.status === "active");
  const isExpired = (i: Invitation) =>
    i.status === "pending" && new Date(i.expires_at).getTime() <= Date.now();
  const pendingInvites = invitations.filter((i) => i.status === "pending" && !isExpired(i));
  const pendingRequests = requests.filter((r) => r.status === "pending");

  const timeAgo = (iso: string | null) => {
    if (!iso) return "never";
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    return `${Math.floor(hrs / 24)} d ago`;
  };

  // Production nav fix (2026-10-11): make /owner#section links work when
  // arriving from any owner page, on direct URL entry, refresh, and browser
  // back/forward. Without this, client-side navigation lands at the top of
  // the page and the section link appears to do nothing.
  useEffect(() => {
    const scrollToHash = () => {
      const h = window.location.hash;
      if (!h || h.length < 2) return;
      const el = document.getElementById(h.slice(1));
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, []);

  return (
    <div className="space-y-8">
      {toastMsg && (
        <div className="rounded-card border border-line bg-accent-soft/60 p-3 text-sm text-ink">{toastMsg}</div>
      )}

      {/* Overview tiles — aggregate activity only, never academic content */}
      <div id="overview" className="grid grid-cols-2 gap-3 scroll-mt-4 sm:grid-cols-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-ink-soft">Total members</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{members.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-ink-soft">Active members</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{activeMembers.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-ink-soft">Pending invitations</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{pendingInvites.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-ink-soft">Invite requests</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{pendingRequests.length}</p>
        </CardContent></Card>
      </div>

      {/* Invitation requests (workflow §5 — user-requested, owner-decided) */}
      <section id="requests" className="scroll-mt-4">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
          <MailQuestion className="h-5 w-5 text-accent" /> Invitation requests
        </h2>
        {requests.length === 0 ? (
          <EmptyState icon={<MailQuestion className="h-6 w-6" />} title="No requests yet"
            description="Members you grant the &quot;request invitations&quot; permission can propose someone. Only you decide." />
        ) : (
          <div className="space-y-2">
            {requests.map((r) => {
              const requester = members.find((m) => m.user_id === r.requester_id);
              return (
                <Card key={r.id}>
                  <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                        {r.email}
                        <Badge>{r.status}</Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-ink-soft">
                        requested by {requester?.display_name || "a member"} · {fmtDate(r.created_at)}
                        {r.reason ? ` · “${r.reason}”` : ""}
                      </p>
                    </div>
                    {r.status === "pending" ? (
                      <div className="flex shrink-0 gap-2">
                        <Button size="sm" disabled={busyId === r.id} onClick={() => decideRequest(r.id, "approve")}>
                          Approve &amp; invite
                        </Button>
                        <Button size="sm" variant="secondary" disabled={busyId === r.id} onClick={() => decideRequest(r.id, "reject")}>
                          Reject
                        </Button>
                      </div>
                    ) : r.status === "approved" ? (
                      <span className="text-xs text-ink-soft">Approved — invitation issued{r.decided_at ? ` ${fmtDate(r.decided_at)}` : ""}</span>
                    ) : (
                      <span className="text-xs text-ink-soft">Rejected — no access was created</span>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Direct invitations */}
      <section id="invite" className="scroll-mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="invite-heading" className="flex items-center gap-2 text-base font-semibold text-ink">
            <UserPlus className="h-5 w-5 text-accent" /> Invite someone
          </h2>
          <Button onClick={() => setInviteOpen(true)} aria-haspopup="dialog">
            <UserPlus className="h-4 w-4" /> Invite member
          </Button>
        </div>
        {inviteOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/40 p-4" role="dialog"
               aria-modal="true" aria-labelledby="invite-heading">
            <div className="mx-auto mt-8 w-full max-w-2xl rounded-card border border-line bg-surface shadow-lg">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <p className="text-sm font-semibold text-ink">Invite a member</p>
                <Button size="sm" variant="ghost" onClick={() => setInviteOpen(false)} aria-label="Close invite form">
                  Close
                </Button>
              </div>
        <Card>
          <CardContent className="p-4">
            <form onSubmit={createInvitation} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="min-w-0 md:col-span-2 xl:col-span-1">
                <Label htmlFor="invite-email">Their email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  className="h-11 w-full text-base"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="friend@example.com"
                />
              </div>
              <div className="min-w-0">
                <Label htmlFor="invite-expires">Expires in</Label>
                <select
                  id="invite-expires"
                  className="h-11 w-full rounded-lg border border-line bg-card px-3 text-base text-ink"
                  value={inviteExpires}
                  onChange={(e) => setInviteExpires(Number(e.target.value))}
                >
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
              </div>
              <div className="min-w-0">
                <Label htmlFor="invite-channel">Send by</Label>
                <select
                  id="invite-channel"
                  className="h-11 w-full rounded-lg border border-line bg-card px-3 text-base text-ink"
                  value={inviteChannel}
                  onChange={(e) => setInviteChannel(e.target.value as "email" | "sms" | "both")}
                >
                  <option value="email">Email</option>
                  <option value="sms">Text message</option>
                  <option value="both">Email and text</option>
                </select>
              </div>
              <div className="min-w-0 md:col-span-2 xl:col-span-1">
                <Label htmlFor="invite-phone">Phone (with country code)</Label>
                <input
                  id="invite-phone"
                  type="tel"
                  inputMode="tel"
                  className="h-11 w-full rounded-lg border border-line bg-card px-3 text-base text-ink disabled:bg-ink/5"
                  placeholder="+1 555 123 4567"
                  value={invitePhone}
                  onChange={(e) => setInvitePhone(e.target.value)}
                  disabled={inviteChannel === "email"}
                  aria-describedby="invite-phone-hint"
                />
                <p id="invite-phone-hint" className="mt-1 text-sm leading-relaxed text-ink-soft">
                  {inviteChannel === "email"
                    ? "Only needed when you send by text message."
                    : "Use the full international number, e.g. +1 555 123 4567."}
                </p>
              </div>
              {cap && (
                <p className="min-w-0 text-sm leading-relaxed text-ink-soft md:col-span-2 xl:col-span-3">
                  {emailReady ? "Email is ready to send." : "Email is not configured."}{" "}
                  {smsReady ? "Text messaging is ready to send." : "Text messaging is not configured."}
                  {!emailReady && cap.detail?.email.missing.length
                    ? ` Email needs: ${cap.detail.email.missing.join(", ")}.`
                    : ""}
                  {!smsReady && cap.detail?.sms.missing.length
                    ? ` Text needs: ${cap.detail.sms.missing.join(", ")}.`
                    : ""}{" "}
                  Either way you can still create the invitation and copy the link to send it yourself.
                </p>
              )}
              <div className="min-w-0 md:col-span-2 xl:col-span-3">
                <Button type="submit" className="h-11 w-full sm:w-auto" disabled={inviteBusy}>
                  {inviteBusy ? "Sending…" : "Send Invitation"}
                </Button>
              </div>
            </form>
            {inviteLink && inviteEmailBlocked && (
              <div className="mt-3 rounded-card border border-accent/40 bg-accent-soft/50 p-4">
                <p className="text-sm font-medium text-ink">
                  Send this link to your friend by text or any messaging app. They open it, choose a password, and they&apos;re in.
                </p>
                <Button className="mt-3 w-full sm:w-auto" onClick={() => copy(inviteLink)}>
                  <Copy className="h-4 w-4" /> Copy invitation link
                </Button>
              </div>
            )}
            {inviteLink && (
              <div className="mt-3 flex items-center gap-2 rounded-card border border-accent/30 bg-accent-soft/40 p-2">
                <code className="min-w-0 flex-1 truncate text-xs text-accent">{inviteLink}</code>
                <Button size="sm" variant="secondary" onClick={() => copy(inviteLink)}>
                  <Copy className="h-4 w-4" /> Copy
                </Button>
              </div>
            )}
      {inviteDelivery && <p className="mt-1 text-xs text-ink-soft">{inviteDelivery}</p>}
      {inviteNote && (
        <p className={"mt-1 text-xs " + (inviteNote.includes("Email sent to") ? "text-success" : "text-danger")}>{inviteNote}</p>
      )}
            <p className="mt-2 text-xs text-ink-soft">
              Each link is single-use, tied to that email, expires automatically, and you can revoke it any time.
            </p>
          </CardContent>
        </Card>

            </div>
          </div>
        )}
        {invitations.length > 0 && (
          <div className="mt-3 space-y-2">
            {invitations.map((i) => (
              <Card key={i.id}>
                <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      {i.email}
                      <Badge>{isExpired(i) ? "expired" : i.status}</Badge>
                    </p>
                    {joinedFor(i.email) ? (
                      <p className="mt-0.5 text-xs text-ink">
                        joined as <span className="font-medium">{memberIdentity(joinedFor(i.email)!).title}</span>
                        {joinedFor(i.email)!.phone ? ' · ' + joinedFor(i.email)!.phone : ' · no phone yet'}
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-ink-soft">
                      created {fmtDate(i.created_at)}
                      {i.accepted_at ? ` · accepted ${fmtDate(i.accepted_at)}` : ""}
                      {i.status === "pending" && ` · expires ${fmtDate(i.expires_at)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {i.status === "pending" && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => copy(`${siteUrl}/signup?invite=${i.token}`)}>
                          <Copy className="h-4 w-4" /> Copy link
                        </Button>
                        <Button size="sm" variant="secondary" disabled={busyId === i.id} onClick={() => revokeInvitation(i.id)}>
                          <ShieldOff className="h-4 w-4" /> Revoke
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" disabled={busyId === i.id} onClick={() => deleteInvitation(i.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Members */}
      <section id="members" className="scroll-mt-4">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
          <Users className="h-5 w-5 text-accent" /> Members
        </h2>
        <p className="mb-2 text-xs text-ink-soft">
          Only the owner can grant, revoke, or reinstate access. Revoking blocks the member
          immediately — even if they have the app installed or a session already open — and signs
          out their active sessions.
        </p>
        {members.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="No members yet" description="Invite people you trust - Sophira is a private network." />
        ) : (
          <MemberDirectory
            members={members}
            busyId={busyId}
            fmtDate={fmtDate}
            timeAgo={timeAgo}
            onAction={memberAction}
            onRemove={setRemoveTarget}
          />
        )}
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">
          You can see membership and aggregate activity, but never another member&apos;s private academic
          work — their courses, assignments, writing, and feedback stay visible only to them.
        </p>
      </section>

      {/* Recent activity - derived from stored timestamps only, never simulated. */}
      <section id="activity" className="scroll-mt-4">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
          <Activity className="h-5 w-5 text-accent" /> Recent activity
        </h2>
        {activity.length === 0 ? (
          <EmptyState icon={<Activity className="h-6 w-6" />} title="Nothing yet"
            description="Invitations, new members, and access changes appear here as they happen." />
        ) : (
          <Card>
            <CardContent className="divide-y divide-line p-0">
              {activity.map((item) => (
                <div key={item.id} className="flex items-start gap-3 p-4">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{item.title}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">{item.detail}</p>
                  </div>
                  <span className="whitespace-nowrap text-xs text-ink-soft">{timeAgo(item.at)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove this member permanently?"
        message={`${removeTarget?.display_name || "This member"}'s account and ALL their data (courses, teachers, assignments, writing) will be permanently deleted. This cannot be undone. Use "Revoke access" instead if you just want to block them.`}
        confirmLabel="Delete permanently"
        onConfirm={removeMember}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
