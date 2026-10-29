"use client";
/**
 * The approved in-card math keyboard (2026-10-14): a compact grid of keys that
 * inserts REAL mathematical tokens into the active field via the parent's
 * onInsert - never a blind string append on a detached state variable.
 * Visual language follows the existing design tokens (soft borders, white
 * keys, rounded corners).
 */
import { X } from "lucide-react";

export function MathKeyboard({ onInsert, onClose }: { onInsert: (token: string) => void; onClose: () => void }) {
  const keys: Array<{ t: string; v: string }> = [
    { t: "7", v: "7" }, { t: "8", v: "8" }, { t: "9", v: "9" }, { t: "÷", v: "/" },
    { t: "4", v: "4" }, { t: "5", v: "5" }, { t: "6", v: "6" }, { t: "×", v: "*" },
    { t: "1", v: "1" }, { t: "2", v: "2" }, { t: "3", v: "3" }, { t: "−", v: "-" },
    { t: "0", v: "0" }, { t: ".", v: "." }, { t: "=", v: "=" }, { t: "+", v: "+" },
    { t: "x", v: "x" }, { t: "y", v: "y" }, { t: "(", v: "(" }, { t: ")", v: ")" },
    { t: "x²", v: "^2" }, { t: "^", v: "^" }, { t: "√", v: "sqrt(" }, { t: "∫", v: "∫" },
    { t: "dx", v: "dx" }, { t: "π", v: "pi" }, { t: "e", v: "e" }, { t: "ln", v: "ln(" },
    { t: "sin", v: "sin(" }, { t: "cos", v: "cos(" }, { t: "tan", v: "tan(" }, { t: "⌫", v: "\b" },
  ];
  return (
    <div className="rounded-lg border border-line bg-card p-3" role="group" aria-label="Math keyboard">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-ink/60">Keyboard is open</span>
        <button type="button" onClick={onClose} aria-label="Close math keyboard" className="rounded p-1 text-ink/50 hover:bg-ink/5">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {keys.map((k) => (
          <button
            key={k.t}
            type="button"
            aria-label={`Insert ${k.t}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(k.v)}
            className="rounded-md border border-line bg-card px-2 py-2 text-sm font-medium text-ink hover:bg-accent-soft hover:text-accent"
          >
            {k.t}
          </button>
        ))}
      </div>
    </div>
  );
}
