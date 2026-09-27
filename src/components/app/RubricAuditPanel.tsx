"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner, useToast } from "@/components/ui";
import { ClipboardCheck, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import type { RubricAuditResult } from "@/lib/rubric";

interface AuditResponse {
  audit_id: string;
  audit: RubricAuditResult;
  ai_assessed: boolean;
  needs_revision: boolean;
  failed_criteria: string;
}

const STATUS_TONE: Record<string, "success" | "warn" | "danger" | "neutral"> = {
  satisfied: "success",
  partial: "warn",
  not_satisfied: "danger",
  needs_semantic: "neutral",
};

/**
 * Rubric compliance panel (spec §6): deterministic checklist audit of the
 * current draft, persisted with the response, with a targeted revision loop.
 * The panel never lets the model "declare" compliance — criteria-level
 * results come from the server audit, deterministic checks first.
 */
export function RubricAuditPanel({
  assignmentId,
  responseId,
  onRevisionGenerated,
}: {
  assignmentId: string;
  responseId: string | null;
  onRevisionGenerated?: () => void;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [revising, setRevising] = useState(false);
  const [audit, setAudit] = useState<AuditResponse | null>(null);

  async function runAudit() {
    if (!responseId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/rubric-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment_id: assignmentId, response_id: responseId, revision_of: audit?.audit_id }),
      });
      const json = await res.json();
      if (res.ok) {
        setAudit(json.data);
        const s = json.data.audit.summary;
        toast(
          s.allPassed ? "success" : "info",
          s.allPassed
            ? `All ${s.passed} criteria satisfied (${json.data.ai_assessed ? "deterministic checks + AI-assessed semantic criteria" : "deterministic checks"}).`
            : `${s.failed} failed, ${s.partial} partial, ${s.passed} satisfied.`
        );
      } else {
        toast("error", json.error || "The audit could not run.");
      }
    } catch {
      toast("error", "Could not reach the server — the audit did not run.");
    } finally {
      setBusy(false);
    }
  }

  async function reviseDraft() {
    if (!audit?.failed_criteria) return;
    setRevising(true);
    try {
      const res = await fetch("/api/ai/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: assignmentId,
          mode: "writing",
          question:
            "Revise your previous draft for this assignment. Fix exactly these failed rubric criteria, keeping everything that already passed:\n" +
            audit.failed_criteria,
          custom_instructions: audit.failed_criteria,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast("success", "Revision generated — re-run the audit to confirm.");
        setAudit(null);
        onRevisionGenerated?.();
        router.refresh();
      } else {
        toast("error", json.error || "The revision failed.");
      }
    } catch {
      toast("error", "Could not reach the server — the revision failed.");
    } finally {
      setRevising(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-accent" /> Rubric compliance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-ink-soft">
          Checks the finished draft against the assignment&apos;s requirements and the teacher&apos;s rubric — word
          counts, required sections, citations, bibliography, prohibited elements. Deterministic checks are run by
          code, not by the model&apos;s own judgment; only what code can&apos;t check is AI-assessed (and labeled as such).
        </p>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={runAudit} disabled={busy || !responseId}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
            {audit ? "Re-audit current draft" : "Audit current draft"}
          </Button>
          {audit?.needs_revision && (
            <Button size="sm" variant="secondary" onClick={reviseDraft} disabled={revising}>
              {revising ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Revise to fix {audit.audit.summary.failed + audit.audit.summary.partial} failed criteria
            </Button>
          )}
        </div>

        {audit && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={audit.audit.summary.allPassed ? "success" : "warn"}>
                {audit.audit.wordCount.toLocaleString()} words · {audit.audit.summary.passed} passed
                {audit.audit.summary.partial > 0 ? ` · ${audit.audit.summary.partial} partial` : ""}
                {audit.audit.summary.failed > 0 ? ` · ${audit.audit.summary.failed} failed` : ""}
              </Badge>
              {audit.ai_assessed && <Badge tone="neutral">semantic criteria AI-assessed</Badge>}
            </div>
            <ul className="space-y-1.5">
              {audit.audit.results.map((r) => (
                <li key={r.id} className="rounded-lg border border-ink/10 p-2.5 text-sm">
                  <div className="flex items-start gap-2">
                    {r.status === "satisfied" ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    ) : (
                      <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${r.status === "not_satisfied" ? "text-danger" : "text-warn"}`} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{r.label}</span>
                        <Badge tone={STATUS_TONE[r.status]}>{r.status.replace(/_/g, " ")}</Badge>
                      </div>
                      <p className="mt-1 text-ink-soft">{r.evidence}</p>
                      {r.requiredCorrection && (
                        <p className="mt-1 text-ink"><span className="font-medium">Fix:</span> {r.requiredCorrection}</p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
