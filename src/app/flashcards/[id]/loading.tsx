import { Spinner } from "@/components/ui";

/** Loading state for one deck. Words, not a fake skeleton. */
export default function Loading() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4">
      <Spinner />
      <p className="text-sm text-ink-soft">Opening this deck…</p>
    </div>
  );
}
