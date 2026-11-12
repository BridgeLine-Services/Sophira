import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

/**
 * Empty state (re-skinned 2026-11-12). Unchanged props and copy; the icon now sits in a
 * soft accent disc so an empty panel says "nothing here yet, and that is fine" instead of
 * looking like a failed load.
 */
export function EmptyState({ icon, title, description, action, className }: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-panel border border-dashed border-line bg-card-elevated/40 px-6 py-12 text-center", className)}>
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
          {icon}
        </div>
      )}
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-soft">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
