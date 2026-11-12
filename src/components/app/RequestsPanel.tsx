"use client";

import { useState } from "react";
import { Badge, Button, Card, CardContent, EmptyState } from "@/components/ui";
import { decideRequest } from "@/lib/owner/invitation-actions";
import { memberIdentity } from "@/lib/member-identity";
import type { InvitationRequest, NetworkMemberStats } from "@/lib/types";

/**
 * REQUESTS PANEL (2026-11-03, phase 1).
 *
 * Only the owner can act here, and deciding is always an explicit click: nothing is approved
 * automatically. A member's request never becomes an invitation on its own.
 */
export function RequestsPanel({ initialRequests, members }: {
  initialRequests: InvitationRequest[];
  members: NetworkMemberStats[];
}) {
  const [requests, setRequests] = useState<InvitationRequest[]>(initialRequests);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/invitation-requests", { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    if (Array.isArray(json?.data)) setRequests(json.data);
  }

  async function decide(id: string, decision: "approve" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      const result = await decideRequest(id, decision);
      if (!result.ok) {
        setError(result.error ?? "Could not record the decision.");
      } else if (result.link) {
        setLink(result.link);
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString();

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-card border border-warn/30 bg-warn/[0.07] p-3 text-sm text-ink">{error}</p>}
      {link && (
        <p className="rounded-card border border-accent/30 bg-accent-soft/40 p-3 text-sm text-ink">
          Invitation created. Share this link if the email does not arrive:{" "}
          <code className="break-all text-xs text-accent">{link}</code>
        </p>
      )}

      {requests.length === 0 ? (
        <EmptyState icon={<span aria-hidden>·</span>} title="No requests yet"
          description="Members you allow to propose new people appear here. Only you decide whether they get in." />
      ) : (
        requests.map((r) => {
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
                    requested by {requester ? memberIdentity(requester).title : "a member"} · {fmt(r.created_at)}
                    {r.reason ? ` · “${r.reason}”` : ""}
                  </p>
                </div>
                {r.status === "pending" ? (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" disabled={busyId === r.id} onClick={() => void decide(r.id, "approve")}>
                      Approve &amp; invite
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busyId === r.id} onClick={() => void decide(r.id, "reject")}>
                      Reject
                    </Button>
                  </div>
                ) : r.status === "approved" ? (
                  <span className="text-xs text-ink-soft">Approved — invitation issued{r.decided_at ? ` ${fmt(r.decided_at)}` : ""}</span>
                ) : (
                  <span className="text-xs text-ink-soft">Rejected — no access was created</span>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
