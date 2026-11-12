"use client";

import { useState } from "react";
import { ShieldOff, CheckCircle2, ClipboardList, Trash2, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { MemberRow } from "@/lib/owner/member-view";
import { assignableRolesFor, canManageAccount } from "@/lib/auth/permissions";
import { describeRoleChange, ROLE_DESCRIPTIONS, roleLabel, type Role } from "@/lib/roles";

interface Props {
  rows: MemberRow[];
  busyId: string | null;
  roleBusyId: string | null;
  viewerId: string;
  viewerRole: Role;
  onAction: (row: MemberRow, action: "revoke" | "restore" | "set_invite_permission", value?: boolean) => void;
  onRemove: (row: MemberRow) => void;
  onChangeRole: (row: MemberRow, role: Role, confirmOwner: boolean) => void;
}

/**
 * MEMBER DIRECTORY (2026-11-03; four roles + presence 2026-11-12).
 *
 * The owner is looking for a PERSON, so identity comes first and everything else supports
 * it: the nickname they chose (falling back to their email, never to an invented name), the
 * email underneath, the phone with an honest verified/unverified label, their role, whether
 * their ACCOUNT is in good standing, where they are right now (PRESENCE), and when they were
 * last seen and last active.
 *
 * Account condition and presence are shown in separate columns on purpose: they answer
 * different questions, and merging them would let "Offline" read as "suspended".
 *
 * Layout: a table from `md` up, and the same information as stacked cards on a phone. Both
 * render from the same MemberRow, so they can never disagree.
 *
 * Behaviour is deliberately unchanged: the same handlers, the same server routes, the same
 * confirmation before revoking, and permanent removal stays a separate confirmed action.
 * Identity is produced by memberIdentity() (see @/lib/member-identity) via buildMemberRow.
 */
export function MemberDirectory({
  rows, busyId, roleBusyId, viewerId, viewerRole, onAction, onRemove, onChangeRole,
}: Props) {
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [roleTarget, setRoleTarget] = useState<MemberRow | null>(null);

  const actor = { id: viewerId, role: viewerRole };

  const presenceDot = (row: MemberRow) => (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-line"
        style={{ backgroundColor: row.presenceColor }}
      />
      {/* Colour alone never carries the meaning: the written label is always rendered. */}
      <span className="text-sm text-ink">{row.presenceLabel}</span>
    </span>
  );

  const identityBlock = (row: MemberRow) => {
    const id = row.identity;
    return (
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
          {id.initials}
        </span>
        <div className="min-w-0">
          {/*
            EMAIL ONCE (2026-11-13). These three lines used to be: the name, the identity subtitle
            (which is the email when the member has a name), and then a separate email line built
            from the same address. A member with a name therefore read their address twice, and a member
            without one read "No email on file" over "Email unavailable", two different statements
            about one fact. The email is no longer rendered separately: memberIdentity() already
            guarantees it appears exactly once, either as the title (when there is no name to show)
            or as the subtitle (when there is), and says so plainly when it is missing. Nothing here re-reads identity;
            the display bug was fixed where it was made.
          */}
          <p className="truncate font-medium text-ink">{id.title}</p>
          <p className="truncate text-xs text-ink-soft">{id.subtitle}</p>
          <p className="mt-1 text-xs text-ink-soft">
            joined {row.joinedDate} · {row.lastActivityDisplay}
            {row.revokedDate ? ` · revoked ${row.revokedDate}` : ""}
          </p>
        </div>
      </div>
    );
  };

  const phoneCell = (row: MemberRow) => (
    <div>
      {row.phone.display ? (
        <span className="text-sm text-ink">{row.phone.display}</span>
      ) : (
        <span className="text-sm text-ink-soft">No number</span>
      )}
      <p className="text-xs text-ink-soft">
        {row.phone.status === "verified"
          ? "Verified by sign-in"
          : row.phone.status === "unverified"
            ? "Supplied, not verified"
            : "No number on file"}
      </p>
    </div>
  );

  const actions = (row: MemberRow) => {
    if (row.isSelf || row.role === "owner") {
      return <span className="text-xs text-ink-soft">{row.isSelf ? "This is you" : "Owner account"}</span>;
    }

    const accountDecision = canManageAccount(actor, { id: row.userId, role: row.role });
    const roleChoices = assignableRolesFor(actor, { id: row.userId, role: row.role });

    return (
      <div className="flex flex-wrap gap-2">
        {row.condition === "suspended" || row.condition === "inactive" ? (
          <Button size="sm" disabled={busyId === row.userId || !accountDecision.allowed}
            onClick={() => onAction(row, "restore")}>
            <CheckCircle2 className="h-4 w-4" /> Restore
          </Button>
        ) : confirmRevokeId === row.userId ? (
          <>
            <Button size="sm" variant="secondary" disabled={busyId === row.userId || !accountDecision.allowed}
              onClick={() => { setConfirmRevokeId(null); onAction(row, "revoke"); }}>
              <ShieldOff className="h-4 w-4" /> Confirm revoke
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRevokeId(null)}>Cancel</Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" disabled={busyId === row.userId || !accountDecision.allowed}
            onClick={() => setConfirmRevokeId(row.userId)}
            title={accountDecision.allowed ? undefined : accountDecision.reason}>
            <ShieldOff className="h-4 w-4" /> Revoke access
          </Button>
        )}

        {roleChoices.length > 0 && (
          <Button size="sm" variant="ghost" disabled={roleBusyId === row.userId}
            onClick={() => setRoleTarget(row)} title="Change this member's role">
            <UserCog className="h-4 w-4" /> Change role
          </Button>
        )}

        <Button size="sm" variant="ghost" disabled={busyId === row.userId}
          onClick={() => onAction(row, "set_invite_permission", !row.canRequestInvites)}
          title={row.canRequestInvites
            ? "Revoke this member's right to request invitations"
            : "Allow this member to request invitations for others (you still approve each one)"}>
          <ClipboardList className="h-4 w-4" />
          <span className="sr-only">
            {row.canRequestInvites ? "Can request invitations" : "Cannot request invitations"}
          </span>
        </Button>
        <Button size="sm" variant="ghost" disabled={busyId === row.userId}
          onClick={() => onRemove(row)} title="Remove this member permanently">
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Remove member</span>
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* md and up: the table */}
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
        <table className="w-full min-w-[54rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
              <th scope="col" className="px-4 py-3 font-medium">Member</th>
              <th scope="col" className="px-4 py-3 font-medium">Phone</th>
              <th scope="col" className="px-4 py-3 font-medium">Role</th>
              <th scope="col" className="px-4 py-3 font-medium">Presence</th>
              <th scope="col" className="px-4 py-3 font-medium">Account</th>
              <th scope="col" className="px-4 py-3 font-medium">Last seen</th>
              <th scope="col" className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId} className="border-b border-line/60 align-top last:border-0">
                <td className="px-4 py-3">{identityBlock(row)}</td>
                <td className="px-4 py-3">{phoneCell(row)}</td>
                <td className="px-4 py-3"><Badge>{row.roleLabel}</Badge></td>
                <td className="px-4 py-3">
                  {presenceDot(row)}
                  <p className="mt-1 text-xs text-ink-soft">{row.lastSeenDisplay}</p>
                </td>
                <td className="px-4 py-3"><Badge>{row.conditionLabel}</Badge></td>
                <td className="px-4 py-3 text-xs text-ink-soft">{row.lastActivityDisplay}</td>
                <td className="px-4 py-3">{actions(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* phones and narrow tablets: the same facts, stacked */}
      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li key={row.userId} className="rounded-card border border-line bg-surface p-3">
            {identityBlock(row)}
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <dt className="text-ink-soft">Role</dt>
                <dd className="mt-0.5"><Badge>{row.roleLabel}</Badge></dd>
              </div>
              <div>
                <dt className="text-ink-soft">Presence</dt>
                <dd className="mt-0.5">{presenceDot(row)}</dd>
              </div>
              <div>
                <dt className="text-ink-soft">Account</dt>
                <dd className="mt-0.5"><Badge>{row.conditionLabel}</Badge></dd>
              </div>
              <div>
                <dt className="text-ink-soft">Phone</dt>
                <dd className="mt-0.5">{phoneCell(row)}</dd>
              </div>
            </dl>
            <div className="mt-3">{actions(row)}</div>
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <p className="rounded-card border border-line bg-surface p-4 text-sm text-ink-soft">
          No member matches these filters. Clear a filter to see everyone again.
        </p>
      )}

      {roleTarget && (
        <ChangeRoleDialog
          row={roleTarget}
          viewerId={viewerId}
          viewerRole={viewerRole}
          busy={roleBusyId === roleTarget.userId}
          onCancel={() => setRoleTarget(null)}
          onConfirm={(role, confirmOwner) => {
            const target = roleTarget;
            setRoleTarget(null);
            onChangeRole(target, role, confirmOwner);
          }}
        />
      )}
    </div>
  );
}

