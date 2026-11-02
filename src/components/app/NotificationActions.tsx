"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Mark-as-read controls (2026-11-02). Plain-language only: no status codes, no IDs shown,
 * and a failure says the member's list is unchanged rather than leaking an API error.
 */
export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const markAll = async () => {
    setError("");
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_all_read" }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("Sophira couldn't update your notifications just now. Please try again.");
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <div>
      <button
        type="button"
        onClick={markAll}
        disabled={disabled || pending}
        className="rounded-lg border px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-50"
      >
        {pending ? "Marking…" : "Mark all as read"}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-ink-soft">{error}</p>}
    </div>
  );
}

export function MarkReadButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const markOne = async () => {
    setError("");
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_read", id }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("Sophira couldn't update that notification just now.");
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <div>
      <button
        type="button"
        onClick={markOne}
        disabled={pending}
        className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
      >
        {pending ? "Saving…" : "Mark as read"}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-ink-soft">{error}</p>}
    </div>
  );
}
