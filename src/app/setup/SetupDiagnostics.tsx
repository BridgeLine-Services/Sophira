"use client";

import { useState } from "react";
import type { OwnerSetupStatus } from "@/lib/owner-setup";

/**
 * Optional, clearly separated technical diagnostics. The owner account
 * section on /setup never shows this detail; it lives only here.
 */
export default function SetupDiagnostics({ status }: { status: OwnerSetupStatus }) {
  const [show, setShow] = useState(false);
  return (
    <div className="mt-4">
      <button type="button" onClick={() => setShow(!show)} className="text-sm text-ink-soft underline hover:text-ink">
        {show ? "Hide technical diagnostics" : "Show technical diagnostics"}
      </button>
      {show && (
        <div className="mt-4 space-y-3">
          <p className={
            "rounded-lg border p-4 text-sm " +
            (status.ready === true ? "border-success/30 bg-success/5" : status.ready === false ? "border-warn/30 bg-warn/5" : "border-ink/10")
          }>
            {status.headline}
          </p>
          {status.steps.map((step) => (
            <div key={step.label} className={"rounded-lg border p-4 " + (step.done === true ? "border-success/30" : step.done === false ? "border-warn/30" : "border-ink/10")}>
              <div className="flex items-center gap-2 text-sm font-medium">
                <span>{step.done === true ? "✅" : step.done === false ? "⬜" : "❔"}</span>
                <span>{step.label}</span>
              </div>
              <p className="mt-1 pl-7 text-sm leading-relaxed text-ink-soft">{step.detail}</p>
            </div>
          ))}
          {status.guidance.length > 0 && (
            <ol className="list-decimal space-y-1 pl-6 text-sm text-ink-soft">
              {status.guidance.map((g, i) => <li key={i}>{g}</li>)}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