/**
 * CHANGE ROLE (2026-11-12).
 *
 * Shows the current role, the requested role, and what that change actually gains or loses
 * before anything is sent. The server decides; this dialog only explains and asks. A change
 * that touches the Owner role also asks for an explicit confirmation, which the server
 * requires as a flag — without it, nothing is written.
 */
function ChangeRoleDialog({
  row, viewerId, viewerRole, busy, onCancel, onConfirm,
}: {
  row: MemberRow;
  viewerId: string;
  viewerRole: Role;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (role: Role, confirmOwner: boolean) => void;
}) {
  const choices = assignableRolesFor({ id: viewerId, role: viewerRole }, { id: row.userId, role: row.role });
  const [chosen, setChosen] = useState<Role | null>(choices[0] ?? null);
  const [confirmOwner, setConfirmOwner] = useState(false);
  const change = chosen ? describeRoleChange(row.role, chosen) : { gains: [], loses: [] };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="role-title"
      className="rounded-card border border-line bg-surface p-4 shadow-sm">
      <h2 id="role-title" className="text-sm font-semibold text-ink">
        Change role for {row.identity.title}
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        They are currently a <strong>{roleLabel(row.role)}</strong>. Choose what they should become.
      </p>

      <fieldset className="mt-3 space-y-2">
        <legend className="text-xs uppercase tracking-wide text-ink-soft">New role</legend>
        {choices.map((role) => (
          <label key={role} className="flex items-start gap-2 rounded-lg border border-line p-2 text-sm">
            <input type="radio" name="new-role" value={role} checked={chosen === role}
              onChange={() => setChosen(role)} className="mt-1" />
            <span>
              <span className="font-medium text-ink">{roleLabel(role)}</span>
              <span className="mt-0.5 block text-xs text-ink-soft">{ROLE_DESCRIPTIONS[role]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {chosen && (change.gains.length > 0 || change.loses.length > 0) && (
        <div className="mt-3 rounded-lg bg-accent-soft/40 p-3 text-sm text-ink">
          <p className="font-medium">What this changes</p>
          {change.gains.length > 0 && (
            <p className="mt-1 text-ink-soft">They gain: {change.gains.join("; ")}.</p>
          )}
          {change.loses.length > 0 && (
            <p className="mt-1 text-ink-soft">They lose: {change.loses.join("; ")}.</p>
          )}
        </div>
      )}

      {(chosen === "owner" || row.role === "owner") && (
        <label className="mt-3 flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={confirmOwner} onChange={(e) => setConfirmOwner(e.target.checked)} className="mt-1" />
          <span>
            I understand this changes who can run Sophira. This is a deliberate ownership change.
          </span>
        </label>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={!chosen || busy}
          onClick={() => chosen && onConfirm(chosen, confirmOwner)}>
          <UserCog className="h-4 w-4" /> Save role
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        Sophira will not let anyone change their own role, and will never leave the network
        without an Owner. A refusal is shown to you as a sentence, not a silent failure.
      </p>
    </div>
  );
}
