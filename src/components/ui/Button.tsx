"use client";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/**
 * The one button in Sophira (re-skinned 2026-11-12).
 *
 * The public contract is unchanged - same props, same four variants, same three
 * sizes, same defaults - because 80 pages already depend on it. Only the surface
 * treatment moved: a calmer primary with an accent-tinted elevation, a card-weight
 * secondary, and a 1px focus offset that stays visible on every background.
 */
const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent shadow-e1 shadow-accent hover:bg-accent-deep active:bg-accent-deep disabled:bg-accent/40 disabled:shadow-none",
  secondary:
    "bg-card border border-line text-ink shadow-e1 hover:border-accent/50 hover:text-accent active:bg-accent-soft disabled:opacity-50 disabled:shadow-none",
  ghost:
    "text-ink-soft hover:bg-ink/[0.06] hover:text-ink active:bg-ink/10 disabled:opacity-50",
  danger:
    "bg-card border border-danger/35 text-danger shadow-e1 hover:border-danger/60 hover:bg-danger/[0.06] active:bg-danger/10 disabled:opacity-50 disabled:shadow-none",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-11 px-4 text-[15px] gap-2 rounded-xl",
  lg: "h-12 px-5 text-base gap-2 rounded-xl",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium",
        "transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-calm",
        "disabled:cursor-not-allowed active:scale-[0.99]",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
