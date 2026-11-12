import LocalDateTime from "./LocalDateTime";
import {
  rubricPointsTotal,
  safeCanvasUrl,
  submissionTypeLabel,
  type CanvasAssignmentContext as Context,
} from "@/lib/integrations/canvas-rubric";

/**
 * WHAT THE TEACHER ASKED FOR (Phase 4, 2026-11-02).
 *
 * Rubric, points, submission type and attachments come from Canvas and are shown here for
 * the first time. Every line states where it came from: Sophira has not added requirements,
 * invented grading criteria, or guessed what the teacher wants.
 *
 * Attachments are listed, not fetched: the sync stores their names only. Saying so is the
 * honest option, and it is what stops a student assuming a file is available offline.
 */
export default function CanvasAssignmentContext({ context }: { context: Context }) {
  const total = rubricPointsTotal(context.criteria);
  const canvasUrl = safeCanvasUrl(context.htmlUrl);

  return (
    <section aria-labelledby="canvas-context-heading" className="mb-6 rounded-xl border bg-card p-5">
      <h2 id="canvas-context-heading" className="text-base font-semibold text-ink">
        From your Canvas course
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        These details came from Canvas. Sophira has not changed them or added any requirements of its own.
      </p>

      {context.syncState === "missing" && (
        <p className="mt-3 rounded-lg border border-dashed p-3 text-sm text-ink-soft">
          Canvas no longer lists this assignment, so your teacher may have removed it. Your work is still saved here.
        </p>
      )}

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="meta-strong">Due</dt>
          <dd className="mt-1 text-sm text-ink">
            {context.dueAt ? <LocalDateTime iso={context.dueAt} /> : "No due date was set in Canvas"}
          </dd>
        </div>
        <div>
          <dt className="meta-strong">Worth</dt>
          <dd className="mt-1 text-sm text-ink">
            {context.pointsPossible !== null
              ? `${context.pointsPossible} point${context.pointsPossible === 1 ? "" : "s"}`
              : "Your teacher did not set a point value"}
          </dd>
        </div>
        <div>
          <dt className="meta-strong">How you turn it in</dt>
          <dd className="mt-1 text-sm text-ink">
            {context.submissionTypes.length > 0
              ? context.submissionTypes.map(submissionTypeLabel).join(" or ")
              : "Canvas did not say how this is submitted"}
          </dd>
        </div>
      </dl>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-ink">How your teacher will grade this</h3>
        {context.criteria.length === 0 ? (
          <p className="mt-1 text-sm text-ink-soft">
            Your teacher did not add a grading rubric to this assignment in Canvas, so there is nothing more to show here.
          </p>
        ) : (
          <>
            {total !== null && (
              <p className="mt-1 text-sm text-ink-soft">
                {context.criteria.length} criterion{context.criteria.length === 1 ? "" : "a"} worth {total} point
                {total === 1 ? "" : "s"} in total.
              </p>
            )}
            <ul className="mt-3 space-y-3">
              {context.criteria.map((criterion) => (
                <li key={criterion.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-ink">{criterion.description}</p>
                    <p className="text-xs text-ink-soft">
                      {criterion.points !== null ? `${criterion.points} point${criterion.points === 1 ? "" : "s"}` : "No point value given"}
                    </p>
                  </div>
                  {criterion.longDescription && (
                    <p className="mt-1 text-sm text-ink-soft">{criterion.longDescription}</p>
                  )}
                  {criterion.ratings.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t pt-2">
                      {criterion.ratings.map((rating, index) => (
                        <li key={`${criterion.id}-rating-${index}`} className="text-xs text-ink-soft">
                          <span className="font-medium text-ink">{rating.description}</span>
                          {rating.points !== null ? ` (${rating.points} point${rating.points === 1 ? "" : "s"})` : ""}
                          {rating.longDescription ? `: ${rating.longDescription}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {context.attachmentNames.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-ink">Files your teacher attached in Canvas</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-soft">
            {context.attachmentNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-soft">
            Canvas lists these files. Sophira has not downloaded them, so open them in Canvas to read them.
          </p>
        </div>
      )}

      {canvasUrl && (
        <a
          href={canvasUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-5 inline-block text-sm text-accent hover:underline"
        >
          Open this assignment in Canvas
        </a>
      )}
    </section>
  );
}
