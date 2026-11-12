"use client";

import { Cloud, Server, Laptop } from "lucide-react";

/**
 * Where this answer was written (2026-11-11).
 *
 * Local AI is the primary engine, so a member is entitled to know when an answer
 * came from somewhere else — that is the one moment their work left their own
 * machines. The answer row records the engine that actually replied (migration
 * 0046); rows written before that carry no record, and this says exactly that
 * instead of assuming either way.
 */
export default function AnswerProvenance({
  provider,
  model,
}: {
  provider: "selfhost" | "gemini" | "openai" | "local" | null | undefined;
  model: string | null;
}) {
  if (provider === "selfhost" || provider === "local") {
    return (
      <p className="mt-4 flex items-start gap-2 rounded-md bg-ink/[0.04] px-3 py-2 text-xs text-ink-soft">
        <Server className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Written {provider === "local" ? "on this device" : "on your own server"}
          {model ? ` (${model})` : ""}. Nothing in this answer was sent to a cloud service.
        </span>
      </p>
    );
  }
  if (provider === "gemini" || provider === "openai") {
    return (
      <p className="mt-4 flex items-start gap-2 rounded-md border border-warn/30 bg-warn/[0.07] px-3 py-2 text-xs text-ink">
        <Cloud className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Your own inference server was not available, so this answer came from a cloud service
          {model ? ` (${model})` : ""}. The question and context for this assignment were sent to it.
        </span>
      </p>
    );
  }
  return (
    <p className="mt-4 flex items-start gap-2 rounded-md bg-ink/[0.04] px-3 py-2 text-xs text-ink-soft">
      <Laptop className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        This answer predates the record of where it was written, so Sophira will not claim either way.
        New answers show their source here.
      </span>
    </p>
  );
}
