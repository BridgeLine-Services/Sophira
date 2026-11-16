import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";
import { canUseTesterFeatures } from "@/lib/auth/permissions";
import { normalizeRole } from "@/lib/roles";
import { needsDatabaseUpdate } from "@/lib/supabase/missing-object";
import { DatabaseUpdateNotice } from "@/components/system/DatabaseUpdateNotice";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Card, CardContent } from "@/components/ui";
import { RecordResult } from "@/components/tester/RecordResult";
import { fmtDate } from "@/lib/format";
import {
  OUTCOME_LABEL,
  buildLibrary,
  runOrder,
  type LibraryEntry,
  type TestCaseRow,
  type TestResultRow,
} from "@/lib/tester/test-library";

export const dynamic = "force-dynamic";

/**
 * THE TEST LIBRARY (2026-11-16).
 *
 * The tester's numbered list of tests, what each one expects, and what happened the last time it was
 * run. Before this, every round of testing started from nothing: the same screens were re-tested and
 * others were never touched, so "does this still work?" had no answer.
 *
 * What it will not do:
 *   - call a test nobody has run a pass. Never-run is its own count, and the headline says so.
 *   - fold "could not run" into either side. A tester with no account or no key says so, and that is
 *     kept as its own fact about the environment.
 *   - hide a regression. Each test keeps its previous outcome, so "failed now, passed before" is
 *     visible as a sentence at the top rather than something somebody has to remember.
 *
 * All judgement lives in src/lib/tester/test-library.ts, which is tested without a browser. This
 * file reads rows through the user's own client, so migration 0061's policies decide what a tester
 * sees: their own results, and the list.
 */
const STATE_TONE: Record<string, "neutral" | "success" | "danger" | "warn"> = {
  passed: "success",
  failed: "danger",
  blocked: "warn",
  skipped: "neutral",
  "never-run": "neutral",
};

function EntryCard({ entry }: { entry: LibraryEntry }) {
  const { testCase, state, lastResult, previousOutcome, regression, fixed, attempts } = entry;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="meta-strong">{testCase.code}</span>
            <span className="text-sm font-medium text-ink">{testCase.title}</span>
          </p>
          <Badge tone={STATE_TONE[state] ?? "neutral"}>{OUTCOME_LABEL[state as keyof typeof OUTCOME_LABEL] ?? "Never run"}</Badge>
        </div>

        {testCase.steps ? (
          <p className="mt-2 text-sm text-ink-soft">
            <span className="font-medium text-ink">Do this: </span>
            {testCase.steps}
          </p>
        ) : null}
        {testCase.expected ? (
          <p className="mt-1 text-sm text-ink-soft">
            <span className="font-medium text-ink">Should happen: </span>
            {testCase.expected}
          </p>
        ) : null}

        {regression ? (
          <p className="mt-2 text-sm font-medium text-danger">
            This used to pass. It failed the last time it was run.
          </p>
        ) : null}
        {fixed ? <p className="mt-2 text-sm text-success">This failed before and passes now.</p> : null}

        <p className="mt-2 meta text-ink-soft">
          {lastResult
            ? `${attempts} recorded ${attempts === 1 ? "attempt" : "attempts"} · last on ${fmtDate(lastResult.created_at)}${
                previousOutcome ? ` · before that: ${OUTCOME_LABEL[previousOutcome].toLowerCase()}` : ""
              }`
            : "Nobody has run this yet."}
        </p>

        {lastResult?.notes ? (
          <p className="mt-1 text-sm text-ink-soft">Last note: {lastResult.notes}</p>
        ) : null}

        <RecordResult testCaseId={testCase.id} code={testCase.code} />
      </CardContent>
    </Card>
  );
}

