import { Spinner } from "@/components/ui";

/** Loading state for /flashcards: say what is happening, never show fake content. */
export default function Loading() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4">
      <Spinner />
      <p className="text-sm text-ink-soft">Loading your flashcards…</p>
    </div>
  );
}
