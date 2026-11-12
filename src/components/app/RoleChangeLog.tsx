"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { describeRoleChange, type RoleChange } from "@/lib/owner/role-audit";
import { fmtDateTime } from "@/lib/format";

interface Props {
  changes: RoleChange[];
  available: boolean;
}

/**
 * RECENT ROLE CHANGES (2026-11-12).
 *
 * Shown to staff only (the Members page already requires it, and the database policy on
 * membership_audit refuses a member read regardless). Refusals are listed alongside
 * successes, because an attempt that Sophira stopped is information the owner should have,
 * not something to bury.
 */
export function RoleChangeLog({ changes, available }: Props) {
  // A Co-Owner can change a role too, so the Owner may be reading this list while someone else
  // acts. The list is rendered by the server, so the honest control is "read it again", not a
  // client-side guess at what changed.
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asked, setAsked] = useState(false);

  if (!available) {
    return (
      <section className="rounded-card border border-line bg-surface p-4 text-sm text-ink-soft">
        Role changes cannot be listed until the database has the membership audit table. Nothing
        has been changed.
      </section>
    );
  }

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Recent role changes</h3>
        <button
          type="button"
          className="rounded-md border border-line px-2 py-1 text-xs text-ink-soft hover:border-accent hover:text-ink disabled:opacity-60"
          disabled={pending}
          onClick={() => {
            setAsked(true);
            startTransition(() => router.refresh());
          }}
        >
          {pending ? "Reading again…" : "Refresh this list"}
        </button>
      </div>
      {asked && !pending && (
        <p className="mt-1 text-xs text-ink-soft" role="status">
          This is what Sophira has recorded as of now.
        </p>
      )}
      <p className="mt-1 text-xs text-ink-soft">
        Who changed whose role, and every attempt Sophira refused. Refusals are listed too, so
        nothing is hidden. A member never sees this list, and it never appears in a member&apos;s data
        export, because it names the administrator who acted.
      </p>

      {changes.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">No role has been changed yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {changes.map((change) => (
            <li
              key={change.id}
              className={
                "rounded-card border p-3 text-sm text-ink " +
                (change.success ? "border-line bg-card" : "border-warn/40 bg-warn/10")
              }
            >
              <p>{describeRoleChange(change)}</p>
              <p className="mt-1 text-xs text-ink-soft">
                {fmtDateTime(change.at)}
                {change.success ? "" : " · refused"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
