"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ProfileUpdateProposal } from "@/lib/types";
import Link from "next/link";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { fmtDate } from "@/lib/format";
import { Check, X } from "lucide-react";

/**
 * Snapshots the CURRENT state of a profile into profile_versions BEFORE a
 * change is applied (spec §14). Append-only history enables rollback.
 * Failure is non-fatal for the approve action but is surfaced honestly.
 */
async function snapshotVersion(
  supabase: ReturnType<typeof createClient>,
  targetType: "teacher" | "writing",
  targetId: string,
  changeSummary: string,
  source: string,
  context?: Record<string, unknown>,
  proposedChanges?: Record<string, string>
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  const { data: current } = await supabase
    .from(targetType === "teacher" ? "teacher_profiles" : "writing_profiles")
    .select("*")
    .eq("id", targetId)
    .single();
  if (!current) return; // nothing to snapshot (e.g. row not created yet)

  const { count } = await supabase
    .from("profile_versions")
    .select("id", { count: "exact", head: true })
    .eq("target_type", targetType)
    .eq("target_id", targetId);

  // Field-level diff for the compare view (spec §9).
  const previousValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  if (proposedChanges) {
    for (const [field, value] of Object.entries(proposedChanges)) {
      previousValues[field] = (current as Record<string, unknown>)?.[field] ?? null;
      newValues[field] = value;
    }
  }

  const { error } = await supabase.from("profile_versions").insert({
    user_id: user.id,
    target_type: targetType,
    target_id: targetId,
    version: (count ?? 0) + 1,
    change_summary: changeSummary,
    source,
    approved_by: user.id,
    approved_at: new Date().toISOString(),
    snapshot: current,
    previous_values: previousValues,
    new_values: newValues,
    assignment_id: (context?.assignment_id as string) || null,
    feedback_id: (context?.feedback_id as string) || null,
  });
  if (error) console.warn("profile snapshot failed:", error.message);
}

const TEACHER_FIELD_LABELS: Record<string, string> = {
  required_methods: "Required methods",
  required_steps: "Required solution steps",
  preferred_notation: "Preferred notation",
  units_sig_figs: "Units & significant figures",
  formatting_requirements: "Formatting requirements",
  citation_requirements: "Citation requirements",
  essay_structure: "Essay structure",
  lab_report_requirements: "Lab report requirements",
  preferred_terminology: "Preferred terminology",
  show_work_rules: "Show-work rules",
  calculator_rules: "Calculator rules",
  allowed_tools: "Allowed tools",
  prohibited_tools: "Prohibited tools",
};

/**
 * Approval-controlled profile updates. Nothing is applied to a Teacher Profile
 * or Writing Profile until the user explicitly approves it here.
 */
export function ProposalsPanel({ targetType, targetId }: { targetType?: "teacher" | "writing"; targetId?: string }) {
  const [proposals, setProposals] = useState<ProfileUpdateProposal[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toast } = useToast();
  const supabase = createClient();

  const load = useCallback(async () => {
    let q = supabase
      .from("profile_update_proposals")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (targetType) q = q.eq("target_type", targetType);
    if (targetId) q = q.eq("target_id", targetId);
    const { data } = await q;
    if (data) setProposals(data as ProfileUpdateProposal[]);
  }, [supabase, targetType, targetId]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, approve: boolean) {
    setBusyId(id);
    try {
      const proposal = proposals.find((p) => p.id === id);
      if (!proposal) return;

      if (approve) {
        if (proposal.target_type === "teacher" && proposal.target_id) {
          await snapshotVersion(supabase, proposal.target_type, proposal.target_id, proposal.change_summary, "proposal:" + proposal.id, proposal.context as Record<string, unknown>, proposal.proposed_changes);
          const { error } = await supabase
            .from("teacher_profiles")
            .update({
              ...proposal.proposed_changes,
              change_summary: proposal.change_summary,
            })
            .eq("id", proposal.target_id);
          if (error) throw new Error(error.message);
        } else if (proposal.target_type === "writing" && proposal.target_id) {
          let summary: Record<string, unknown> | undefined;
          try {
            summary = proposal.proposed_changes.summary
              ? JSON.parse(proposal.proposed_changes.summary)
              : undefined;
          } catch {
            summary = undefined;
          }
          await snapshotVersion(supabase, proposal.target_type, proposal.target_id, proposal.change_summary, "proposal:" + proposal.id, proposal.context as Record<string, unknown>, proposal.proposed_changes);
          const { data: current } = await supabase
            .from("writing_profiles")
            .select("guidance, version")
            .eq("id", proposal.target_id)
            .single();
          // Writing guidance proposals are ADDENDUMS on top of approved guidance
          // (feedback-style proposals add habits, extraction proposals replace).
          const mergedGuidance =
            proposal.proposed_changes.guidance &&
            (proposal.context as Record<string, unknown>)?.source === "student_feedback" &&
            current?.guidance
              ? `${current.guidance}\n- ${proposal.proposed_changes.guidance}`
              : proposal.proposed_changes.guidance ?? undefined;
          const { error } = await supabase
            .from("writing_profiles")
            .update({
              guidance: mergedGuidance,
              ...(summary ? { summary } : {}),
              version: (current?.version ?? 0) + 1,
              change_summary: proposal.change_summary,
              status: "approved",
            })
            .eq("id", proposal.target_id);
          if (error) throw new Error(error.message);
        }
      }

      const { error } = await supabase
        .from("profile_update_proposals")
        .update({ status: approve ? "approved" : "rejected", decided_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);

      toast(approve ? "success" : "info", approve ? "Profile updated." : "Proposal dismissed — nothing was changed.");
      setProposals((ps) => ps.filter((p) => p.id !== id));
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Could not update the proposal.");
    } finally {
      setBusyId(null);
    }
  }

  if (proposals.length === 0) return null;

  return (
    <div className="space-y-3">
      {proposals.map((p) => (
        <Card key={p.id} className="border-accent/30">
          <CardHeader className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Badge tone="accent">Proposed {p.target_type === "writing" ? "Writing Profile" : "Teacher Profile"} update</Badge>
              <span className="text-xs text-ink-soft">{fmtDate(p.created_at)}</span>
            </div>
            <CardTitle className="text-[15px]">{p.change_summary}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1.5 text-sm">
              {Object.entries(p.proposed_changes).map(([field, value]) => (
                <li key={field}>
                  <span className="font-medium text-ink">
                    {p.target_type === "teacher" ? TEACHER_FIELD_LABELS[field] ?? field : "Writing guidance"}:
                  </span>{" "}
                  <span className="text-ink-soft">{value}</span>
                </li>
              ))}
            </ul>
            {typeof (p.context as Record<string, unknown>)?.assignment_id === "string" && (
              <Link
                href={`/assignments/${(p.context as Record<string, string>).assignment_id}`}
                className="text-xs text-accent hover:underline"
              >
                View source assignment →
              </Link>
            )}
            <p className="text-xs text-ink-soft">Nothing changes until you approve. Approved updates snapshot the previous profile so you can roll back.</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => decide(p.id, true)} disabled={busyId === p.id}>
                <Check className="h-4 w-4" /> Approve update
              </Button>
              <Button size="sm" variant="secondary" onClick={() => decide(p.id, false)} disabled={busyId === p.id}>
                <X className="h-4 w-4" /> Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
