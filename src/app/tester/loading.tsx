import { Spinner } from "@/components/ui";

export default function Loading() {
  return (
    <div className="flex items-center gap-3 p-6 text-sm text-ink-soft">
      <Spinner />
      <p>Opening your testing workspace…</p>
    </div>
  );
}
