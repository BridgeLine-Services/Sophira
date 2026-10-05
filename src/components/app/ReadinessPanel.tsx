"use client";
import { useCallback, useEffect, useState } from "react";
import { Badge, Card, CardContent, CardHeader, CardTitle, Spinner } from "@/components/ui";
import { ClipboardCheck, CheckCircle2, XCircle, MinusCircle, AlertTriangle } from "lucide-react";

interface GateRequirement {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn";
  hard: boolean;
  evidence: string;
  correction: string;
}

interface FinalGate {
  submission_ready: boolean;
  status: "READY" | "NOT_READY";
  requirements: GateRequirement[];
  passed: GateRequirement[];
  failed: GateRequirement[];
  warnings: GateRequirement[];
  rubric_status: { passed: number; partial: number; failed: number; needs_semantic: number; detail: string };
  research_integrity: { status: string; detail: string };
  citation_integrity: { status: string; detail: string };
  blockers: string[];
  gate_text?: string;
}

/**
 * FINAL SUBMISSION READINESS GATE panel (2026-10-05): renders the
 * machine-enforced verdict from /api/readiness/final — the UI cannot
 * show "Ready to Submit" unless the machine result says submission_ready.
 * Every ✓/✗ line carries its evidence; warnings never hide blockers.
 */
export function ReadinessPanel({ assignmentId }: { assignmentId: string }) {
  const [data, setData] = useState<FinalGate | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/readiness/final?assignment_id=${encodeURIComponent(assignmentId)}`);
      const json = await res.json();
      if (res.ok) setData(json.data);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-accent" /> Submission readiness
        </CardTitle>
        <div className="flex items-center gap-2">
          {busy && <Spinner className="h-4 w-4" />}
          {data && (
            <Badge tone={data.submission_ready ? "success" : "danger"}>
              {data.submission_ready ? "READY TO SUBMIT" : `NOT READY — ${data.blockers.length} blocker(s)`}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {failed && (
          <p className="text-sm text-ink-soft">The readiness gate could not run right now — try again shortly.</p>
        )}
        {data && (
          <>
            <p className="text-sm text-ink-soft">
              {data.submission_ready
                ? "The machine-enforced final gate passed every hard requirement — teacher and rubric rules, formatting, citations, research integrity and placeholders."
                : "The final gate FAILED — this work is not ready to submit. Sophira will not label it ready while any hard requirement fails. Fix the blockers below."}
            </p>

            <div className="rounded-lg border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Submission readiness</p>
              <p className={`mt-1 text-lg font-semibold ${data.submission_ready ? "text-success" : "text-danger"}`}>
                {data.submission_ready ? "PASS" : "FAIL"}
              </p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {data.requirements.map((r) => (
                  <li key={r.id} className="flex items-start gap-2">
                    {r.status === "pass" ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    ) : r.status === "warn" ? (
                      <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                    )}
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{r.label}</span>
                      <span className="block text-xs text-ink-soft">{r.evidence}</span>
                      {r.status === "fail" && r.correction && (
                        <span className="block text-xs text-danger">Fix: {r.correction}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <p className={`mt-3 text-sm font-semibold ${data.submission_ready ? "text-success" : "text-danger"}`}>
                STATUS: {data.submission_ready ? "READY TO SUBMIT" : "NOT READY"}
              </p>
            </div>

            {data.blockers.length > 0 && (
              <div className="rounded-lg bg-danger/10 p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-danger">
                  <AlertTriangle className="h-4 w-4" /> Exact reasons submission is blocked:
                </p>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-ink">
                  {data.blockers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-ink-soft">
              Rubric: {data.rubric_status.detail} · Research integrity: {data.research_integrity.detail} ·
              Citations: {data.citation_integrity.detail}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
