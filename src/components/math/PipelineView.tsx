"use client";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Spinner } from "@/components/ui";

export interface PipelineResult {
  status: "OK" | "NEEDS CONFIRMATION" | "NEEDS REVIEW";
  recognized: { rawText: string; expression: string; expressions: string[]; confidence: number; ambiguity: string[]; ocrEngine: string };
  solution: { solved: boolean; kind: string; finalAnswer: string; steps: { text: string; expr?: string }[]; honestNote?: string };
  explanation: { text: string; source: string; honestNote: string };
  verification: { status: string; checks: { name: string; passed: boolean; detail: string }[]; note?: string };
  classification?: { [k: string]: unknown };
  teacherMethod?: { applied: boolean; note: string } | null;
  multipleChoice?: { inverted: boolean; established: boolean; base: string; choices: { label: string; text: string; verdict: "correct" | "incorrect" | "cannot_determine"; reason: string }[] };
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "math-field": Record<string, unknown>;
    }
  }
}
import { AlertTriangle, CheckCheck, ShieldCheck } from "lucide-react";
import { TypesetMath } from "@/components/math/TypesetMath";

export function PipelineView({ result, confirming, onConfirmChange, onConfirm }: {
  result: PipelineResult;
  confirming: boolean;
  onConfirmChange: (v: string) => void;
  onConfirm: () => void;
}) {
  const needsConfirm = result.status === "NEEDS CONFIRMATION" || confirming;
  return (
    <div className="space-y-4">
      {/* Step 7 — the recognized expression is ALWAYS shown first, never skipped */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCheck className="h-4 w-4" /> Recognized input (step 7 — always shown)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={result.recognized.ocrEngine === "deterministic" ? "neutral" : "accent"}>{result.recognized.ocrEngine} OCR</Badge>
            <Badge tone={result.recognized.confidence >= 0.8 ? "success" : "warn"}>{(result.recognized.confidence * 100).toFixed(0)}% confidence</Badge>
          </div>
          <p className="rounded-lg border border-line bg-muted/40 p-3 font-mono text-lg">{result.recognized.expression || "(nothing recognized)"}</p>
          {result.recognized.rawText && result.recognized.rawText !== result.recognized.expression && (
            <p className="text-xs text-ink/50">raw OCR text: {result.recognized.rawText}</p>
          )}
          {result.recognized.ambiguity.length > 0 && (
            <ul className="text-xs text-warn">
              {result.recognized.ambiguity.map((a, i) => <li key={i}>⚠ {a}</li>)}
            </ul>
          )}
          {needsConfirm && (
            <div className="space-y-2 rounded-lg border border-warn/30 bg-warn/5 p-3">
              <Label>Confirm or correct the expression before Sophira solves it:</Label>
              <Input defaultValue={result.recognized.expression} onChange={(e) => onConfirmChange(e.target.value)} />
              <Button size="sm" onClick={onConfirm}>That&apos;s right — solve it</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* solution */}
      {(result.solution.solved || result.solution.finalAnswer) && (
        <Card>
          <CardHeader><CardTitle>Solution (deterministic)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Badge tone="neutral">{result.solution.kind.replace(/_/g, " ")}</Badge>
            <ol className="space-y-1 text-sm">
              {result.solution.steps.map((s, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-1"><span>{s.text}</span>{s.expr && <span className="ml-1"><TypesetMath expr={s.expr} /></span>}</li>
              ))}
            </ol>
            {result.solution.finalAnswer && (
              <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4 text-center">
                <p className="mb-1 text-xs uppercase tracking-wide text-ink/50">Answer</p>
                <div className="text-lg"><TypesetMath expr={result.solution.finalAnswer} display /></div>
              </div>
            )}
            {result.solution.honestNote && <p className="text-xs text-warn">⚠ {result.solution.honestNote}</p>}
          </CardContent>
        </Card>
      )}

      {/* multiple-choice analysis */}
      {result.multipleChoice && (
        <Card>
          <CardHeader><CardTitle>Multiple-choice analysis</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-xs text-ink/60">
              Problem solved: <span className="font-mono">{result.multipleChoice.base}</span>
              {result.multipleChoice.inverted ? " — the question asks for the INCORRECT choice, so the logic is inverted." : ""}
            </p>
            <ul className="space-y-1">
              {result.multipleChoice.choices.map((c) => (
                <li key={c.label} className={c.verdict === "correct" ? "rounded border border-success/40 bg-success/10 p-2 font-medium" : c.verdict === "cannot_determine" ? "rounded border border-warn/40 bg-warn/10 p-2" : "rounded border border-line p-2"}>
                  <strong>{c.label}.</strong> {c.text} — <em>{c.verdict === "correct" ? "Correct" : c.verdict === "incorrect" ? "Incorrect" : "Could not be established"}</em>: {c.reason}
                </li>
              ))}
            </ul>
            {!result.multipleChoice.established && <p className="text-xs text-warn">⚠ The underlying problem could not be solved with certainty, so no choice is confirmed — nothing was guessed.</p>}
          </CardContent>
        </Card>
      )}

      {/* explanation */}
      {result.explanation.text && (
        <Card>
          <CardHeader><CardTitle>Explanation</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Badge tone={result.explanation.source === "ai" ? "accent" : "neutral"}>{result.explanation.source === "ai" ? "AI explanation" : "deterministic summary"}</Badge>
            <p className="whitespace-pre-wrap">{result.explanation.text}</p>
            <p className="text-xs italic text-ink/40">{result.explanation.honestNote}</p>
          </CardContent>
        </Card>
      )}

      {result.teacherMethod && (
        <p className="text-xs text-ink/60">Teacher method: {result.teacherMethod.note}</p>
      )}

      {/* verification */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {result.verification.status === "VERIFIED"
              ? <><ShieldCheck className="h-4 w-4 text-success" /> Independent verification</>
              : <><AlertTriangle className="h-4 w-4 text-warn" /> Independent verification — NEEDS REVIEW</>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Badge tone={result.verification.status === "VERIFIED" ? "success" : "warn"}>{result.verification.status}</Badge>
          <p>{result.verification.note}</p>
          {result.verification.checks.length > 0 && (
            <ul className="space-y-1">
              {result.verification.checks.map((c, i) => (
                <li key={i} className={c.passed ? "text-ink/70" : "text-warn font-medium"}>
                  {c.passed ? "✓" : "✗"} {c.name}: {c.detail}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink/40">
            Verification is deterministic (re-computation, numeric substitution, finite differences) — the language model is never the mathematical authority.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
