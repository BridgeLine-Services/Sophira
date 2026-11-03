"use client";

import { useCallback, useState } from "react";
import { MemberDirectory } from "./MemberDirectory";
import { fetchMembers, postMemberAction, type MemberAction } from "@/lib/owner/member-actions";
import type { NetworkMemberStats } from "@/lib/types";

/**
 * MEMBERS PANEL (2026-11-03, phase 1).
 *
 * The dedicated Members page. Every action goes through the existing protected endpoint via
 * the shared member-actions module; nothing about membership rules changed. Permanent removal
 * stays a separate, explicitly confirmed action, never a single click.
 */
export function MembersPanel({ initialMembers }: { initialMembers: NetworkMemberStats[] }) {
  const [members, setMembers] = useState<NetworkMemberStats[]>(initialMembers);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<NetworkMemberStats | null>(null);

  const refresh = useCallback(async () => {
    const next = await fetchMembers();
    if (next) setMembers(next);
  }, []);

  async function act(member: NetworkMemberStats, action: MemberAction, value?: boolean) {
    setBusyId(member.user_id);
    setNotice(null);
    try {
      const failure = await postMemberAction(action, member.user_id, value);
      if (failure) setNotice(failure);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();
  const timeAgo = (iso: string | null) => {
    if (!iso) return "never";
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    return `${days} days ago`;
  };

  return (
    <div className="space-y-4">
      {notice && (
        <div role="alert" className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm text-ink">{notice}</div>
      )}

      <MemberDirectory
        members={members}
        busyId={busyId}
        fmtDate={fmtDate}
        timeAgo={timeAgo}
        onAction={(m, action, value) => void act(m, action, value)}
        onRemove={(m) => setRemoveTarget(m)}
      />

      {removeTarget && (
        <div role="dialog" aria-modal="true" aria-labelledby="remove-title" className="rounded-card border border-rose-300 bg-rose-50 p-4">
          <h2 id="remove-title" className="text-sm font-semibold text-ink">
            Remove {removeTarget.display_name || removeTarget.email || "this member"} permanently?
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            This is not the same as revoking access. Revoking can be undone; removal cannot. Their
            account and records are handled by Sophira&apos;s existing removal process.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
              disabled={busyId === removeTarget.user_id}
              onClick={async () => {
                const target = removeTarget;
                setRemoveTarget(null);
                await act(target, "remove");
              }}
            >
              Yes, remove permanently
            </button>
            <button
              type="button"
              className="rounded-full border border-line bg-card px-4 py-2 text-sm font-medium text-ink hover:border-accent/40"
              onClick={() => setRemoveTarget(null)}
            >
              Keep this member
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-ink-soft">
        You can manage who belongs to your network here. You cannot open a member&apos;s
        assignments, essays or research: managing membership does not grant access to their work.
      </p>
    </div>
  );
}
