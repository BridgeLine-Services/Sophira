"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MemberDirectory } from "./MemberDirectory";
import {
  changeMemberRole,
  fetchMembers,
  postMemberAction,
  type MemberAction,
} from "@/lib/owner/member-actions";
import { buildMemberRow, filterMembers, summarize, type MemberFilter, type MemberRow } from "@/lib/owner/member-view";
import { freshnessLabel } from "@/lib/format";
import { DEFAULT_THRESHOLDS, type PresenceThresholds } from "@/lib/presence/thresholds";
import { usePresenceFeed } from "@/lib/presence/use-presence-feed";
import type { NetworkMemberStats, Role } from "@/lib/types";

interface Props {
  initialMembers: NetworkMemberStats[];
  /** The signed-in administrator, so the directory can show "this is you" and limit choices. */
  viewerId: string;
  viewerRole: Role;
  thresholds?: PresenceThresholds | null;
  presenceAvailable?: boolean;
  initialNotice?: string | null;
}

/**
 * MEMBERS PANEL (2026-11-03 phase 1; presence and roles 2026-11-12).
 *
 * The dedicated Members page. Every action goes through the existing protected endpoint via
 * the shared member-actions module; nothing about membership rules changed. Permanent removal
 * stays a separate, explicitly confirmed action, never a single click.
 *
 * What is new: the list keeps itself current from the server, the owner can filter it, live
 * counts sit above it, and a member's role can be changed through the server-side function
 * that enforces the rules. The panel never decides a permission itself — it renders what the
 * server confirmed and shows a refusal as a sentence.
 */
