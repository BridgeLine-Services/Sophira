/**
 * SCHEMA LAG MUST NEVER LOOK LIKE AN EMPTY PAGE (2026-11-12).
 *
 * The Owner updates the database by pressing a button, so the live database can be behind
 * the deployed code. During that window Supabase returns no rows AND an error. Every page
 * that wrote `data ?? []` showed a confident empty state, and one of them (Announcements)
 * put a composer on top of the missing table, so the first sign of trouble would have been
 * a refused send after typing.
 *
 * This suite pins three things:
 *   1. The detector says yes ONLY for "that object is not there" and never for permissions,
 *      auth, network or constraint errors (dressing a real failure up as a setup step would
 *      be its own dishonesty).
 *   2. The notice says what is true: nothing was lost, the Owner has the fix, and pressing
 *      it twice is safe. A non-Owner is not offered a button they cannot use.
 *   3. Each affected page asks the question before it renders an empty state, and keeps its
 *      role gate ahead of it.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import {
  needsDatabaseUpdate,
  missingObjectName,
  missingObjectSentence,
} from "../src/lib/supabase/missing-object";
import { DatabaseUpdateNotice } from "../src/components/system/DatabaseUpdateNotice";

export function runDatabaseUpdateNoticeTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("schema lag: missing table is stated, never shown as an empty page");

  /* 1. The detector: the real error shapes Supabase returns ------------------------- */
  const missingTable = { code: "42P01", message: 'relation "public.qa_reports" does not exist' };
  const missingFromCache = {
    code: "PGRST205",
    message: "Could not find the table 'public.qa_reports' in the schema cache",
  };
  assert(needsDatabaseUpdate(missingTable), "schema lag: Postgres 42P01 (undefined_table) is recognised");
  assert(needsDatabaseUpdate(missingFromCache), "schema lag: PostgREST PGRST205 (not in the schema cache) is recognised");
  assert(needsDatabaseUpdate({ code: "42703", message: 'column "provider_used" does not exist' }),
    "schema lag: a column the database has not been given yet (42703) is recognised");
  assert(needsDatabaseUpdate({ code: "PGRST202" }),
    "schema lag: a missing function (PGRST202) is recognised");
  assert(needsDatabaseUpdate({ message: 'relation "public.announcements" does not exist' }),
    "schema lag: wording alone is enough when the client sends no code");

  /* 2. And the detector refuses everything that is NOT schema lag ------------------- */
  assert(!needsDatabaseUpdate(null), "schema lag: no error means no notice (a clean read is never flagged)");
  assert(!needsDatabaseUpdate({ code: "42501", message: "permission denied for table qa_reports" }),
    "schema lag: a permission refusal is NOT a setup step (pressing update cannot grant it)");
  assert(!needsDatabaseUpdate({ code: "PGRST301", message: "JWT expired" }),
    "schema lag: an expired session is not reported as a database that needs updating");
  assert(!needsDatabaseUpdate({ message: "TypeError: fetch failed" }),
    "schema lag: a network failure is not reported as a database that needs updating");
  assert(!needsDatabaseUpdate({ code: "23505", message: "duplicate key value violates unique constraint" }),
    "schema lag: a constraint error is not reported as a database that needs updating");
  assert(!needsDatabaseUpdate({ code: "42P01", message: "permission denied for table qa_reports" }),
    "schema lag: even a missing-object code does not override an explicit permission refusal");

  /* 3. Naming what is missing, for the small print --------------------------------- */
  assert(missingObjectName(missingTable) === "qa_reports",
    "schema lag: the missing object is named without its schema (qa_reports, not public.qa_reports)");
  assert(missingObjectName(missingFromCache) === "qa_reports",
    "schema lag: the schema-cache wording names the object too");
  assert(missingObjectName({ code: "42P01", message: 'relation "public.learning_goals" does not exist' }) === "learning_goals",
    "schema lag: a different table is named correctly (learning_goals)");
  assert(missingObjectName({ code: "42501", message: "permission denied for table qa_reports" }) === null,
    "schema lag: nothing is named when the condition is not schema lag");
  assert(/qa_reports/.test(missingObjectSentence(missingTable)),
    "schema lag: the small-print sentence names the missing object");
  assert(missingObjectSentence({ code: "42501" }) === "One part of the database is not there yet.",
    "schema lag: a non-schema error falls back to the neutral sentence and names no object");

  /* 4. The notice says what is true, and offers nothing it cannot do ---------------- */
  const ownerHtml = renderToStaticMarkup(
    createElement(DatabaseUpdateNotice, {
      feature: "your QA reports",
      error: missingTable,
      canUpdate: true,
    }),
  );
  assert(ownerHtml.includes("This page needs a database update"),
    "notice: the heading says what the reader is looking at");
  assert(ownerHtml.includes("Nothing has been lost"),
    "notice: it says nothing was lost (a missing table holds no rows to lose)");
  assert(ownerHtml.includes("your QA reports"),
    "notice: it names the feature in the reader's words, not the table name");
  assert(ownerHtml.includes("Update database"),
    "notice: it names the exact press that fixes it");
  assert(ownerHtml.includes("Only") === false && ownerHtml.includes("only adds things"),
    "notice: it says the update only adds things");
  assert(ownerHtml.includes("pressing it twice is safe"),
    "notice: it says repeating the update is safe");
  assert(ownerHtml.includes('href="/owner"'),
    "notice: an Owner gets a real link to the dashboard, not an instruction to go and find it");
  assert(/qa_reports/.test(ownerHtml),
    "notice: the small print names the missing object so the report is actionable");

  const memberHtml = renderToStaticMarkup(
    createElement(DatabaseUpdateNotice, { feature: "announcements", error: missingFromCache, canUpdate: false }),
  );
  assert(memberHtml.includes("An Owner can fix this"),
    "notice: a non-Owner is told who can fix it");
  assert(!memberHtml.includes('href="/owner"'),
    "notice: a non-Owner is never sent to a page that would refuse them");
  assert(!/<button/i.test(memberHtml),
    "notice: nothing is clickable that cannot work - it is prose, not a dead button");
  assert(!/42P01|PGRST205|stack|at \w+ \(/.test(ownerHtml + memberHtml),
    "notice: no driver code or stack trace ever reaches the screen");

  /* 5. The component is safe to render inside a Server Component -------------------- */
  const noticeSource = readFileSync("src/components/system/DatabaseUpdateNotice.tsx", "utf8");
  assert(!/^["']use client["']/m.test(noticeSource),
    "notice: the component carries no client directive, so a server page can render it");
  assert(!/useState|useEffect|onClick/.test(noticeSource),
    "notice: no client state or handlers, so it never needs JavaScript to be useful");

  /* 6. Every affected page asks the question BEFORE it shows an empty state ---------- */
  const pages: Array<[string, string, string]> = [
    ["src/app/tester/page.tsx", "qa_reports", "the Tester's own reports"],
    ["src/app/owner/qa/page.tsx", "qa_reports", "staff QA triage"],
    ["src/app/owner/announcements/page.tsx", "announcements", "the announcements composer"],
  ];
  for (const [file, table, label] of pages) {
    const src = readFileSync(file, "utf8");
    assert(src.includes(`from("${table}")`), `schema lag: ${label} still reads ${table}`);
    assert(src.includes("needsDatabaseUpdate("),
      `schema lag: ${label} asks whether the database has that part yet`);
    assert(src.includes("<DatabaseUpdateNotice"),
      `schema lag: ${label} renders the notice instead of an empty state`);
    assert(/const \{[^}]*error/.test(src) || /\{[^}]*error[^}]*\} = await supabase/.test(src),
      `schema lag: ${label} keeps the read error instead of discarding it`);
    assert(src.indexOf("redirect(") < src.indexOf("<DatabaseUpdateNotice"),
      `schema lag: ${label} decides access BEFORE it says anything about the database`);
  }

  /* 7. The page that WRITES must not offer the write first -------------------------- */
  const announcements = readFileSync("src/app/owner/announcements/page.tsx", "utf8");
  assert(announcements.indexOf("DatabaseUpdateNotice") < announcements.indexOf("<AnnouncementComposer"),
    "schema lag: the announcements composer is never offered over a table that is not there yet");
}
