"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardContent, ConfirmDialog, EmptyState, Input, Label, Spinner } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import type { Invitation, InvitationRequest, NetworkMemberStats } from "@/lib/types";
import {
  CheckCircle2, ClipboardList, Copy, Mail, MailQuestion, ShieldOff, Trash2, UserPlus, Users, XCircle,
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
  const [invitations, setInvitations] = useState(initialInvitations);
  const [requests, setRequests] = useState(initialRequests);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteExpires, setInviteExpires] = useState(14);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<NetworkMemberStats | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const toast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const refresh = useCallback(async () => {
    const res = await fetch("/api/network/stats");
    if (!res.ok) return;
    const json = await res.json();
    setMembers(json.data.members);
    setInvitations(json.data.invitations);
    const rres = await fetch("/api/invitation-requests");
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
        body: JSON.stringify({ email: inviteEmail.trim(), expires_days: inviteExpires }),
      });
      const json = await res.json();
      if (res.ok) {
        setInviteLink(json.data.link);
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

  return (
    <div className="space-y-8">
      {toastMsg && (
        <div className="rounded-card border border-ink/10 bg-accent-soft/60 p-3 text-sm text-ink">{toastMsg}</div>
      )}

      {/* Overview tiles — aggregate activity only, never academic content */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
      <section>
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
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
          <UserPlus className="h-5 w-5 text-accent" /> Invite someone
        </h2>
        <Card>
          <CardContent className="p-4">
            <form onSubmit={createInvitation} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label htmlFor="invite-email">Their email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="friend@example.com"
                />
              </div>
              <div>
                <Label htmlFor="invite-expires">Expires in</Label>
                <select
                  id="invite-expires"
                  className="h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink sm:w-36"
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
              <Button type="submit" disabled={inviteBusy}>
                {inviteBusy ? "Creating…" : "Generate invitation link"}
              </Button>
            </form>
            {inviteLink && (
              <div className="mt-3 flex items-center gap-2 rounded-card border border-accent/30 bg-accent-soft/40 p-2">
                <code className="min-w-0 flex-1 truncate text-xs text-accent">{inviteLink}</code>
                <Button size="sm" variant="secondary" onClick={() => copy(inviteLink)}>
                  <Copy className="h-4 w-4" /> Copy
                </Button>
              </div>
            )}
            <p className="mt-2 text-xs text-ink-soft">
              Each link is single-use, tied to that email, expires automatically, and you can revoke it any time.
            </p>
          </CardContent>
        </Card>

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
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
          <Users className="h-5 w-5 text-accent" /> Members
        </h2>
        {members.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="No members yet" description="Invite people you trust — Sophira is a private network." />
        ) : (
          <div className="space-y-2">
            {members.map((m) => {
              const isSelfOwner = m.role === "owner";
              return (
                <Card key={m.user_id}>
                  <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                        {m.display_name || "(no name)"}
                        <Badge>{m.role}</Badge>
                        <Badge>{m.status}</Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-ink-soft">
                        joined {fmtDate(m.created_at)} · last active {timeAgo(m.last_active_at)} ·{" "}
                        {m.assignment_count} assignment{m.assignment_count === 1 ? "" : "s"} · {m.response_count} AI response{m.response_count === 1 ? "" : "s"}
                      </p>
                      {m.subject_usage.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {m.subject_usage.map((s) => (
                            <Badge key={s.subject}>{s.subject} ×{s.count}</Badge>
                          ))}
                        </p>
                      )}
                    </div>
                    {!isSelfOwner && (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {m.status === "active" ? (
                          <Button size="sm" variant="secondary" disabled={busyId === m.user_id} onClick={() => memberAction(m, "revoke")}>
                            <ShieldOff className="h-4 w-4" /> Revoke access
                          </Button>
                        ) : (
                          <Button size="sm" disabled={busyId === m.user_id} onClick={() => memberAction(m, "restore")}>
                            <CheckCircle2 className="h-4 w-4" /> Restore
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === m.user_id}
                          onClick={() => memberAction(m, "set_invite_permission", !m.can_request_invites)}
                          title={m.can_request_invites
                            ? "Revoke this member's right to request invitations"
                            : "Allow this member to request invitations for others (you still approve each one)"}
                        >
                          <ClipboardList className="h-4 w-4" />
                          <span className="hidden sm:inline">{m.can_request_invites ? "Can request invites" : "No invite requests"}</span>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRemoveTarget(m)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">
          You can see membership and aggregate activity, but never another member&apos;s private academic
          work — their courses, assignments, writing, and feedback stay visible only to them.
        </p>
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
