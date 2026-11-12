import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Form controls (re-skinned 2026-11-12).
 *
 * The public API is unchanged: the same three components, the same native props, and
 * the same 44px minimum height that keeps every control comfortable on a phone. The
 * only additions are a teal focus state and a hover border, so a form reads as one
 * system instead of a stack of grey boxes.
 */
const base =
  "w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-[15px] text-ink shadow-e1 placeholder:text-ink-soft/60 transition-colors duration-150 ease-calm hover:border-ink-soft/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:bg-ink/5 disabled:shadow-none disabled:text-ink-soft min-h-[44px]";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(base, className)} {...props} />
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(base, "min-h-28 py-3 leading-relaxed", className)} {...props} />
  )
);
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(base, "pr-8", className)} {...props} />
);
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-[13px] font-medium text-ink-soft", className)} {...props} />;
}
