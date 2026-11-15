/**
 * PARTS 8 AND 11: the classification reaches the student (directive 2026-11-15).
 *
 * Part 8 asks that research retrieval use the source-intelligence layer, and Part 11 asks
 * that a student be told what kind of source they are looking at "in labels a
 * non-technical student can understand ... without exposing implementation details".
 *
 * These tests are about the two things that can silently go wrong with a label:
 *   1. It says something the classification did not establish (over-claiming).
 *   2. It says it in words only an engineer reads (jargon).
 *
 * The rendered-copy assertions use react-dom/server, so the words checked here are the
 * words that actually reach a page, not an intermediate object.
 */
import { renderToStaticMarkup } from "react-dom/server";
import {
  assessSource,
  summarizeSourceAssessment,
  evidenceSuitability,
  type SourceSummary,
} from "../src/lib/research/source-intelligence";
import { SourceTypeLabel } from "../src/components/app/SourceTypeLabel";
import { readFileSync } from "fs";

type Assert = (condition: boolean, message: string) => void;

const REUTERS = {
  url: "https://www.reuters.com/world/europe/central-bank-holds-rates-2026-03-04/",
  title: "Central bank holds interest rates at 3.5% for a third month",
  publisher: "Reuters",
  byline: "Jane Doe",
  publishedDate: "2026-03-04",
  content: "The central bank said on Wednesday it would keep its benchmark rate unchanged at 3.5%, citing slowing inflation.",
};

const ONION = {
  url: "https://www.theonion.com/congress-passes-bill-requiring-laws-be-read-aloud-1812345678",
  title: "Congress Passes Bill Requiring All Laws Be Explained To A Child Before Vote",
  publisher: "theonion.com",
  byline: "Staff",
  publishedDate: "2026-02-11",
  content: "WASHINGTON - In a rare bipartisan moment, lawmakers agreed that every bill must first be explained to a seven-year-old.",
};

const OPINION = {
  url: "https://www.nytimes.com/2026/03/01/opinion/the-case-against-the-new-tax.html",
  title: "The Case Against The New Tax",
  byline: "A Columnist",
  publishedDate: "2026-03-01",
  content: "In my view the tax is a mistake, and here is why the arguments for it do not hold.",
};

