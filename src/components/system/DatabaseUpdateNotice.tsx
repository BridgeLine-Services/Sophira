import Link from "next/link";
import { Card, CardContent } from "@/components/ui";
import { type PostgrestErrorLike, missingObjectSentence } from "@/lib/supabase/missing-object";

/**
 * "THIS PAGE NEEDS A DATABASE UPDATE" (2026-11-12).
 *
 * Shown instead of a confident empty list when a page asked the database for something it
 * has not been given yet. A Server Component with no client JavaScript: it renders inside
 * whichever page hit the condition, and it never offers an action it cannot perform.
 *
 * The wording obeys three rules:
 *   1. Say what happened in the reader's terms, not the driver's.
 *   2. Say nothing was lost, because a missing table holds no rows to lose.
 *   3. Give the Owner the exact presses, in order, and say that repeating it is safe -
 *      this is the one person who can fix it, and only they can.
 */
export function DatabaseUpdateNotice({
  feature,
  error,
  canUpdate = false,
}: {
  /** What the page was trying to read, in plain English ("your QA reports"). */
  feature: string;
  /** The read error, so the small print can name what is missing. */
  error?: PostgrestErrorLike | null;
  /** True only when the reader is an Owner, who is the one person who can fix it. */
  canUpdate?: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-ink">This page needs a database update</h2>
          <p className="text-sm text-ink-soft">
            Sophira asked for {feature}, and that part of the database has not been created yet.
            Nothing has been lost, and nothing here is wrong: it simply cannot be read until the
            update is in place.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">
            {canUpdate ? "It takes about a minute, and you can do it from here:" : "An Owner can fix this in about a minute:"}
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
            <li>
              {canUpdate ? (
                <Link className="underline" href="/owner">Open your Owner dashboard</Link>
              ) : (
                "Ask the Owner to open their Owner dashboard"
              )}
            </li>
            <li>Choose Database.</li>
            <li>Press Update database, and leave the page open until it says it has finished.</li>
            <li>Come back to this page and press refresh.</li>
          </ol>
        </div>

        <p className="text-sm text-ink-soft">
          The update only adds things; it never deletes or changes what is already there, and
          pressing it twice is safe.
        </p>

        <p className="text-xs text-ink-soft">{missingObjectSentence(error)}</p>
      </CardContent>
    </Card>
  );
}
