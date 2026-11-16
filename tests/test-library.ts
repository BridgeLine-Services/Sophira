import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  OUTCOME_LABEL,
  OUTCOME_ORDER,
  buildLibrary,
  nextTestCode,
  parseOutcome,
  runOrder,
  type TestCaseRow,
  type TestResultRow,
} from "../src/lib/tester/test-library";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const kase = (over: Partial<TestCaseRow> & { id: string; code: string }): TestCaseRow => ({
  title: `Test ${over.code}`,
  area: "Access",
  severity: "medium",
  is_active: true,
  sort_order: 10,
  ...over,
});

const result = (over: Partial<TestResultRow> & { id: string; test_case_id: string; outcome: string }): TestResultRow => ({
  created_at: "2026-11-16T10:00:00.000Z",
  reported_by: "u1",
  notes: "",
  ...over,
});

export function runTestLibraryTests(
  assert: (cond: boolean, msg: string) => void,
  section: (t: string) => void,
): void {
  /* ---------------------------------------------------------------- */
  section("1. A test nobody has run is never counted as a pass (2026-11-16)");
  /* ---------------------------------------------------------------- */
  {
    const library = buildLibrary([kase({ id: "c1", code: "TC-001" })], []);
    assert(library.summary.neverRun === 1 && library.summary.passed === 0,
      "test library: a test with no result is counted as never run, not as passing");
    assert(library.summary.run === 0, "test library: nothing counts as run until a result exists");
    assert(library.summary.passRate === null, "test library: there is no pass rate when nothing could be run");
    assert(/never run/i.test(library.headline) && /not the same as 1 passes/i.test(library.headline),
      "test library: the headline says plainly that never-run is not a pass");
    assert(library.clean === false, "test library: an unrun library is not a clean one");
    assert(library.entries[0].state === "never-run", "test library: the case itself reads as never run");
    assert(library.entries[0].lastResult === null, "test library: there is no last result to invent");
  }

  /* ---------------------------------------------------------------- */
  section("2. Could-not-run is its own fact, never a pass and never a failure");
  /* ---------------------------------------------------------------- */
  {
    const library = buildLibrary(
      [kase({ id: "c1", code: "TC-001" })],
      [result({ id: "r1", test_case_id: "c1", outcome: "blocked" })],
    );
    assert(library.summary.blocked === 1, "test library: a blocked test is counted as blocked");
    assert(library.summary.passed === 0 && library.summary.failed === 0,
      "test library: blocked is folded into neither side");
    assert(library.summary.passRate === null, "test library: blocked runs do not create a pass rate");
    assert(/could not be run/i.test(library.headline), "test library: the headline names it in plain words");
    assert(OUTCOME_LABEL.blocked === "Could not run", "test library: the label says what happened, not the column value");

    const skipped = buildLibrary(
      [kase({ id: "c1", code: "TC-001" })],
      [result({ id: "r1", test_case_id: "c1", outcome: "skipped" })],
    );
    assert(skipped.summary.skipped === 1 && skipped.summary.neverRun === 0,
      "test library: a skipped test is counted separately");
    assert(skipped.summary.neverRun === 0, "test library: a skipped test has been run, and is not 'never run'");
    assert(skipped.clean === false, "test library: skipped work is not a clean library");
  }

  /* ---------------------------------------------------------------- */
  section("3. A regression is only said when the history says it");
  /* ---------------------------------------------------------------- */
  {
    const regressed = buildLibrary(
      [kase({ id: "c1", code: "TC-001", severity: "critical" })],
      [
        result({ id: "r2", test_case_id: "c1", outcome: "failed", created_at: "2026-11-16T12:00:00.000Z" }),
        result({ id: "r1", test_case_id: "c1", outcome: "passed", created_at: "2026-11-15T12:00:00.000Z" }),
      ],
    );
    assert(regressed.entries[0].regression === true, "test library: failed now and passed before is a regression");
    assert(regressed.summary.regressions === 1, "test library: the regression is counted");
    assert(regressed.regressions[0].testCase.code === "TC-001", "test library: the regression names the test");
    assert(/used to pass/i.test(regressed.headline), "test library: the headline says which sentence matters");
    assert(regressed.entries[0].previousOutcome === "passed", "test library: the previous outcome is kept for the reader");

    const firstFailure = buildLibrary(
      [kase({ id: "c1", code: "TC-001" })],
      [result({ id: "r2", test_case_id: "c1", outcome: "failed" })],
    );
    assert(firstFailure.entries[0].regression === false,
      "test library: a first failure is not called a regression, because nothing used to pass");
    assert(firstFailure.summary.regressions === 0, "test library: no regression is invented from one attempt");
    assert(/nothing that used to pass has broken/i.test(firstFailure.headline),
      "test library: the headline says it is a new failure, not a break");

    const fixed = buildLibrary(
      [kase({ id: "c1", code: "TC-001" })],
      [
        result({ id: "r2", test_case_id: "c1", outcome: "passed", created_at: "2026-11-16T12:00:00.000Z" }),
        result({ id: "r1", test_case_id: "c1", outcome: "failed", created_at: "2026-11-15T12:00:00.000Z" }),
      ],
    );
    assert(fixed.entries[0].fixed === true, "test library: passed now and failed before is recorded as fixed");
    assert(fixed.summary.fixed === 1 && fixed.summary.regressions === 0,
      "test library: a fix is not counted as a regression");

    const unstable = buildLibrary(
      [kase({ id: "c1", code: "TC-001" })],
      [
        result({ id: "r3", test_case_id: "c1", outcome: "failed", created_at: "2026-11-16T13:00:00.000Z" }),
        result({ id: "r2", test_case_id: "c1", outcome: "passed", created_at: "2026-11-16T12:00:00.000Z" }),
        result({ id: "r1", test_case_id: "c1", outcome: "failed", created_at: "2026-11-16T11:00:00.000Z" }),
      ],
    );
    assert(unstable.entries[0].attempts === 3, "test library: every attempt is kept, not just the latest");
    assert(unstable.entries[0].previousOutcome === "passed",
      "test library: 'before that' means the attempt immediately before, not any old pass");
  }

  /* ---------------------------------------------------------------- */
  section("4. An unreadable timestamp cannot make old news look new");
  /* ---------------------------------------------------------------- */
  {
    const library = buildLibrary(
      [kase({ id: "c1", code: "TC-001" })],
      [
        result({ id: "bad", test_case_id: "c1", outcome: "failed", created_at: "not a date" }),
        result({ id: "good", test_case_id: "c1", outcome: "passed", created_at: "2026-11-16T09:00:00.000Z" }),
      ],
    );
    assert(library.entries[0].state === "passed",
      "test library: a row with an unreadable time sorts last, so it cannot become the newest fact");
    assert(library.summary.regressions === 0, "test library: a malformed row cannot manufacture a regression");
  }

  /* ---------------------------------------------------------------- */
  section("5. Retired tests keep their history and leave the run");
  /* ---------------------------------------------------------------- */
  {
    const library = buildLibrary(
      [
        kase({ id: "c1", code: "TC-001" }),
        kase({ id: "c2", code: "TC-002", is_active: false }),
      ],
      [
        result({ id: "r1", test_case_id: "c1", outcome: "passed" }),
        result({ id: "r2", test_case_id: "c2", outcome: "failed" }),
      ],
    );
    assert(library.summary.active === 1, "test library: only active tests are counted in the run");
    assert(library.summary.retired === 1, "test library: a retired test is reported as retired, not deleted");
    assert(library.summary.failed === 0, "test library: a retired failure does not count against the run");
    assert(library.entries.length === 2, "test library: the retired test keeps its row and its history");
    assert(runOrder(library.entries).length === 1, "test library: the run list leaves retired tests out");
    assert(OUTCOME_ORDER.join(",") === "failed,blocked,skipped,passed",
      "test library: the outcomes are read worst first, which is how they matter");
  }

  /* ---------------------------------------------------------------- */
  section("6. Area by area, and the order a person actually tests in");
  /* ---------------------------------------------------------------- */
  {
    const cases: TestCaseRow[] = [
      kase({ id: "c1", code: "TC-010", area: "Memory", sort_order: 10 }),
      kase({ id: "c2", code: "TC-002", area: "Access", sort_order: 20 }),
      kase({ id: "c3", code: "TC-001", area: "Access", sort_order: 10 }),
      kase({ id: "c4", code: "TC-003", area: "  ", sort_order: 30 }),
    ];
    const library = buildLibrary(cases, [result({ id: "r1", test_case_id: "c3", outcome: "failed" })]);
    assert(library.areas.map((a) => a.area).join(",") === "Access,Memory,Unfiled",
      "test library: areas are listed in a stable order, and a blank area becomes 'Unfiled'");
    assert(library.areas[0].total === 2 && library.areas[0].failed === 1,
      "test library: an area counts only its own tests");
    const order = runOrder(library.entries).map((e) => e.testCase.code).join(",");
    assert(order === "TC-001,TC-002,TC-010,TC-003",
      "test library: the run follows area (alphabetically), then the order staff set, then the number");
    assert(nextTestCode(["TC-001", "TC-007", "nonsense"]) === "TC-008",
      "test library: a new test takes the next free number");
    assert(nextTestCode([]) === "TC-001", "test library: an empty library starts at the first number");
    assert(nextTestCode(["TC-999"]) === "TC-1000", "test library: the numbering does not stop at three digits");
  }

  /* ---------------------------------------------------------------- */
  section("7. Only the four answers are accepted");
  /* ---------------------------------------------------------------- */
  {
    assert(parseOutcome("passed") === "passed", "test library: a valid outcome is accepted");
    assert(parseOutcome("PASSED") === "passed", "test library: case does not matter, as the database stores lower case");
    assert(parseOutcome("pass") === null, "test library: a near-miss is refused rather than rounded to passing");
    assert(parseOutcome("ok") === null, "test library: an informal answer is refused");
    assert(parseOutcome("") === null && parseOutcome(null) === null && parseOutcome(undefined) === null,
      "test library: nothing is never treated as a result");

    const unknown = buildLibrary(
      [kase({ id: "c1", code: "TC-001" })],
      [result({ id: "r1", test_case_id: "c1", outcome: "looks fine" })],
    );
    assert(unknown.entries[0].state === "never-run" && unknown.summary.neverRun === 1,
      "test library: an unrecognised outcome is treated as no result, never as a pass");
  }

  /* ---------------------------------------------------------------- */
  section("8. A failed read is said, not smoothed over");
  /* ---------------------------------------------------------------- */
  {
    const none = buildLibrary(null, []);
    assert(none.headline.includes("could not be read"), "test library: an unreadable list says so");
    assert(none.summary.active === 0 && none.summary.passRate === null,
      "test library: nothing is claimed from an unreadable list");
    assert(none.clean === false, "test library: an unreadable library is never called clean");

    const noResults = buildLibrary([kase({ id: "c1", code: "TC-001" })], null);
    assert(noResults.summary.neverRun === 1, "test library: unreadable results leave every test honestly unrun");

    const empty = buildLibrary([], []);
    assert(/empty/i.test(empty.headline), "test library: an empty library says it is empty");
    assert(empty.summary.passRate === null, "test library: an empty library has no pass rate");
  }

  /* ---------------------------------------------------------------- */
  section("9. Migration 0061: additive, reversible, and nothing widened");
  /* ---------------------------------------------------------------- */
  {
    const sql = read("supabase/migrations/0061_qa_test_library.sql");
    assert(/create table if not exists public\.qa_test_cases/.test(sql), "0061: the case table is created additively");
    assert(/create table if not exists public\.qa_test_results/.test(sql), "0061: the results table is created additively");
    assert(/on conflict \(code\) do nothing/.test(sql),
      "0061: the starter library is idempotent, so re-running never duplicates or overwrites");
    assert(/drop table if exists public\.qa_test_results;/.test(sql) && /drop table if exists public\.qa_test_cases;/.test(sql),
      "0061: the rollback is written down, in the right order");
    assert(/alter table public\.qa_test_cases enable row level security/.test(sql) &&
      /alter table public\.qa_test_results enable row level security/.test(sql),
      "0061: both new tables have row level security on");
    assert(/revoke all on public\.qa_test_cases from anon/.test(sql) &&
      /revoke all on public\.qa_test_results from anon/.test(sql),
      "0061: neither table is reachable by an anonymous caller");
    const sqlWithoutComments = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    assert(!/grant[^;]*to anon/i.test(sqlWithoutComments), "0061: nothing at all is granted to anon");
    assert(/for insert with check \(reported_by = auth\.uid\(\) and public\.is_tester_or_staff\(\)\)/.test(sql),
      "0061: a result can only be recorded in the recorded person's own name");
    assert(/for update using \(public\.is_staff\(\)\) with check \(public\.is_staff\(\)\)/.test(sql),
      "0061: only staff can change the list, so a tester cannot rewrite the exam");
    assert(/for select using \(reported_by = auth\.uid\(\) or public\.is_staff\(\)\)/.test(sql),
      "0061: a tester reads their own results and staff read all of them");
    assert(!/for update[^;]*qa_test_results/i.test(sql) && !/create policy[^;]*qa_test_results[^;]*for delete/i.test(sql),
      "0061: results are append-only, so history cannot be quietly rewritten");
    assert(/revoke update, delete on public\.qa_test_results from authenticated/.test(sql),
      "0061: the default table privileges are withdrawn, because row level security alone would leave the privilege in place");
    assert(/drop function if exists public\.is_tester_or_staff/.test(sql), "0061: the helper it added is named in the rollback");

    const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    assert(files[files.length - 1] === "0061_qa_test_library.sql", "the chain ends with 0061");
    assert(files.length === 61, `the chain is 61 migrations (found ${files.length})`);

    const markers = read("scripts/migration-markers.mjs");
    assert(/0061_qa_test_library\.sql/.test(markers), "0061 has a marker, so a database can prove it ran");
    assert(/to_regclass\('public\.qa_test_cases'\) is not null and to_regclass\('public\.qa_test_results'\) is not null/.test(markers),
      "0061's marker needs both tables, so a half-applied migration cannot pass");
    assert(!/alter table public\.qa_reports/.test(sql) && !/drop policy if exists "qa_reports/.test(sql),
      "0061 does not touch the existing tester reports table or its policies");
  }

  /* ---------------------------------------------------------------- */
  section("10. The screens: real reads, self-only writes, no widening");
  /* ---------------------------------------------------------------- */
  {
    const page = read("src/app/tester/tests/page.tsx");
    assert(/buildLibrary\(/.test(page), "test library page: the numbers come from the tested module");
    assert(/from\("qa_test_cases"\)/.test(page) && /from\("qa_test_results"\)/.test(page),
      "test library page: the list and the results are read from the records themselves");
    assert(/needsDatabaseUpdate\(/.test(page), "test library page: a missing table says so instead of showing zero tests");
    assert(/readFailed/.test(page) && /could not be read just now/.test(page),
      "test library page: a failed read is stated on the screen");
    assert(!/createAdminClient|service_role|SERVICE_ROLE/.test(page),
      "test library page: the tester's own client reads it, so row level security still decides");
    assert(/canUseTesterFeatures/.test(page) && /redirect\("\/dashboard"\)/.test(page),
      "test library page: an ordinary member is sent away");

    const route = read("src/app/api/tester/results/route.ts");
    assert(/reported_by: user\.id/.test(route), "the recording route: the person is taken from the session");
    assert(!/reported_by:\s*body\./.test(route), "the recording route: a browser-supplied identity is never used");
    assert(/parseOutcome\(/.test(route), "the recording route: only the four outcomes are accepted");
    assert(/canUseTesterFeatures/.test(route), "the recording route: only testers and staff may record");
    assert(/is_active === false/.test(route), "the recording route: a retired test cannot be recorded against");
    assert(/status: 400 \}|, \{ status: 400 \}\)/.test(route), "the recording route: a bad request is refused with a sentence");

    const form = read("src/components/tester/RecordResult.tsx");
    assert(/blocked/.test(form) && /no account, no key, no device/.test(form),
      "the recording form: 'could not run' is a real choice, not a hidden one");
    assert(/blocked: "Could not run"/.test(read("src/lib/tester/test-library.ts")),
      "the recording form: the words come from the shared vocabulary");

    const testerHome = read("src/app/tester/page.tsx");
    assert(/href="\/tester\/tests"/.test(testerHome), "the tester home links to the test list");

    const spec = read("src/lib/governance/product-spec.ts");
    assert(spec.includes("src/lib/tester/test-library.ts"),
      "product spec: R17's test-case library cites the file that implements it");
    assert(!/the Tester test-case library and the student assignment centre are not built yet/.test(spec) ||
      /Tester test-case library \(5\) are not built/.test(spec) === false,
      "product spec: R17 no longer lists the tester library as unbuilt");
  }
}
