"use client";

/**
 * SAVE STATUS (Phase 4C, 2026-11-09) — plain-language save indicator.
 * "Saved" renders ONLY for the server-confirmed phase; a failed or
 * conflicting save always offers a recovery action and never pretends.
 */
import { saveLabel, type SaveSnapshot } from "@/lib/save/state";

export default function SaveStatus({
  snapshot,
  onRetry,
  onKeepMine,
  onUseTheirs,
}: {
  snapshot: SaveSnapshot;
  onRetry?: () => void;
  onKeepMine?: () => void;
  onUseTheirs?: () => void;
}) {
  const label = saveLabel(snapshot);
  if (!label) return null;
  const tone =
    snapshot.phase === "conflict" || snapshot.phase === "error"
      ? "text-warn"
      : snapshot.phase === "saved"
        ? "text-success"
        : "text-ink-soft";
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs" role="status" aria-live="polite">
      <span className={tone} data-save-phase={snapshot.phase}>
        {label}
      </span>
      {snapshot.phase === "conflict" && (
        <>
          <button type="button" className="underline" onClick={onKeepMine}>
            Keep my version
          </button>
          <button type="button" className="underline" onClick={onUseTheirs}>
            Use the other version
          </button>
          <span className="text-ink-soft">Both versions are kept until you choose.</span>
        </>
      )}
      {snapshot.phase === "error" && onRetry && (
        <button type="button" className="underline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