export default async function TesterTestsPage() {
  const supabase = createClient();
  const user = await requireUser(supabase);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, display_name")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !canUseTesterFeatures(profile.role)) redirect("/dashboard");

  const [casesResult, resultsResult] = await Promise.all([
    supabase
      .from("qa_test_cases")
      .select("id, code, title, area, steps, expected, severity, is_active, sort_order")
      .order("sort_order", { ascending: true })
      .limit(500),
    supabase
      .from("qa_test_results")
      .select("id, test_case_id, outcome, notes, reported_by, created_at")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  if (needsDatabaseUpdate(casesResult.error) || needsDatabaseUpdate(resultsResult.error)) {
    return (
      <AppShell subtitle="The numbered list of tests, and what happened last time each was run." title="Test library" role={profile.role}>
        <DatabaseUpdateNotice
          feature="the test library"
          error={casesResult.error ?? resultsResult.error}
          canUpdate={normalizeRole(profile.role) === "owner"}
        />
      </AppShell>
    );
  }

  const readFailed = casesResult.error ? "The list of tests" : resultsResult.error ? "The recorded results" : null;
  const cases = casesResult.error ? null : ((casesResult.data ?? []) as TestCaseRow[]);
  const results = resultsResult.error ? null : ((resultsResult.data ?? []) as TestResultRow[]);
  const library = buildLibrary(cases, results);
  const ordered = runOrder(library.entries);
  const areas = Array.from(new Set(ordered.map((e) => String(e.testCase.area ?? "").trim() || "Unfiled"))).sort((a, b) =>
    a.localeCompare(b),
  );

  return (
    <AppShell subtitle="The numbered list of tests, and what happened last time each was run." title="Test library" role={profile.role}>
      <div className="dash-page">
        <div className="dash-stack">
          <div className="dash-hero">
            <p className="dash-eyebrow">Test library</p>
            <h2 className="dash-hero-title mt-1">What to test, and what happened last time</h2>
            <p className="dash-hero-sub mt-2 max-w-2xl">
              Each numbered test says what to do and what should happen, so two testers get the same answer. Recording a
              result keeps the history: that is how a regression is noticed instead of remembered.
            </p>
          </div>

          <div className="space-y-6">
            <p className="text-sm">
              <Link href="/tester" className="text-accent hover:underline">
                &larr; Back to your reports
              </Link>
            </p>

            {readFailed ? (
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm font-medium text-danger">{readFailed} could not be read just now.</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Nothing below is a count of what was tested, because part of the picture is missing. Reload in a
                    moment; if it keeps happening, tell an owner.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardContent className="p-4">
                <h3 className="meta-strong">Where the library stands</h3>
                <p className="mt-1 text-sm text-ink">{library.headline}</p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Tests in the run", value: library.summary.active, note: `${library.summary.retired} retired` },
                    { label: "Passing", value: library.summary.passed, note: library.summary.passRate === null ? "nothing could be run" : `${Math.round(library.summary.passRate * 100)}% of those run` },
                    { label: "Failing", value: library.summary.failed, note: `${library.summary.regressions} used to pass` },
                    { label: "Never run", value: library.summary.neverRun, note: `${library.summary.blocked} could not run` },
                  ].map((s) => (
                    <div key={s.label}>
                      <p className="meta-strong">{s.label}</p>
                      <p className="mt-0.5 text-2xl font-semibold text-ink">{s.value}</p>
                      <p className="text-xs text-ink-soft">{s.note}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {library.regressions.length > 0 ? (
              <Card>
                <CardContent className="p-4">
                  <h3 className="meta-strong">These used to pass</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {library.regressions.map((e) => (
                      <li key={e.testCase.id}>
                        <span className="font-medium text-ink">{e.testCase.code}</span>{" "}
                        <span className="text-ink-soft">{e.testCase.title}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm text-ink-soft">
                    A report for each of these is worth filing, so the fix has a record.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {library.areas.length > 0 ? (
              <Card>
                <CardContent className="p-4">
                  <h3 className="meta-strong">By area</h3>
                  <ul className="mt-2 divide-y divide-line">
                    {library.areas.map((a) => (
                      <li key={a.area} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                        <span className="font-medium text-ink">{a.area}</span>
                        <span className="text-ink-soft">
                          {a.passed} passing · {a.failed} failing · {a.neverRun} never run
                          {a.blocked > 0 ? ` · ${a.blocked} could not run` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            {ordered.length === 0 ? (
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-ink">There are no tests in the library yet.</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    An owner or co-owner can add the first ones. Until then there is nothing to run, and that is said
                    rather than shown as a clean pass.
                  </p>
                </CardContent>
              </Card>
            ) : (
              areas.map((area) => (
                <section key={area} aria-labelledby={`area-${area}`}>
                  <h3 id={`area-${area}`} className="meta-strong mb-2">
                    {area}
                  </h3>
                  <div className="space-y-3">
                    {ordered
                      .filter((e) => (String(e.testCase.area ?? "").trim() || "Unfiled") === area)
                      .map((entry) => (
                        <EntryCard key={entry.testCase.id} entry={entry} />
                      ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