function summaryFor(input: Parameters<typeof assessSource>[0]): SourceSummary {
  return summarizeSourceAssessment(assessSource(input));
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const JARGON = /API|JSON|LLM|schema|endpoint|token|regex|SQL|RLS|enum|boolean|payload|classif|heuristic|score\b|flag\b|nullable|mime|utf|http status/gi;

export async function runSourceLabelTests(assert: Assert, section: (name: string) => void) {
  section("source labels: the stored summary says only what was established (Part 8)");

  const news = summaryFor(REUTERS);
  assert(news.label === "News reporting", `labels: a report is labelled as news reporting (got "${news.label}")`);
  assert(news.usable, "labels: a plain report is usable as evidence");
  assert(news.blockedReason === null, "labels: a usable source carries no refusal reason");
  assert(news.role === "secondary", "labels: a report describing others' work is marked as such");
  assert(news.formats.includes("news_reporting"), "labels: the full format list is kept, not just the one label");

  const satire = summaryFor(ONION);
  assert(satire.satire && satire.label === "Satire", `labels: The Onion is labelled satire (got "${satire.label}")`);
  assert(!satire.usable, "labels: satire is never usable as evidence");
  assert(Boolean(satire.blockedReason), "labels: satire carries a reason the student can read");
  assert(
    /persuasive writing|example|humour|satire/i.test(satire.blockedReason ?? ""),
    "labels: the satire refusal offers a legitimate use rather than only saying no",
  );

  const opinion = summaryFor(OPINION);
  assert(opinion.label === "Opinion", `labels: an opinion column is labelled opinion (got "${opinion.label}")`);
  assert(opinion.usable, "labels: opinion may be used as evidence of what the author argues");

  const retracted = summarizeSourceAssessment(
    assessSource({
      url: "https://www.example-publisher.com/article/retracted",
      title: "A Retracted Article",
      doi: "10.1016/j.example.2019.01.001",
      metadata: { retracted: true, peerReviewed: true, retractionChecked: true },
    }),
  );
  assert(retracted.publicationState === "retracted", "labels: a retraction survives into the stored summary");
  assert(!retracted.usable, "labels: a retracted paper is not usable as evidence");

  const preprint = summarizeSourceAssessment(
    assessSource({
      url: "https://arxiv.org/abs/2603.01234",
      title: "Scaling Laws For Classroom Tutors",
      content: "We present a preprint describing a new training method and report results on three benchmarks.",
    }),
  );
  assert(preprint.peerReview === "preprint", "labels: a preprint is marked pre-review in the stored summary");

  assert(
    JSON.parse(JSON.stringify(news)).label === news.label && JSON.parse(JSON.stringify(news)).usable === true,
    "labels: the summary survives storage as JSON with its meaning intact",
  );
  assert(
    Object.keys(news).length === 12,
    `labels: the stored summary is twelve readable fields, not a copy of the engine (${Object.keys(news).length})`,
  );

  section("source labels: the words on screen (Part 11)");

  const newsHtml = renderToStaticMarkup(SourceTypeLabel({ summary: news }));
  const newsText = textOf(newsHtml);
  assert(newsText.includes("News reporting"), "screen: the label is rendered");
  assert(newsText.includes(news.explanation.slice(0, 30)), "screen: the explanation is rendered beside the label");
  assert(!newsText.includes("Not usable as evidence"), "screen: a usable source is not marked unusable");
  assert(!JARGON.test(newsText), `screen: the news row carries no engineering vocabulary (${newsText.slice(0, 120)})`);

  const satireHtml = textOf(renderToStaticMarkup(SourceTypeLabel({ summary: satire })));
  assert(satireHtml.includes("Satire"), "screen: satire is named");
  assert(satireHtml.includes("Not usable as evidence"), "screen: satire is marked not usable, not merely described");
  assert(satireHtml.includes(satire.blockedReason!.slice(0, 25)), "screen: the reason is shown, not just the refusal");
  assert(!JARGON.test(satireHtml), `screen: the satire row carries no engineering vocabulary (${satireHtml.slice(0, 140)})`);

  const opinionHtml = textOf(renderToStaticMarkup(SourceTypeLabel({ summary: opinion })));
  assert(opinionHtml.includes("Opinion"), "screen: opinion is named");
  assert(!opinionHtml.includes("Not usable as evidence"), "screen: opinion is not refused as evidence");

  const preprintHtml = textOf(renderToStaticMarkup(SourceTypeLabel({ summary: preprint })));
  assert(preprintHtml.includes("Not yet reviewed"), "screen: an unrefereed preprint says so in three words a student knows");

  const retractedHtml = textOf(renderToStaticMarkup(SourceTypeLabel({ summary: retracted })));
  assert(retractedHtml.includes("Retracted"), "screen: a retraction is visible at a glance");
  assert(retractedHtml.includes("Not usable as evidence"), "screen: a retracted paper is refused in words");

  for (const s of [news, satire, opinion, preprint, retracted]) {
    const html = textOf(renderToStaticMarkup(SourceTypeLabel({ summary: s })));
    assert(!JARGON.test(html), `screen: "${s.label}" row has no jargon (${html.slice(0, 120)})`);
    assert(html.length > 20, `screen: "${s.label}" renders real text, not an empty chip`);
  }

  section("source labels: the wiring is real, not decorative (Part 8)");

  const run = readFileSync("src/lib/research/run.ts", "utf8");
  assert(/summarizeSourceAssessment\(\s*assessSource\(/.test(run), "wiring: the pipeline classifies the page it actually verified");
  assert(
    /content: v\.text\.slice\(0, 20_000\)/.test(run),
    "wiring: classification reads the verified page text, not only the search listing",
  );
  assert(
    /authority_decision: \{ \.\.\.decision, source_intelligence: intelligence \}/.test(run),
    "wiring: the classification is stored beside the authority decision without replacing it",
  );
  assert(
    /Cannot be used as evidence: \$\{intelligence\.blockedReason\}/.test(run),
    "wiring: a refused source says why in its notes rather than silently failing",
  );
  assert(/\.insert\(\{/.test(run), "wiring: the refusal does not drop the source - it is still stored for the student to see");

  const route = readFileSync("src/app/api/research/route.ts", "utf8");
  assert(/content_chars, authority_decision"/.test(route), "wiring: the project response carries the classification to the screen");

  const panel = readFileSync("src/components/app/ResearchPanel.tsx", "utf8");
  assert(/<SourceTypeLabel summary=\{s\.authority_decision\.source_intelligence\}/.test(panel), "wiring: the research panel mounts the label component");
  assert(/cannot be used as evidence/.test(panel), "wiring: the panel shows one visible count, not only per-row chips");

  const component = readFileSync("src/components/app/SourceTypeLabel.tsx", "utf8");
  assert(!/use client/.test(component), "wiring: the label component renders on the server too, so rendered-copy tests are meaningful");
  assert(!/fetch\(|useState|useEffect/.test(component), "wiring: the label component performs no request and holds no state");

  // Honesty of the summary itself.
  const unusable = [satire, retracted];
  for (const s of unusable) {
    assert(!s.usable && s.blockedReason !== null, `wiring: "${s.label}" cannot be usable without a stated reason`);
    assert(
      evidenceSuitability(assessSource(REUTERS)).allowed,
      "wiring: the suitability rule that drives the count still allows an ordinary report",
    );
  }
}
