"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ProfileUpdateProposal } from "@/lib/types";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { fmtDate } from "@/lib/format";
import { Check, X } from "lucide-react";

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
          const { error } = await supabase
            .from("teacher_profiles")
            .update(proposal.proposed_changes)
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
          const { error } = await supabase
            .from("writing_profiles")
            .update({
              guidance: proposal.proposed_changes.guidance ?? undefined,
              ...(summary ? { summary } : {}),
              ...(proposal.proposed_changes.version
                ? { version: parseInt(proposal.proposed_changes.version, 10) || undefined }
                : {}),
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
            <p className="text-xs text-ink-soft">Nothing changes until you approve.</p>
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
