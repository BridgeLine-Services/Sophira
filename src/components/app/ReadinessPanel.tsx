"use client";
import { useCallback, useEffect, useState } from "react";
import { Badge, Card, CardContent, CardHeader, CardTitle, Spinner } from "@/components/ui";
import { ClipboardCheck, CheckCircle2, XCircle, MinusCircle } from "lucide-react";

interface ReadinessCheck {
  id: string;
  label: string;
  passed: boolean | null;
  blocking: boolean;
  detail: string;
}

interface Readiness {
  ready: boolean;
  checks: ReadinessCheck[];
  blockers: string[];
}

/**
 * Submission readiness (audit item H1): one mechanical verdict aggregating
 * the draft, verification, teacher method compliance, rubric audit and
 * research integrity — never a model's opinion. Not ready means not ready,
 * with the exact reason and what blocks submission.
 */
export function ReadinessPanel({ assignmentId }: { assignmentId: string }) {
  const [data, setData] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/readiness?assignment_id=${encodeURIComponent(assignmentId)}`);
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
            <Badge tone={data.ready ? "success" : "danger"}>
              {data.ready ? "ready to submit" : `${data.blockers.length} blocker(s)`}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {failed && (
          <p className="text-sm text-ink-soft">Readiness could not be computed right now — try again shortly.</p>
        )}
        {data && (
          <>
            <p className="text-sm text-ink-soft">
              {data.ready
                ? "Every blocking check passed: the draft is present, verification and method requirements hold, rubric criteria are satisfied, and research claims are fully supported."
                : "This work is NOT ready to submit. Fix the blockers below — nothing here is a style opinion."}
            </p>
            <ul className="space-y-1.5 text-sm">
              {data.checks.map((c) => (
                <li key={c.id} className="flex items-start gap-2">
                  {c.passed === true ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  ) : c.passed === false ? (
                    <XCircle className={`mt-0.5 h-4 w-4 shrink-0 ${c.blocking ? "text-danger" : "text-danger"}`} />
                  ) : (
                    <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />
                  )}
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{c.label}</span>
                    {c.passed === null && " (not applicable)"}
                    {c.blocking && c.passed === false && <Badge tone="danger">blocking</Badge>}
                    <span className="block text-xs text-ink-soft">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
