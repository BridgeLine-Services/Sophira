"use client";
import { type ReactNode, useEffect } from "react";
import { Button } from "./Button";

export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", destructive, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      {/* Decorative backdrop: the panel is dismissed by its own controls, so this needs no
          keyboard affordance. */}
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onCancel} aria-hidden="true" />
      <div className="relative w-full max-w-md rounded-panel border border-line bg-card p-6 shadow-e3">
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        <div className="mt-2 text-sm leading-relaxed text-ink-soft">{message}</div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
