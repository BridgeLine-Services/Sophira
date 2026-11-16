/**
 * THE TEST LIBRARY, READ HONESTLY (2026-11-16).
 *
 * A numbered list of tests is only worth having if its numbers are true. Two ways it could lie,
 * both prevented here:
 *
 *   1. Counting "not run" as fine. A test nobody has run is not a passing test: it is reported as
 *      never run, in its own count, and it is excluded from every pass rate.
 *   2. Counting "blocked" as a failure, or as a pass. Blocked means the test could not be run at all
 *      (no account, no key). That is a fact about the environment, not about Sophira, so it is kept
 *      separate and never folded into either side.
 *
 * What this adds beyond a count is HISTORY. A regression exists only by comparing attempts, so every
 * case carries its latest result and the one before it, and the summary names the cases that went
 * from passing to failing. That is the sentence a tester needs: "these three used to work".
 *
 * PURE: no database, no React, no clock. Rows arrive from a server component that has already had
 * row level security applied; this module only arranges them.
 */

export type TestOutcome = "passed" | "failed" | "blocked" | "skipped";

/** The four outcomes, worst first, which is the order a reader needs them in. */
export const OUTCOME_ORDER: TestOutcome[] = ["failed", "blocked", "skipped", "passed"];

export const OUTCOME_LABEL: Record<TestOutcome, string> = {
  passed: "Passed",
  failed: "Failed",
  blocked: "Could not run",
  skipped: "Not run",
};

export type TestCaseRow = {
  id: string;
  code: string;
  title: string;
  area: string;
  steps?: string | null;
  expected?: string | null;
  severity: string;
  is_active?: boolean | null;
  sort_order?: number | null;
};

export type TestResultRow = {
  id: string;
  test_case_id: string;
  outcome: string;
  notes?: string | null;
  reported_by?: string | null;
  created_at: string;
};

/** A case plus what happened to it. `state` is "never-run" until somebody records something. */
export type LibraryEntry = {
  testCase: TestCaseRow;
  state: TestOutcome | "never-run";
  lastResult: TestResultRow | null;
  previousOutcome: TestOutcome | null;
  /** Failed now, passed the attempt before. */
  regression: boolean;
  /** Passed now, failed the attempt before. */
  fixed: boolean;
  attempts: number;
};

export type AreaSummary = {
  area: string;
  total: number;
  neverRun: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  regressions: number;
};

export type LibrarySummary = {
  cases: number;
  /** Cases counted in a run: active only. A retired test is history, not work. */
  active: number;
  retired: number;
  run: number;
  neverRun: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  regressions: number;
  fixed: number;
  /** Passed as a share of the tests that were run and could run, or null when none could. */
  passRate: number | null;
};

export type Library = {
  entries: LibraryEntry[];
  summary: LibrarySummary;
  areas: AreaSummary[];
  /** Cases that failed this time and passed last time, worst severity first. */
  regressions: LibraryEntry[];
  clean: boolean;
  headline: string;
};

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function asOutcome(value: unknown): TestOutcome | null {
  const v = String(value ?? "").toLowerCase();
  return v === "passed" || v === "failed" || v === "blocked" || v === "skipped" ? v : null;
}

function bySeverityThenCode(a: LibraryEntry, b: LibraryEntry): number {
  const sa = SEVERITY_RANK[String(a.testCase.severity ?? "").toLowerCase()] ?? 9;
  const sb = SEVERITY_RANK[String(b.testCase.severity ?? "").toLowerCase()] ?? 9;
  if (sa !== sb) return sa - sb;
  return a.testCase.code.localeCompare(b.testCase.code);
}

function byCode(a: LibraryEntry, b: LibraryEntry): number {
  return a.testCase.code.localeCompare(b.testCase.code);
}

/**
 * The library, with each case's latest and previous outcome.
 *
 * An unreadable timestamp sorts last rather than first, so a malformed row can never make an old
 * failure look like the newest fact.
 */
