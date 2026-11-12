import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

/**
 * The one card in Sophira (re-skinned 2026-11-12).
 *
 * Same exports (Card, CardHeader, CardTitle, CardContent) and same prop shape as
 * before, so every existing import keeps working. The surface now uses the shared
 * panel radius and the per-theme elevation variable instead of a fixed light shadow,
 * which is what made cards look pasted-on in dark mode.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-panel border border-line bg-card shadow-e1", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-3 pt-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5 pt-1", className)} {...props} />;
}
