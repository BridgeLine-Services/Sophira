"use client";

import { useState } from "react";
import { ShieldOff, CheckCircle2, ClipboardList, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { memberIdentity } from "@/lib/member-identity";
import type { NetworkMemberStats } from "@/lib/types";

interface Props {
  members: NetworkMemberStats[];
  busyId: string | null;
  fmtDate: (iso: string) => string;
  timeAgo: (iso: string | null) => string;
  onAction: (m: NetworkMemberStats, action: "revoke" | "restore" | "set_invite_permission", value?: boolean) => void;
  onRemove: (m: NetworkMemberStats) => void;
}

/**
 * MEMBER DIRECTORY (2026-11-03).
 *
 * A structured table instead of a stack of cards: the owner is scanning for a PERSON, so
 * identity comes first and the number they may need to ring sits beside it.
 *
 * Behaviour is deliberately unchanged: the same handlers, the same server routes, the same
 * confirmation before revoking. Only the presentation moved.
 */
export function MemberDirectory({ members, busyId, fmtDate, timeAgo, onAction, onRemove }: Props) {
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
            <th scope="col" className="px-4 py-3 font-medium">Member</th>
            <th scope="col" className="px-4 py-3 font-medium">Phone</th>
            <th scope="col" className="px-4 py-3 font-medium">Role</th>
            <th scope="col" className="px-4 py-3 font-medium">Status</th>
            <th scope="col" className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const id = memberIdentity(m);
            const isOwnerRow = m.role === "owner";
            return (
              <tr key={m.user_id} className="border-b border-line/60 align-top last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span aria-hidden="true" className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                      {id.initials}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{id.title}</p>
                      <p className="truncate text-xs text-ink-soft">{id.subtitle}</p>
                      <p className="mt-1 text-xs text-ink-soft">
                        joined {fmtDate(m.created_at)} · last active {timeAgo(m.last_active_at)}
                        {m.access_revoked_at ? ` · revoked ${fmtDate(m.access_revoked_at)}` : ""}
                      </p>
                      {/* A null subject_usage (fresh owner / older statistics) must not crash
                          the row - guard the optional field instead of trusting it. */}
                      {(m.subject_usage?.length ?? 0) > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {(m.subject_usage ?? []).map((sub) => (
                            <Badge key={sub.subject}>{sub.subject} ×{sub.count}</Badge>
                          ))}
                        </p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 align-top text-sm">
                  {m.phone ? <span className="text-ink">{m.phone}</span> : <span className="text-ink-soft">no phone yet</span>}
                </td>
                <td className="px-4 py-3"><Badge>{m.role}</Badge></td>
                <td className="px-4 py-3"><Badge>{m.status}</Badge></td>
                <td className="px-4 py-3">
                  {isOwnerRow ? (
                    <span className="text-xs text-ink-soft">You</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {m.status === "active" ? (
                        confirmRevokeId === m.user_id ? (
                          <>
                            <Button size="sm" variant="secondary" disabled={busyId === m.user_id}
                              onClick={() => { setConfirmRevokeId(null); onAction(m, "revoke"); }}>
                              <ShieldOff className="h-4 w-4" /> Confirm revoke
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmRevokeId(null)}>Cancel</Button>
                          </>
                        ) : (
                          <Button size="sm" variant="secondary" disabled={busyId === m.user_id}
                            onClick={() => setConfirmRevokeId(m.user_id)}>
                            <ShieldOff className="h-4 w-4" /> Revoke access
                          </Button>
                        )
                      ) : (
                        <Button size="sm" disabled={busyId === m.user_id} onClick={() => onAction(m, "restore")}>
                          <CheckCircle2 className="h-4 w-4" /> Restore
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={busyId === m.user_id}
                        onClick={() => onAction(m, "set_invite_permission", !m.can_request_invites)}
                        title={m.can_request_invites
                          ? "Revoke this member's right to request invitations"
                          : "Allow this member to request invitations for others (you still approve each one)"}>
                        <ClipboardList className="h-4 w-4" />
                        <span className="sr-only">
                          {m.can_request_invites ? "Can request invitations" : "Cannot request invitations"}
                        </span>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onRemove(m)} title="Remove this member permanently">
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Remove member</span>
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
