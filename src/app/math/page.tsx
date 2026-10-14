"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Label, Spinner, useToast } from "@/components/ui";
import { MathKeyboard } from "@/components/math/MathKeyboard";
import { PipelineView, type PipelineResult } from "@/components/math/PipelineView";
import { Delete, Lightbulb, Sparkles } from "lucide-react";

/**
 * TYPE TO SOLVE (workflow-separation round, 2026-10-14): this page is the
 * manual-entry workspace ONLY - scan lives at /math/scan. The approved
 * reference layout: "Your problem" card with the Math editor / Plain text
 * segmented control, expression area, Show math keyboard, Solve problem,
 * the Input tips panel, and the in-card math keyboard. One canonical
 * expression string is the single source of truth; switching modes or
 * opening the keyboard NEVER clears it.
 */


function MathTypePageInner() {
  const subjectSlug = useSearchParams().get("subject");
  const teachMode = useSearchParams().get("mode") === "teach";
  const [expr, setExpr] = useState("");
  const [mode, setMode] = useState<"editor" | "plain">("editor");
  const [kbOpen, setKbOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const { toast } = useToast();
  const plainRef = useRef<HTMLTextAreaElement>(null);
  const [mfReady, setMfReady] = useState(false);
  const mfRef = useRef<unknown>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { MathfieldElement } = await import("mathlive");
        if (!alive || typeof window === "undefined") return;
        if (!customElements.get("math-field")) customElements.define("math-field", MathfieldElement);
        setMfReady(true);
      } catch { /* editor falls back to plain text below */ }
    })();
    return () => { alive = false; };
  }, []);

  const latexToCanonicalMod = (v: string): string => {
    // reuse the shared converter (same canonical path as Scan + keyboard)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fn = (window as unknown as { __latexToCanonical?: (s: string) => string }).__latexToCanonical;
    return fn ? fn(v) : v;
  };

  const solve = async () => {
    if (!expr.trim()) { toast("error", "Type the problem first."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/math/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expression: expr, mode: teachMode ? "teach" : "solve", ...(subjectSlug ? { subject: subjectSlug } : {}) }),
      });
      const json = await res.json();
      if (!res.ok || !json.result) { toast("error", json.error ?? "Failed."); return; }
      setResult(json.result as PipelineResult);
      if (json.result.status === "NEEDS REVIEW") toast("error", "Marked NEEDS REVIEW — see the verification section.");
      else toast("success", "Solved and independently verified.");
    } catch {
      toast("error", "Could not reach the solver — your expression is preserved.");
    } finally {
      setBusy(false);
    }
  };

  /** Keyboard insertion routes to the ACTIVE field: the math editor (as a
   * MathLive insert command, preserving cursor/selection) or the plain-text
   * textarea at its cursor/selection. Never a blind string append. */
  const insertToken = (token: string) => {
    if (mode === "editor" && mfReady) {
      const mf = mfRef.current as { executeCommand?: (c: unknown) => void } | null;
      if (mf?.executeCommand) { mf.executeCommand(["insert", token]); return; }
    }
    const ta = plainRef.current;
    if (!ta) { setExpr((e) => e + token); return; }
    const s = ta.selectionStart ?? expr.length;
    const e = ta.selectionEnd ?? s;
    const next = expr.slice(0, s) + token + expr.slice(e);
    setExpr(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = s + token.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  return (
    <AppShell title="Math • Type to Solve">
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold">Type a math problem</h1>
        <p className="text-sm text-ink/60">Enter an expression, equation, or word problem. Choose the input style that works for you.</p>

        <div className="flex gap-4">
          <div className="min-w-0 flex-1 space-y-4">
            <Card>
              <CardHeader><CardTitle>Your problem</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="inline-flex rounded-lg border border-ink/10 p-1" role="tablist" aria-label="Input mode">
                  <button type="button" role="tab" aria-selected={mode === "editor"}
                    onClick={() => setMode("editor")}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "editor" ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-ink/5"}`}>
                    Math editor
                  </button>
                  <button type="button" role="tab" aria-selected={mode === "plain"}
                    onClick={() => setMode("plain")}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "plain" ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-ink/5"}`}>
                    Plain text
                  </button>
                </div>

                {mode === "editor" && mfReady ? (
                  <math-field
                    ref={(el: unknown) => { mfRef.current = el; }}
                    aria-label="Math expression editor"
                    className="block w-full rounded-lg border border-ink/15 bg-white p-3 text-lg"
                    style={{ minHeight: "6rem" }}
                    onInput={(e: unknown) => {
                      const el = e as { target?: { value?: string } };
                      const v = el.target?.value;
                      if (typeof v === "string") setExpr(latexToCanonicalMod(v));
                    }}
                  />
                ) : (
                  <textarea
                    ref={plainRef}
                    value={expr}
                    onChange={(e) => setExpr(e.target.value)}
                    aria-label="Math expression in plain text"
                    placeholder="e.g. 2x + 5 = 17"
                    className="block w-full rounded-lg border border-ink/15 bg-white p-3 text-lg"
                    rows={3}
                  />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="secondary" onClick={() => setKbOpen((o) => !o)}>{kbOpen ? "Hide math keyboard" : "Show math keyboard"}</Button>
                  <Button onClick={solve} disabled={busy || !expr.trim()}>
                    {busy ? <Spinner /> : <><Sparkles className="mr-1 h-4 w-4" /> Solve problem</>}
                  </Button>
                </div>
                <p className="text-xs text-ink/50">Switching input styles keeps your work. You can change modes at any time.</p>

                {kbOpen && <MathKeyboard onInsert={insertToken} onClose={() => setKbOpen(false)} />}
              </CardContent>
            </Card>

            {result && <PipelineView result={result} confirming={false} onConfirmChange={() => {}} onConfirm={() => {}} />}
          </div>

          <div className="hidden w-72 shrink-0 lg:block">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="h-4 w-4" /> Input tips</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm text-ink/70">
                <p>Math editor: fractions, powers, roots and integrals</p>
                <p>Plain text: type naturally, e.g. 2x + 5 = 17</p>
                <p>Your expression stays intact when you switch modes.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default function MathTypePage() {
  return (
    <Suspense>
      <MathTypePageInner />
    </Suspense>
  );
}
