"use client";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  // full-state design (2026-10-15): default / hover / pressed / focus /
  // disabled for every variant. Deep indigo hover (not a washed /90),
  // clear pressed feedback, ring focus for keyboards, calm disabled.
  primary: "bg-accent text-white shadow-[0_1px_2px_rgba(37,43,58,0.12)] hover:bg-accent-deep active:bg-accent-deep disabled:bg-accent/40 disabled:shadow-none",
  secondary: "bg-card border border-line text-ink hover:border-accent/40 hover:text-accent active:bg-accent-soft disabled:opacity-50",
  ghost: "text-ink-soft hover:bg-ink/5 hover:text-ink active:bg-ink/10 disabled:opacity-50",
  danger: "bg-card border border-danger/30 text-danger hover:border-danger/50 hover:bg-danger/5 active:bg-danger/10 disabled:opacity-50",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-[15px] gap-2",
  lg: "h-12 px-5 text-base gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
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
