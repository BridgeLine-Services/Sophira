import { AppShell } from "@/components/app/AppShell";
import { WritingReviewWorkspace } from "@/components/app/WritingReviewWorkspace";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * WRITING -> REVIEW (Stage 3, 2026-11-02).
 *
 * A new route alongside the existing /writing page, which stays untouched. This
 * screen reviews one draft at a time: originality against sources the student
 * supplies, citation hygiene, and explainable writing notes. It writes nothing
 * to the database - the student's decisions live in their browser until they
 * copy a revision into their own draft.
 */
export default async function WritingReviewPage() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) {
    if (guard.response.status === 401) redirect("/login");
    redirect("/access-denied");
  }

  return (
    <AppShell title="Review my writing" backHref="/writing">
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-ink">Review my writing</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Sophira checks your draft for overlap with the sources you give it, missing citations, and writing that is hard to follow.
            It explains every point and asks before changing anything.
          </p>
          <p className="mt-2 text-xs text-ink-soft">
            Looking for your writing samples and long-term style profile? That is on{" "}
            <Link href="/writing" className="underline">the writing page</Link>.
          </p>
        </div>
        <WritingReviewWorkspace />
        <p className="text-xs text-ink-soft">
          Sophira does not run AI-detector checks, does not rewrite your work to evade detection, and cannot promise a similarity score.
          It compares only what you supply and tells you exactly what it found.
        </p>
      </div>
    </AppShell>
  );
}
