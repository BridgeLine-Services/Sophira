import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

type Tone = "neutral" | "accent" | "success" | "warn" | "danger";

/**
 * Status chip (re-skinned 2026-11-12). Same `tone` values and the same element that
 * pages already render; it now carries a hairline so a pale tint reads as a chip
 * rather than a smudge of colour on a white card.
 */
const tones: Record<Tone, string> = {
  neutral: "bg-ink/[0.06] text-ink-soft ring-line",
  accent: "bg-accent-soft text-accent ring-accent/20",
  success: "bg-success/10 text-success ring-success/25",
  warn: "bg-warn/10 text-warn ring-warn/25",
  danger: "bg-danger/10 text-danger ring-danger/25",
};

export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-medium ring-1 ring-inset",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}