export function MembersPanel({
  initialMembers,
  viewerId,
  viewerRole,
  thresholds,
  presenceAvailable = true,
  initialNotice = null,
}: Props) {
  const [members, setMembers] = useState<NetworkMemberStats[]>(initialMembers);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const [filter, setFilter] = useState<MemberFilter>({ presence: "all", condition: "all", role: "all", query: "" });
  const [usingPresence, setUsingPresence] = useState(presenceAvailable);
  // How fresh the presence picture is. Without this the page says "Online" for a row that may
  // have been read minutes ago, which is a claim about right now that nobody can check.
  const [updatedAt, setUpdatedAt] = useState<number>(() => Date.now());
  const [, setClock] = useState(0);

  const activeThresholds = thresholds ?? DEFAULT_THRESHOLDS;

  const refresh = useCallback(async () => {
    const next = await fetchMembers();
    if (!next) {
      // Keep the rows we have, and say so. A silent failure is how the table went stale before.
      setNotice("Sophira could not refresh the member list just now. The rows below may be a few minutes old.");
      return;
    }
    setMembers(next.members);
    setUsingPresence(next.presenceAvailable);
    setUpdatedAt(Date.now());
    if (next.statsError) setNotice(next.statsError);
  }, []);

  // 2026-11-13: this panel no longer reports presence itself. The shared application shell
  // now does it for every signed-in role on every screen, so keeping a second loop here
  // would double every administrator's heartbeats and release the session on navigation
  // away from this page. The panel keeps its presence FEED (below), which is unrelated.

  // Re-render the "as of" line every half minute so it ages visibly instead of freezing.
  useEffect(() => {
    const id = setInterval(() => setClock((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  usePresenceFeed({
    intervalMs: activeThresholds.presenceUpdateIntervalSeconds * 1000,
    onRefresh: refresh,
  });

  const rows = useMemo(
    () =>
      members.map((m) =>
        buildMemberRow(
          {
            user_id: m.user_id,
            display_name: m.display_name,
            email: m.email,
            phone: m.phone ?? null,
            phone_verified: m.phone_verified ?? null,
            role: m.role,
            status: m.status,
            created_at: m.created_at,
            last_active_at: m.last_active_at,
            access_revoked_at: m.access_revoked_at,
            can_request_invites: m.can_request_invites,
            presence: m.presence ?? null,
            manual_availability: m.manual_availability ?? null,
          },
          { thresholds: activeThresholds, viewerId },
        ),
      ),
    [members, activeThresholds, viewerId],
  );

  // The role-change log below the table is rendered by the server, so a client-side refetch
  // would leave it describing the situation from before the change. router.refresh() re-renders
  // it from the database, so the list the Owner reads is never one change out of date.
  const router = useRouter();
  const visible = useMemo(() => filterMembers(rows, filter), [rows, filter]);
  const counts = useMemo(() => summarize(rows), [rows]);

  async function act(row: MemberRow, action: MemberAction, value?: boolean) {
    setBusyId(row.userId);
    setNotice(null);
    setConfirmation(null);
    try {
      const failure = await postMemberAction(action, row.userId, value);
      if (failure) setNotice(failure);
      else if (action === "revoke") setConfirmation(`${row.identity.title}'s access is revoked.`);
      else if (action === "restore") setConfirmation(`${row.identity.title}'s access is restored.`);
      else if (action === "set_invite_permission")
        setConfirmation(
          value
            ? `${row.identity.title} may now request invitations. You still approve each one.`
            : `${row.identity.title} can no longer request invitations.`,
        );
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(row: MemberRow, role: Role, confirmOwner: boolean) {
    setRoleBusyId(row.userId);
    setNotice(null);
    setConfirmation(null);
    try {
      const result = await changeMemberRole(row.userId, role, confirmOwner);
      if (!result.ok) {
        setNotice(result.error ?? "The role change could not be saved.");
      } else {
        setConfirmation(result.summary ?? `${row.identity.title} now has the ${role} role.`);
      }
      // Re-read the server's own view: the table shows what was stored, not what was clicked.
      await refresh();
      // And the server-rendered audit list, which would otherwise describe the state before
      // this change and quietly contradict the confirmation shown above it.
      if (result.ok) router.refresh();
    } finally {
      setRoleBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {notice && (
        <div role="alert" className="rounded-card border border-warn/30 bg-warn/[0.07] p-3 text-sm text-ink">{notice}</div>
      )}
      {confirmation && (
        <div role="status" className="rounded-card border border-line bg-surface p-3 text-sm text-ink">{confirmation}</div>
      )}

      {!usingPresence && (
        <p className="rounded-card border border-line bg-surface p-3 text-sm text-ink-soft">
          Presence is not available from this database yet, so every member reads Unknown. Their
          role, account condition and last activity are still correct.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-accent-soft px-3 py-1 font-medium text-accent">
          {counts.total} {counts.total === 1 ? "member" : "members"}
        </span>
        <span className="text-ink-soft">
          Active {counts.presence.active} · Online {counts.presence.online} · Idle {counts.presence.idle} ·
          {" "}Offline {counts.presence.offline}
        </span>
        {counts.conditions.suspended > 0 && (
          <span className="text-ink-soft">Suspended {counts.conditions.suspended}</span>
        )}
        {usingPresence && (
          <span className="text-xs text-ink-soft">
            as of {freshnessLabel(updatedAt)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-ink-soft">
          Search
          <input
            type="search"
            value={filter.query ?? ""}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
            placeholder="Name, email or phone"
            className="mt-1 block w-48 rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="text-xs text-ink-soft">
          Presence
          <select
            value={filter.presence ?? "all"}
            onChange={(e) => setFilter((f) => ({ ...f, presence: e.target.value as MemberFilter["presence"] }))}
            className="mt-1 block rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-ink"
          >
            <option value="all">Any presence</option>
            <option value="active">Active</option>
            <option value="online">Online</option>
            <option value="idle">Idle</option>
            <option value="away">Away</option>
            <option value="busy">Busy</option>
            <option value="dnd">Do Not Disturb</option>
            <option value="offline">Offline</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="text-xs text-ink-soft">
          Account
          <select
            value={filter.condition ?? "all"}
            onChange={(e) => setFilter((f) => ({ ...f, condition: e.target.value as MemberFilter["condition"] }))}
            className="mt-1 block rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-ink"
          >
            <option value="all">Any account condition</option>
            <option value="active">Active accounts</option>
            <option value="pending_invitation">Pending invitations</option>
            <option value="suspended">Suspended accounts</option>
            <option value="inactive">Inactive accounts</option>
          </select>
        </label>
        <label className="text-xs text-ink-soft">
          Role
          <select
            value={filter.role ?? "all"}
            onChange={(e) => setFilter((f) => ({ ...f, role: e.target.value as MemberFilter["role"] }))}
            className="mt-1 block rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-ink"
          >
            <option value="all">Any role</option>
            <option value="owner">Owner</option>
            <option value="co_owner">Co-Owner</option>
            <option value="tester">Tester</option>
            <option value="user">User</option>
          </select>
        </label>
        <p className="text-xs text-ink-soft">
          Showing {visible.length} of {counts.total}
        </p>
      </div>

      <MemberDirectory
        rows={visible}
        busyId={busyId}
        roleBusyId={roleBusyId}
        viewerId={viewerId}
        viewerRole={viewerRole}
        onAction={(row, action, value) => void act(row, action, value)}
        onRemove={(row) => setRemoveTarget(row)}
        onChangeRole={(row, role, confirmOwner) => void changeRole(row, role, confirmOwner)}
      />

      {removeTarget && (
        <div role="dialog" aria-modal="true" aria-labelledby="remove-title" className="rounded-card border border-danger/30 bg-danger/[0.06] p-4">
          <h2 id="remove-title" className="text-sm font-semibold text-ink">
            Remove {removeTarget.identity.title} permanently?
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            This is not the same as revoking access. Revoking can be undone; removal cannot. Their
            account and records are handled by Sophira&apos;s existing removal process.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full bg-danger px-4 py-2 text-sm font-medium text-on-accent hover:bg-danger/90"
              disabled={busyId === removeTarget.userId}
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