export function buildLibrary(
  cases: readonly TestCaseRow[] | null,
  results: readonly TestResultRow[] | null,
): Library {
  if (!cases) {
    return {
      entries: [],
      summary: {
        cases: 0, active: 0, retired: 0, run: 0, neverRun: 0, passed: 0, failed: 0, blocked: 0,
        skipped: 0, regressions: 0, fixed: 0, passRate: null,
      },
      areas: [],
      regressions: [],
      clean: false,
      headline: "The test list could not be read, so nothing can be said about it.",
    };
  }

  const byCase = new Map<string, TestResultRow[]>();
  for (const row of results ?? []) {
    const key = String(row.test_case_id ?? "");
    if (!key) continue;
    const list = byCase.get(key);
    if (list) list.push(row);
    else byCase.set(key, [row]);
  }
  for (const list of byCase.values()) {
    list.sort((a, b) => {
      const ta = Date.parse(a.created_at);
      const tb = Date.parse(b.created_at);
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    });
  }

  const entries: LibraryEntry[] = cases.map((testCase) => {
    const history = byCase.get(testCase.id) ?? [];
    const last = history[0] ?? null;
    const previous = history[1] ? asOutcome(history[1].outcome) : null;
    const state = last ? asOutcome(last.outcome) : null;
    return {
      testCase,
      state: state ?? "never-run",
      lastResult: last,
      previousOutcome: previous,
      regression: state === "failed" && previous === "passed",
      fixed: state === "passed" && previous === "failed",
      attempts: history.length,
    };
  });

  const activeEntries = entries.filter((e) => e.testCase.is_active !== false);
  const count = (list: readonly LibraryEntry[], state: LibraryEntry["state"]) =>
    list.filter((e) => e.state === state).length;

  const passed = count(activeEntries, "passed");
  const failed = count(activeEntries, "failed");
  const blocked = count(activeEntries, "blocked");
  const skipped = count(activeEntries, "skipped");
  const neverRun = count(activeEntries, "never-run");
  const run = activeEntries.length - neverRun;
  const couldRun = passed + failed;

  const areaOf = (entry: LibraryEntry) => String(entry.testCase.area ?? "").trim() || "Unfiled";
  const areaNames = Array.from(new Set(activeEntries.map(areaOf))).sort((a, b) => a.localeCompare(b));
  const areas: AreaSummary[] = areaNames.map((area) => {
    const inArea = activeEntries.filter((e) => areaOf(e) === area);
    return {
      area,
      total: inArea.length,
      neverRun: count(inArea, "never-run"),
      passed: count(inArea, "passed"),
      failed: count(inArea, "failed"),
      blocked: count(inArea, "blocked"),
      skipped: count(inArea, "skipped"),
      regressions: inArea.filter((e) => e.regression).length,
    };
  });

  const regressions = entries.filter((e) => e.regression).sort(bySeverityThenCode);
  const summary: LibrarySummary = {
    cases: entries.length,
    active: activeEntries.length,
    retired: entries.length - activeEntries.length,
    run,
    neverRun,
    passed,
    failed,
    blocked,
    skipped,
    regressions: regressions.length,
    fixed: activeEntries.filter((e) => e.fixed).length,
    // Deliberately not "passed / active": a test nobody ran must not count as a pass, and a blocked
    // test says nothing about Sophira either way.
    passRate: couldRun === 0 ? null : passed / couldRun,
  };

  const clean = failed === 0 && neverRun === 0 && blocked === 0 && skipped === 0;

  let headline: string;
  if (summary.active === 0) {
    headline = "The test list is empty. Nothing has been written to run yet.";
  } else if (regressions.length > 0) {
    headline = `${regressions.length} test${regressions.length === 1 ? "" : "s"} that used to pass ${
      regressions.length === 1 ? "is" : "are"
    } failing now.`;
  } else if (failed > 0) {
    headline = `${failed} of ${couldRun} tests that could be run ${
      failed === 1 ? "is" : "are"
    } failing. ${regressions.length === 0 ? "Nothing that used to pass has broken." : ""}`.trim();
  } else if (neverRun > 0) {
    headline = `${passed} passing, and ${neverRun} of ${summary.active} never run. That is not the same as ${summary.active} passes.`;
  } else if (blocked > 0 || skipped > 0) {
    headline = `${passed} passing. ${blocked + skipped} could not be run here, which is not a pass either.`;
  } else if (clean) {
    headline = `All ${passed} tests pass, and every one of them has been run.`;
  } else {
    headline = `${passed} passing.`;
  }

  return { entries, summary, areas, regressions, clean, headline };
}

/** The active list in run order: by area, then the order staff put them in, then the code. */
export function runOrder(entries: readonly LibraryEntry[]): LibraryEntry[] {
  return [...entries]
    .filter((e) => e.testCase.is_active !== false)
    .sort((a, b) => {
      const aa = String(a.testCase.area ?? "").trim() || "Unfiled";
      const ba = String(b.testCase.area ?? "").trim() || "Unfiled";
      if (aa !== ba) return aa.localeCompare(ba);
      const sa = a.testCase.sort_order ?? 0;
      const sb = b.testCase.sort_order ?? 0;
      if (sa !== sb) return sa - sb;
      return byCode(a, b);
    });
}

/** The next free number, so a new test never collides with an existing one. */
export function nextTestCode(existing: readonly string[]): string {
  let highest = 0;
  for (const code of existing) {
    const match = /^TC-(\d+)$/.exec(String(code ?? "").trim());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `TC-${String(highest + 1).padStart(3, "0")}`;
}

/** Only the four outcomes are accepted from a form. Anything else is refused, never guessed. */
export function parseOutcome(value: unknown): TestOutcome | null {
  return asOutcome(value);
}
