"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Spinner } from "@/components/ui";
import { Download, Info } from "lucide-react";

/**
 * HOW THIS DRAFT WAS PREPARED (2026-11-15, directive Part 7).
 *
 * The runs page could say how a draft was made, and the export file could state it, but the screen
 * where a student actually READS the essay said nothing. That is the screen where it matters most:
 * a student decides what to trust, edit and submit while reading the text.
 *
 * What this does, precisely:
 *  - it asks the same runs list the runs page uses, and shows nothing at all unless one of this
 *    student's own runs delivered THIS essay (matched on the run's own documentSessionId);
 *  - it states the final check exactly as the server recorded it, the sources the plan used, and
 *    every limitation already recorded during the run - it invents no verdict of its own;
 *  - it offers the finished document as a file in both formats, through the existing export route,
 *    which refuses an unfinished run rather than handing back a half document;
 *  - it never claims human authorship and never says "verified" unless the server did.
 *
 * A failure to load is silent: provenance is supplementary, and an error banner over someone's
 * essay would be noise. The absence of the card never implies anything about the draft.
 */

interface ProvenanceRun {
  id: string;
  state: string;
  stateLabel: string;
  createdAt: string;
  completionClaim: string | null;
  documentSessionId: string | null;
  finalCheck: { status: string; note: string } | null;
  sources: { title: string; url: string | null }[];
  findings: { severity: string; text: string }[];
}

export default function AutonomousProvenance({ sessionId }: { sessionId: string }) {
  const [run, setRun] = useState<ProvenanceRun | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/essay/autonomous", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const runs: ProvenanceRun[] = json?.data?.runs ?? [];
        const match = runs.find((r) => r.documentSessionId && r.documentSessionId === sessionId) ?? null;
        if (!cancelled) setRun(match);
      } catch {
        // Silent by design: see the note above.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  if (loading) return <div className="flex items-center gap-2 text-xs text-ink-soft"><Spinner /> Checking how this draft was prepared…</div>;
  if (!run) return null;

  const limitations = run.findings.filter((f) => f.severity === "limitation");
  const day = run.createdAt.slice(0, 10);
  const finished = run.state === "completed";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Info className="h-4 w-4" /> How this draft was prepared
          <Badge tone={finished ? "success" : "warn"}>{run.stateLabel}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-ink-soft">
          Sophira&apos;s assignment runner worked through this assignment on {day}. This is a draft to
          read, edit and submit as your own work: check the facts before you rely on it.
        </p>

        <div>
          <p className="font-medium text-ink">Final check</p>
          <p className="text-ink-soft">
            {run.finalCheck
              ? `${run.finalCheck.status === "VERIFIED" ? "Passed" : "Needs your review"}: ${run.finalCheck.note}`
              : "No final check has been recorded for this draft yet."}
          </p>
        </div>

        <div>
          <p className="font-medium text-ink">Sources used</p>
          <p className="text-ink-soft">
            {run.sources.length === 0
              ? "None. This draft makes no cited factual claims."
              : run.sources.map((s, i) => (
                  <span key={`${s.title}-${i}`}>
                    {i > 0 ? "; " : ""}
                    {s.url ? <a className="underline" href={s.url} rel="noreferrer noopener" target="_blank">{s.title}</a> : s.title}
                  </span>
                ))}
          </p>
        </div>

        {limitations.length > 0 && (
          <div>
            <p className="font-medium text-ink">Limitations recorded during the run</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-soft">
              {limitations.map((l, i) => <li key={i}>{l.text}</li>)}
            </ul>
          </div>
        )}

        {finished && (
          <div className="flex flex-wrap gap-3 pt-1">
            <a className="inline-flex items-center gap-1 text-accent underline" href={`/api/essay/autonomous/${run.id}/export?format=md`}>
              <Download className="h-3 w-3" /> Download as markdown
            </a>
            <a className="inline-flex items-center gap-1 text-accent underline" href={`/api/essay/autonomous/${run.id}/export?format=txt`}>
              <Download className="h-3 w-3" /> Download as plain text
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
