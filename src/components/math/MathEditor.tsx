"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { Keyboard } from "lucide-react";
import { latexToCanonical } from "@/lib/math/latex";

/**
 * Structured math editor (2026-10-14): MathLive mathfield with the
 * on-screen virtual math keyboard (fractions, exponents, roots, integrals,
 * trig, greek - STRUCTURED insertion, not unicode string appends). The
 * editor's LaTeX is converted to the SAME canonical plain syntax used by
 * OCR and plain typing, so every input method hits one solver.
 * A plain-text input stays available (toggle) for fast typists.
 */
export function MathEditor({ onCanonicalChange }: { onCanonicalChange: (canonical: string) => void }) {
  const fieldHost = useRef<HTMLDivElement>(null);
  const mf = useRef<{ value: string; getValue: (f: string) => string; executeCommand: (c: unknown) => void; addEventListener: (e: string, cb: () => void) => void } | null>(null);
  const [ready, setReady] = useState(false);
  const [kbVisible, setKbVisible] = useState(false);
  const [plainMode, setPlainMode] = useState(false);
  const [plain, setPlain] = useState("");
  const [preview, setPreview] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { MathfieldElement } = await import("mathlive");
      if (!customElements.get("math-field") && !cancelled) {
        customElements.define("math-field", MathfieldElement as never);
      }
      if (cancelled) return;
      const host = fieldHost.current;
      if (!host) return;
      host.innerHTML = "<math-field style=\"width:100%;min-height:56px\" aria-label=\"Math problem editor\"></math-field>";
      const el = host.firstElementChild as unknown as NonNullable<typeof mf.current>;
      el.executeCommand(["setVirtualKeyboardMode" as never, "manual" as never]);
      el.addEventListener("input", () => {
        const canonical = latexToCanonical(el.getValue("latex"));
        setPreview(canonical);
        onCanonicalChange(canonical);
      });
      mf.current = el;
      setReady(true);
    })();
    return () => { cancelled = true; mf.current = null; };
  }, [onCanonicalChange]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={kbVisible ? "primary" : "secondary"} disabled={!ready}
          onClick={() => { setKbVisible((v) => !v); mf.current?.executeCommand(["toggleVirtualKeyboard"]); }}>
          <Keyboard className="h-4 w-4" /> {kbVisible ? "Hide math keyboard" : "Show math keyboard"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setPlainMode((v) => !v)}>
          {plainMode ? "Use math editor" : "Type plain text instead"}
        </Button>
      </div>
      {plainMode ? (
        <input
          className="w-full rounded border border-ink/15 bg-white px-3 py-2 font-mono text-sm"
          value={plain}
          placeholder="e.g. ∫ 3x^2 dx, x^2 - 5x + 6 = 0"
          aria-label="Plain math input"
          onChange={(e) => { setPlain(e.target.value); setPreview(e.target.value); onCanonicalChange(e.target.value); }}
        />
      ) : (
        <div ref={fieldHost} aria-live="polite" />
      )}
      {preview && (
        <p className="text-xs text-ink/60">
          Read as: <span className="font-mono">{preview}</span>
        </p>
      )}
    </div>
  );
}
