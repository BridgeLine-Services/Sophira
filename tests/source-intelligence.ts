/**
 * SOURCE INTELLIGENCE TESTS (directive 2026-11-15, Parts 5, 6, 14).
 *
 * Every case the directive names, exercised through the real modules with no network:
 *   - satire and parody recognition, including the rule that satire is not a lie
 *   - misinformation: false, unverified, partly supported, disputed, misleading
 *   - academic distinctions: peer-reviewed vs preprint, primary vs secondary, retraction
 *   - the government boundary, including new adversarial wordings
 *   - the registry's honesty rule: a name in a file is not a connection
 *
 * The last block asserts the OLD contracts still behave, because the whole point of the
 * round is that nothing was replaced: dedupe, query generation, citation formatting,
 * the 12-step citation invariant and the access policy are the ones that already shipped.
 */
import { readFileSync } from "fs";
import {
  assessSource,
  assessClaim,
  evidenceSuitability,
  labelForFormat,
  labelForVerdict,
  looksLikeImpersonation,
  coverageOf,
  STUDENT_LABELS,
  CLAIM_LABELS,
  SATIRICAL_PUBLICATIONS,
  HUMOUR_PATH_PREFIXES,
  type ArticleFormat,
  type ClaimVerdict,
} from "../src/lib/research/source-intelligence";
import {
  SOURCE_REGISTRY,
  sourceById,
  sourceStatus,
  catalogStatus,
  catalogCounts,
  registryCounts,
  markSourceVerified,
  resetSourceVerification,
  linkOnlySources,
  fetchableSources,
  FACT_CHECK_SOURCES,
  sourcesForCategory,
  VERIFICATION_STALE_DAYS,
  type RegistryContext,
} from "../src/lib/research/source-registry";
import { dedupeSources, normalizeUrl, generateQueries, rankCandidates } from "../src/lib/research/research";
import { parseTeacherSourceType } from "../src/lib/research/authority";
import { formatCitation, quoteInContent } from "../src/lib/research/citation";
import { verifyCitation, type CitationStatus } from "../src/lib/research/citation-invariant";
import { evaluateInformationRequest, evaluateSourceRequest, isProhibitedHost } from "../src/lib/research/policy";
import { researchReadiness } from "../src/lib/research/provider";

type Assert = (condition: boolean, message: string) => void;

const NO_ENV: RegistryContext = { searchConfigured: false, hasEnv: () => false };
const FULL_ENV: RegistryContext = { searchConfigured: true, hasEnv: () => true };

const REUTERS = {
  url: "https://www.reuters.com/world/europe/central-bank-holds-rates-2026-03-04/",
  title: "Central bank holds interest rates at 3.5% for a third month",
  publisher: "Reuters",
  byline: "Jane Doe",
  publishedDate: "2026-03-04",
  snippet:
    "The central bank said on Wednesday it would keep its benchmark rate unchanged at 3.5%, citing slowing inflation and a cooling labour market.",
};

export async function runSourceIntelligenceTests(assert: Assert, section: (name: string) => void) {
  /* ================================================================ */
  section("source intelligence: satire and parody (Part 5.2)");

  const onion = assessSource({
    url: "https://www.theonion.com/congress-passes-bill-requiring-laws-be-read-aloud-1812345678",
    title: "Congress Passes Bill Requiring All Laws Be Explained To A Child Before Vote",
    byline: "Staff",
    publishedDate: "2026-02-11",
    snippet:
      "WASHINGTON - In a rare bipartisan moment, lawmakers agreed that every bill must first be explained to a seven-year-old.",
  });
  assert(onion.satire.isSatire, "satire: The Onion is classified as a satirical publication");
  assert(onion.primaryFormat === "satire", `satire: The Onion's primary format is satire (got ${onion.primaryFormat})`);
  assert(onion.satire.confidence >= 0.7, `satire: recognised from the publication itself (confidence ${onion.satire.confidence})`);
  assert(
    onion.satire.signals.some((s) => /satirical publication/i.test(s)),
    "satire: the reason names the publication, not a guess about tone",
  );
  assert(!onion.usableAsEvidence, "satire: a satirical article is never usable as factual evidence");
  assert(
    /not the same as a lie/i.test(onion.explanation),
    "satire: the explanation distinguishes satire from falsehood in plain words",
  );

  const bee = assessSource({
    url: "https://babylonbee.com/news/city-council-approves-budget-by-accident",
    title: "City Council Accidentally Approves Entire Budget While Trying To Adjourn",
    snippet: "The council voted 6-1 to fund everything after a motion to leave was misunderstood.",
  });
  assert(bee.satire.isSatire, "satire: The Babylon Bee is classified as a satirical publication");
  assert(bee.primaryFormat === "satire", "satire: The Babylon Bee's primary format is satire");

  const borowitz = assessSource({
    url: "https://www.newyorker.com/humor/borowitz-report/nation-relieved-to-hear-news-continues",
    title: "Nation Relieved To Hear News Will Continue",
    snippet: "The Borowitz Report: a satirical column.",
  });
  assert(borowitz.satire.isSatire, "satire: the Borowitz Report is recognised by its section, not by its host alone");
  const newYorkerFeature = assessSource({
    url: "https://www.newyorker.com/magazine/2026/02/02/the-quiet-rise-of-a-new-city",
    title: "The Quiet Rise Of A New City",
    byline: "A Reporter",
    publishedDate: "2026-02-02",
    snippet: "A reported feature about urban planning, based on interviews and public records.",
  });
  assert(
    !newYorkerFeature.satire.isSatire,
    "satire: a reported feature in the same magazine is NOT called satire (the section decides, not the host)",
  );

  const declaredParody = assessSource({
    url: "https://example.org/blog/2026/04/a-parody-of-a-product-launch",
    title: "A Parody Of A Product Launch",
    snippet: "This article is a parody. Any resemblance to a real product is intentional and funny.",
  });
  assert(declaredParody.satire.isSatire, "satire: an explicit parody disclaimer is enough on its own");
  assert(declaredParody.satire.isParody, "satire: an explicit parody disclaimer is recorded as parody, not just satire");

  const plainReport = assessSource(REUTERS);
  assert(!plainReport.satire.isSatire, "satire: an ordinary report is not flagged as satire");
  assert(plainReport.satire.confidence === 0, "satire: no humour signals means zero satire confidence, not a small guess");

  assert(
    SATIRICAL_PUBLICATIONS.some((p) => p.host === "theonion.com") && SATIRICAL_PUBLICATIONS.some((p) => p.host === "clickhole.com"),
    "satire: the known-publication list holds the directive's examples",
  );
  assert(HUMOUR_PATH_PREFIXES.length >= 3, "satire: humour sections are a real list, not one hard-coded string");

  /* ================================================================ */
  section("source intelligence: reporting, opinion, editorial and sponsorship (Part 5.1)");

  assert(plainReport.primaryFormat === "news_reporting", `format: Reuters reporting is news reporting (got ${plainReport.primaryFormat})`);
  assert(plainReport.usableAsEvidence, "format: a plain news report is usable as evidence");
  assert(plainReport.evidenceRole === "secondary", "format: a news report summarising others is a secondary source");
  assert(/News reporting/.test(plainReport.label), "format: the on-screen label is the student-facing word");
  assert(
    !/API|JSON|LLM|schema|endpoint|token|regex|SQL/i.test(plainReport.label + plainReport.explanation),
    "format: the label and explanation carry no engineering vocabulary",
  );

  const opinion = assessSource({
    url: "https://www.nytimes.com/2026/03/01/opinion/the-case-against-the-new-tax.html",
    title: "The Case Against The New Tax",
    byline: "A Columnist",
    publishedDate: "2026-03-01",
    snippet: "In my view the tax is a mistake, and here is why the arguments for it do not hold.",
  });
  assert(opinion.primaryFormat === "opinion", `format: an /opinion/ column is opinion (got ${opinion.primaryFormat})`);
  assert(
    opinion.formats.includes("news_reporting"),
    "format: multi-label - the same piece keeps the news-reporting label because it reports facts too",
  );
  assert(/reported facts with the author's opinion/i.test(opinion.explanation), "format: a mixed piece says so plainly");

  const editorial = assessSource({
    url: "https://www.theguardian.com/commentisfree/2026/feb/10/editorial-the-budget",
    title: "The Guardian view on the budget: a missed chance | Editorial",
    byline: "Editorial",
    publishedDate: "2026-02-10",
    snippet: "The Guardian's editorial board argues the budget fails on housing.",
  });
  assert(editorial.primaryFormat === "editorial", `format: an editorial is editorial (got ${editorial.primaryFormat})`);

  const sponsored = assessSource({
    url: "https://www.example-news.com/sponsored/how-our-bank-saves-you-money",
    title: "How Our Bank Saves You Money",
    snippet: "Sponsored content. Paid for by Example Bank.",
  });
  assert(sponsored.primaryFormat === "sponsored", `format: labelled paid content is sponsored (got ${sponsored.primaryFormat})`);
  assert(!sponsored.usableAsEvidence, "format: advertising is never usable as independent evidence");

  const release = assessSource({
    url: "https://www.example-university.edu/newsroom/press-release-new-lab",
    title: "University Opens New Materials Laboratory",
    snippet: "For immediate release. Media contact: press@example.edu. The university announced a new laboratory.",
  });
  assert(release.primaryFormat === "press_release", `format: a press release is recognised (got ${release.primaryFormat})`);
  assert(
    /statement/i.test(release.explanation),
    "format: a press release is framed as the organisation's own statement, not independent confirmation",
  );

  const govReport = assessSource({
    url: "https://www.census.gov/library/publications/2026/acs/demographic-profile.html",
    title: "Demographic Profile: 2026 American Community Survey",
    publishedDate: "2026-09-14",
    snippet: "This report presents population estimates from the American Community Survey, with tables and methodology.",
  });
  assert(govReport.formats.includes("government_publication"), "format: a .gov publication is labelled as a government publication");
  assert(govReport.formats.includes("dataset") || govReport.formats.includes("primary_source"), "format: statistics are primary data");

  /* ================================================================ */
  section("source intelligence: peer review, preprints and retraction (Parts 5.1, 6)");

  const preprint = assessSource({
    url: "https://arxiv.org/abs/2603.01234",
    title: "Scaling Laws For Classroom Tutors",
    snippet: "We present a preprint describing a new training method and report results on three benchmarks.",
  });
  assert(preprint.peerReview === "preprint", `peer review: arXiv is a preprint (got ${preprint.peerReview})`);
  assert(preprint.formats.includes("preprint"), "peer review: the preprint format is recorded");
  assert(/before peer review/i.test(preprint.evidence.join(" ")), "peer review: the reason says it is pre-review, not reviewed");
  assert(preprint.evidenceRole === "primary", "peer review: an original research report is a primary source");

  const biorxiv = assessSource({
    url: "https://www.biorxiv.org/content/10.1101/2026.02.01.123456v1",
    title: "A Preprint On Cell Signalling",
    snippet: "doi: 10.1101/2026.02.01.123456",
  });
  assert(biorxiv.peerReview === "preprint", "peer review: a bioRxiv DOI is a preprint even without the host");

  const doiOnly = assessSource({
    url: "https://www.example-publisher.com/article/12345",
    title: "A Registered Article",
    snippet: "doi:10.1016/j.example.2026.02.003 The article reports a survey of 400 participants.",
  });
  assert(
    doiOnly.peerReview === "research_unconfirmed",
    `peer review: a DOI alone is UNCONFIRMED review, never claimed as peer reviewed (got ${doiOnly.peerReview})`,
  );
  assert(
    doiOnly.uncertainty.toLowerCase().includes("not confirmed"),
    "peer review: the uncertainty is stated instead of assumed",
  );

  const confirmed = assessSource({
    url: "https://www.example-publisher.com/article/999",
    title: "A Reviewed Article",
    snippet: "doi:10.1016/j.example.2026.02.004",
    metadata: { peerReviewed: true, retractionChecked: true },
  });
  assert(confirmed.peerReview === "peer_reviewed", "peer review: a confirmed record is peer reviewed");
  assert(confirmed.publicationState === "clean", "retraction: a checked record with nothing against it is clean");
  assert(confirmed.retractionChecked, "retraction: the assessment records that a retraction record was actually consulted");

  const retracted = assessSource({
    url: "https://www.example-publisher.com/article/retracted",
    title: "A Retracted Article",
    snippet: "doi:10.1016/j.example.2019.01.001 This paper reported a trial of 120 patients.",
    metadata: { peerReviewed: true, retracted: true, retractionChecked: true },
  });
  assert(retracted.publicationState === "retracted", "retraction: a retraction record is reported as retracted");
  assert(!retracted.usableAsEvidence, "retraction: retracted research is never usable as evidence");
  assert(
    !evidenceSuitability(retracted).allowed && /retracted/i.test(evidenceSuitability(retracted).reason),
    "retraction: the assignment check refuses it with a reason a student can understand",
  );

  const noRecord = assessSource({
    url: "https://www.example-publisher.com/article/unchecked",
    title: "An Article Nobody Checked",
    snippet: "doi:10.1016/j.example.2018.05.002",
  });
  assert(noRecord.publicationState === "unknown", "retraction: an unchecked item is UNKNOWN, never silently clean");
  assert(
    noRecord.uncertainty.includes("unknown rather than clear"),
    "retraction: the uncertainty explains the difference between unknown and clean",
  );

  const corrected = assessSource({
    url: "https://www.example-publisher.com/article/corrected",
    title: "A Corrected Article",
    snippet: "doi:10.1016/j.example.2020.05.002",
    metadata: { corrected: true, retractionChecked: true },
  });
  assert(corrected.publicationState === "corrected", "retraction: a correction is recorded as a correction");

  /* ================================================================ */
  section("source intelligence: imitation domains and misinformation risk (Part 5.3)");

  assert(looksLikeImpersonation("abcnews.com.co") === "abcnews.com", "imitation: abcnews.com.co is caught as a look-alike");
  assert(looksLikeImpersonation("cnn.com.co") === "cnn.com", "imitation: cnn.com.co is caught as a look-alike");
  assert(looksLikeImpersonation("reuters.com") === null, "imitation: the real domain is never flagged");
  assert(looksLikeImpersonation("nasa.gov") === null, "imitation: an official domain is not flagged by its own rule");

  const impersonator = assessSource({
    url: "https://abcnews.com.co/2026/03/shocking-cure-discovered",
    title: "SHOCKING Cure Discovered That Doctors Hate",
    snippet: "You won't believe this miracle. Shared widely on social media, according to a viral post.",
  });
  assert(impersonator.misinformationRisk === "high", "risk: a look-alike domain with sensational wording is high risk");
  assert(impersonator.formats.includes("news_reporting") || impersonator.primaryFormat !== "unknown", "risk: the page is still described, not just rejected");

  const datedReport = assessSource(REUTERS);
  assert(
    datedReport.misinformationRisk === "low",
    `risk: an attributed, dated report from a named author is low risk (got ${datedReport.misinformationRisk})`,
  );

  const anonymous = assessSource({
    url: "https://www.example-blog.net/post/123",
    title: "What They Are Not Telling You",
    snippet: "A screenshot proves it. 40% of people, 12 million dollars, 3 agencies.",
  });
  assert(anonymous.misinformationRisk !== "low", "risk: no author, no date and unattributed figures is never low risk");
  assert(
    anonymous.evidence.length + anonymous.uncertainty.length > 0,
    "risk: every risk verdict carries observable reasons",
  );

  /* ================================================================ */
  section("claim verification: false, unverified, disputed, misleading (Part 5.3)");

  const noEvidence = assessClaim({ claim: "A secret laboratory opened under the city in 2019." });
  assert(noEvidence.verdict === "unverified", `claims: no evidence returns unverified (got ${noEvidence.verdict})`);
  assert(
    /not proof the claim is false/i.test(noEvidence.explanation),
    "claims: absence of evidence is explained as absence, never as disproof",
  );
  assert(noEvidence.confidenceBand === "high", "claims: being sure that nothing was found is a high-confidence statement");

  const falseClaim = assessClaim({
    claim: "The Eiffel Tower is 12 metres tall.",
    contradicting: [
      {
        url: "https://www.toureiffel.paris/en/the-monument",
        sourceName: "Eiffel Tower official site",
        passage: "The Eiffel Tower is 330 metres tall, including its antennas.",
        reliability: "official",
        independent: true,
        publishedDate: "2026-01-10",
      },
      {
        url: "https://www.britannica.com/topic/Eiffel-Tower-Paris-France",
        sourceName: "Encyclopaedia Britannica",
        passage: "The tower rises 330 metres above the city.",
        reliability: "editorial",
        independent: true,
        publishedDate: "2025-11-02",
      },
    ],
  });
  assert(falseClaim.verdict === "false", `claims: two independent contradictions is false (got ${falseClaim.verdict})`);
  assert(falseClaim.contradictingEvidence.length === 2, "claims: both contradictions are shown, not just counted");
  assert(/directly contradict/i.test(falseClaim.explanation), "claims: the reason names the contradiction");

  const oneContradiction = assessClaim({
    claim: "The study found a 30% improvement.",
    contradicting: [
      {
        url: "https://example.edu/reanalysis",
        passage: "Our reanalysis found no measurable improvement in the treatment group.",
        reliability: "peer_reviewed",
        independent: true,
      },
    ],
  });
  assert(oneContradiction.verdict === "disputed", `claims: one contradiction is disputed, not false (got ${oneContradiction.verdict})`);

  const satiricalOnly = assessClaim({
    claim: "The mayor declared the city a sovereign nation on Tuesday.",
    supporting: [
      {
        url: "https://www.theonion.com/mayor-declares-city-sovereign-nation-1812345",
        sourceName: "The Onion",
        passage: "The mayor declared the city a sovereign nation on Tuesday, citing tax policy and vibes.",
        satire: true,
      },
    ],
  });
  assert(satiricalOnly.verdict === "satirical_only", `claims: satire alone is satirical_only (got ${satiricalOnly.verdict})`);
  assert(satiricalOnly.verdict !== "false", "claims: a satirical article is NEVER classified as false");
  assert(
    /separate question/i.test(satiricalOnly.uncertainty),
    "claims: the uncertainty says whether the real event happened is a separate question",
  );
  assert(satiricalOnly.supportingEvidence.length === 0, "claims: a satirical passage is never listed as factual support");

  const partlySupported = assessClaim({
    claim: "Coffee cuts heart disease risk by 40% for everyone, according to a 2024 study of 10,000 people.",
    supporting: [
      {
        url: "https://example.org/cohort",
        sourceName: "Cohort study",
        passage:
          "Among adults over 60 in this cohort, coffee consumption was associated with a 40% lower risk of heart disease.",
        reliability: "peer_reviewed",
        independent: true,
        publishedDate: "2024-06-01",
      },
    ],
  });
  assert(
    partlySupported.verdict === "partially_supported",
    `claims: only the covered part is supported (got ${partlySupported.verdict})`,
  );
  assert(/do(es)? not appear in any retrieved passage/i.test(partlySupported.explanation), "claims: the missing figure is named");

  const disputed = assessClaim({
    claim: "The new drug reduces hospital admissions.",
    supporting: [
      { url: "https://example.org/trial-a", passage: "The trial found the drug reduced hospital admissions by 18%.", reliability: "peer_reviewed", independent: true },
    ],
    contradicting: [
      { url: "https://example.org/trial-b", passage: "A larger trial found no reduction in hospital admissions.", reliability: "peer_reviewed", independent: true },
    ],
  });
  assert(disputed.verdict === "disputed", `claims: evidence on both sides is disputed (got ${disputed.verdict})`);
  assert(/both sides/i.test(disputed.explanation), "claims: the student is told to present both sides");

  const outdated = assessClaim({
    claim: "Unemployment is currently 5.1%.",
    presentedAsCurrent: true,
    supporting: [
      {
        url: "https://example.gov/archive/2019",
        passage: "The unemployment rate was 5.1% in 2019, according to the annual report.",
        reliability: "official",
        independent: true,
        publishedDate: "2019-12-31",
      },
    ],
    asOf: new Date("2026-11-15T00:00:00Z"),
  });
  assert(outdated.verdict === "misleading", `claims: old data written as current is misleading (got ${outdated.verdict})`);
  assert(/more than two years old/i.test(outdated.explanation), "claims: the reason names the age of the evidence");

  const republished = assessClaim({
    claim: "The plant will close in March.",
    supporting: [
      { url: "https://outlet-a.example/story", passage: "The plant will close in March, the company said.", independent: false },
      { url: "https://outlet-b.example/story", passage: "The plant will close in March, the company said.", independent: false },
      { url: "https://outlet-c.example/story", passage: "The plant will close in March, the company said.", independent: false },
    ],
  });
  assert(
    /repeat the same original report/i.test(republished.explanation),
    "claims: three copies of one wire story are counted as one source, and the student is told why",
  );

  const factChecked = assessClaim({
    claim: "The bridge was closed because of a meteor strike.",
    factChecks: [
      { organization: "Reuters Fact Check", url: "https://www.reuters.com/fact-check/example", conclusion: "false", date: "2026-01-02" },
    ],
  });
  assert(factChecked.verdict === "false", `claims: a false fact-check is weighed as false (got ${factChecked.verdict})`);
  assert(
    /secondary judgement|someone else's judgement/i.test(factChecked.explanation),
    "claims: a fact-check is described as a judgement to weigh, not as the underlying evidence",
  );

  const emptyPassage = assessClaim({
    claim: "The report found 900 violations.",
    supporting: [{ url: "https://example.org/dead", passage: "   " }],
  });
  assert(emptyPassage.verdict === "unverified", "claims: an empty passage supports nothing (no invented evidence)");

  for (const verdict of Object.keys(CLAIM_LABELS) as ClaimVerdict[]) {
    const meta = labelForVerdict(verdict);
    assert(Boolean(meta.label && meta.explanation), `claims: the verdict "${verdict}" has a plain-English label`);
    assert(
      !/API|JSON|LLM|schema|endpoint|token|regex|SQL|verdict code/i.test(meta.label + " " + meta.explanation),
      `claims: the label for "${verdict}" carries no engineering vocabulary`,
    );
  }

  /* ================================================================ */
  section("source intelligence: assignment suitability (Parts 7, 11)");

  assert(evidenceSuitability(plainReport).allowed, "assignment: a real report is offered as evidence");
  assert(!evidenceSuitability(onion).allowed, "assignment: satire is refused as evidence");
  assert(!evidenceSuitability(sponsored).allowed, "assignment: advertising is refused as evidence");
  assert(
    /persuasive writing|example/i.test(evidenceSuitability(onion).reason),
    "assignment: the refusal gives the student a legitimate use for the satirical piece",
  );

  for (const format of Object.keys(STUDENT_LABELS) as ArticleFormat[]) {
    const meta = labelForFormat(format);
    assert(Boolean(meta.label && meta.explanation), `assignment: every format label exists (${format})`);
    assert(
      !/API|JSON|LLM|schema|endpoint|token|regex|SQL/i.test(meta.label + " " + meta.explanation),
      `assignment: the label for "${format}" carries no engineering vocabulary`,
    );
  }

  /* ================================================================ */
  section("source registry: a name in a file is not a connection (Part 4)");

  const counts = registryCounts();
  assert(counts.total >= 70, `registry: the catalogue is a real list (${counts.total} sources)`);
  for (const required of [
    "education",
    "academic_research",
    "government",
    "library_history",
    "news",
    "law",
    "fact_check",
    "computing",
    "philosophy",
  ]) {
    assert((counts.categories[required] ?? 0) > 0, `registry: category "${required}" has sources`);
  }
  assert(sourcesForCategory("fact_check").length >= 8, "registry: the directive's fact-checking organisations are all present");

  const missingField = SOURCE_REGISTRY.filter(
    (s) =>
      !s.id ||
      !s.name ||
      !s.description ||
      !s.website.startsWith("http") ||
      s.retrieval.length === 0 ||
      s.contentTypes.length === 0 ||
      !s.licensing ||
      !s.reliability,
  );
  assert(missingField.length === 0, `registry: every entry carries all required fields (${missingField.map((s) => s.id).join(", ")})`);

  const duplicateIds = SOURCE_REGISTRY.map((s) => s.id).filter((id, i, all) => all.indexOf(id) !== i);
  assert(duplicateIds.length === 0, "registry: ids are unique");

  const googleScholar = sourceById("google-scholar");
  assert(googleScholar !== null && googleScholar.retrieval.every((r) => r === "link_only"), "registry: Google Scholar is link-only");
  assert(googleScholar!.fullTextRetrieval === false, "registry: Google Scholar full text is never fetched");
  assert(
    googleScholar!.restrictions.some((r) => /never scrapes/i.test(r)),
    "registry: the no-scraping rule is written down where an owner reads it",
  );

  const licensed = ["jstor", "sciencedirect", "wiley", "acm-dl", "financial-times", "hathitrust"].map((id) => sourceById(id));
  assert(licensed.every((s) => s !== null), "registry: the licensed databases are all catalogued");
  assert(
    licensed.every((s) => s!.retrieval.includes("link_only")),
    "registry: every licensed database includes a link-only path (never scraped)",
  );
  assert(
    licensed.every((s) => s!.fullTextRetrieval === false),
    "registry: licensed full text is never marked fetchable",
  );

  assert(linkOnlySources().length >= 8, "registry: link-only sources are counted, not hidden");
  assert(
    fetchableSources().every((s) => s.retrieval.some((r) => r !== "link_only")),
    "registry: fetchable sources really do have a retrieval path",
  );

  resetSourceVerification();

  // Nothing is connected just because it is listed.
  const coldRows = catalogStatus(NO_ENV);
  assert(
    catalogCounts(coldRows).connected === 0,
    "registry honesty: no source is Connected on a fresh install, however complete the catalogue looks",
  );
  assert(
    coldRows.every((r) => r.state !== "connected"),
    "registry honesty: the word Connected never appears without a live check",
  );
  const alpha = sourceStatus(sourceById("openalex")!, NO_ENV);
  assert(
    alpha.state === "available" || alpha.state === "requires-owner-setup",
    `registry honesty: openalex reports a real state without a check (got ${alpha.state})`,
  );
  assert(
    !/Connected/i.test(alpha.explanation),
    "registry honesty: the explanation does not imply the source already works",
  );

  assert(markSourceVerified("openalex", "2026-11-01T00:00:00Z"), "registry: a successful live check can be recorded");
  const warm = sourceStatus(sourceById("openalex")!, { ...FULL_ENV, now: new Date("2026-11-15T00:00:00Z") });
  assert(warm.state === "connected", `registry: a verified, reachable source is Connected (got ${warm.state})`);

  const stale = sourceStatus(sourceById("openalex")!, {
    ...FULL_ENV,
    now: new Date(Date.parse("2026-11-01T00:00:00Z") + (VERIFICATION_STALE_DAYS + 1) * 86_400_000),
  });
  assert(stale.state === "needs-attention", `registry: an expired verification becomes Needs attention (got ${stale.state})`);

  resetSourceVerification();
  assert(
    sourceStatus(sourceById("openalex")!, FULL_ENV).state === "available",
    "registry: with no verification it falls back to Available, never Connected",
  );

  // A source needing a key is not 'available' when the key is absent.
  const needsKey = sourceStatus(sourceById("fred")!, { searchConfigured: true, hasEnv: () => false });
  assert(needsKey.state === "requires-owner-setup", `registry: a missing key is Requires owner setup (got ${needsKey.state})`);
  const hasKey = sourceStatus(sourceById("fred")!, { searchConfigured: true, hasEnv: () => true });
  assert(hasKey.state === "available", `registry: a present key makes it Available, still not Connected (got ${hasKey.state})`);

  // With web search switched off, a web-only source cannot be searched.
  const localOnly = sourceStatus(sourceById("bbc")!, NO_ENV);
  assert(localOnly.state === "requires-owner-setup", `registry: web search off is reported honestly (got ${localOnly.state})`);
  assert(/Your saved documents still work/i.test(localOnly.explanation), "registry: the student is told what DOES still work");

  const jstor = sourceStatus(sourceById("jstor")!, FULL_ENV);
  assert(jstor.state === "not-connected", `registry: a licensed database is not-connected, never connected (got ${jstor.state})`);
  assert(/your own access/i.test(jstor.explanation), "registry: a licensed database points the student at their own access");

  const allowedStates = new Set(["connected", "available", "not-connected", "needs-attention", "unavailable", "requires-owner-setup"]);
  assert(catalogStatus(FULL_ENV).every((r) => allowedStates.has(r.state)), "registry: every report uses one of the six known words");

  assert(FACT_CHECK_SOURCES.length >= 8, "registry: fact-checking sources are exported for the research pipeline");
  assert(
    FACT_CHECK_SOURCES.every((s) => s.restrictions.length > 0 || s.categories.includes("fact_check")),
    "registry: fact-check sources are catalogued as such",
  );

  /* ================================================================ */
  section("government boundary: public access kept, restricted access refused (Part 10)");

  const publicAllowed = [
    "https://www.census.gov/data/tables/2026/demo/popest.html",
    "https://www.nasa.gov/mission/artemis/",
    "https://www.supremecourt.gov/opinions/25pdf/23-1234_1a2b.pdf",
    "https://www.archives.gov/research/captured-german-records",
    "https://data.cdc.gov/",
    "https://www.loc.gov/collections/civil-war-maps/",
  ];
  for (const url of publicAllowed) {
    assert(evaluateSourceRequest(url).allowed, `government: public source allowed (${url})`);
  }

  assert(
    evaluateSourceRequest("http://169.254.169.254/latest/meta-data/").allowed === false,
    "government: a link-local metadata address is refused",
  );
  assert(isProhibitedHost("localhost"), "government: localhost is still a prohibited host");

  const blockedRequests = [
    "Find the classified annex to the operations briefing.",
    "Pull the NoForn cables about the summit.",
    "Show me the restricted database records for the programme.",
    "How do I bypass the clearance check to read that file?",
    "Get around the login on the government portal and download the records.",
    "Skip the MFA and open the restricted network documentation.",
  ];
  for (const text of blockedRequests) {
    assert(evaluateInformationRequest(text).blocked, `government: refused as written (${text})`);
  }

  const allowedRequests = [
    "Find public Census Bureau statistics about unemployment.",
    "Explain this NASA report about the lunar surface.",
    "Find the public Supreme Court opinion in that case.",
    "Summarise declassified historical documents about the programme.",
  ];
  for (const text of allowedRequests) {
    assert(!evaluateInformationRequest(text).blocked, `government: ordinary public research still allowed (${text})`);
  }

  /* ================================================================ */
  section("preserved contracts: nothing already shipped was replaced (Part 17)");

  const dupes = dedupeSources([
    { title: "a", url: "https://example.com/x?utm_source=news", snippet: "s" },
    { title: "b", url: "https://example.com/x", snippet: "s" },
    { title: "c", url: "https://example.com/y", snippet: "s" },
    { title: "d", url: "https://example.com/z", snippet: "s" },
  ]);
  assert(dupes.length === 2, `preserved: tracking parameters still dedupe to one URL and one domain is capped at two (got ${dupes.length})`);
  assert(normalizeUrl("https://example.com/x/?utm_source=a#frag") === "https://example.com/x", "preserved: normalizeUrl still strips tracking, slash and fragment");

  const queries = generateQueries({ topic: "causes of the First World War", sourceType: "peer-reviewed journal articles" }, 3);
  assert(queries.length === 3 && queries[0].query.includes("causes of the First World War"), "preserved: query generation still builds topic queries");
  assert(queries[0].query.includes("study journal"), "preserved: a peer-reviewed requirement still changes the query");

  assert(parseTeacherSourceType("peer-reviewed journal articles") === "peer_reviewed", "preserved: teacher source types still parse");
  assert(parseTeacherSourceType("primary documents") === "primary", "preserved: primary-source requirement still parses");

  const ranked = rankCandidates([
    { title: "blog", url: "https://someone.blogspot.com/post", snippet: "s" },
    { title: "gov", url: "https://www.nasa.gov/report", snippet: "s" },
  ]);
  const rankedHost = new URL(ranked[0].url).hostname.replace(/^www\./, "");
  assert(rankedHost === "nasa.gov", `preserved: candidate ranking still prefers official sources (got ${rankedHost})`);

  const apa = formatCitation(
    {
      title: "The Causes Of War",
      author: "Smith, Jane",
      publisher: "University Press",
      publicationDate: "2020-05-01",
      url: "https://example.org/book",
      accessedISO: "2026-11-15",
    },
    "APA",
  );
  assert(/Smith/.test(apa) && /\(2020\)/.test(apa), "preserved: APA formatting still produces a deterministic citation");

  assert(quoteInContent("a distinctive sentence", "prefix a distinctive sentence suffix"), "preserved: quote checking still finds verbatim text");
  assert(!quoteInContent("a paraphrase", "prefix a distinctive sentence suffix"), "preserved: a paraphrase is still not a quote");

  const verdict = verifyCitation({
    searchResultExisted: true,
    originalUrl: "https://example.org/article",
    finalUrl: "https://example.org/article",
    retrieval: null,
    passage: "A distinctive supporting sentence.",
    claim: "A distinctive supporting sentence is true.",
    authorityOk: true,
    citationSource: {
      title: "Article",
      author: "Doe, Jane",
      publisher: "Journal",
      publicationDate: "2025-01-01",
      url: "https://example.org/article",
      accessedISO: "2026-11-15",
    },
  });
  assert(verdict.steps.length === 12, `preserved: the citation invariant still has 12 steps (got ${verdict.steps.length})`);
  assert(
    verdict.status !== ("VERIFIED" as CitationStatus),
    "preserved: a citation without a real retrieval record is never VERIFIED",
  );
  assert(
    ["VERIFIED", "UNVERIFIED", "UNAVAILABLE", "STALE"].includes(verdict.status),
    "preserved: the four citation statuses keep their meanings",
  );

  const readiness = researchReadiness();
  assert(
    ["external", "local", "unconfigured"].includes(readiness.availability),
    "preserved: research readiness still separates external, local and unconfigured",
  );
  assert(typeof readiness.studentMessage === "string", "preserved: the student message still exists for the honest failure path");

  /* ================================================================ */
  section("source intelligence: wiring and honesty of the new files (Parts 1, 19)");

  const intelligence = readFileSync("src/lib/research/source-intelligence.ts", "utf8");
  assert(!/fetch\(|https?:\/\/(?!www\.|api\.)/.test(intelligence.replace(/\/\/.*$/gm, "")), "wiring: the classifier performs no network call");
  assert(!/process\.env/.test(intelligence), "wiring: the classifier reads no environment or secret");
  assert(!/from "\.\/claims"|from "\.\/authority"/.test(intelligence), "wiring: the classifier neither replaces nor imports the ranking and claim engines");

  const registry = readFileSync("src/lib/research/source-registry.ts", "utf8");
  assert(!/process\.env/.test(registry), "wiring: the registry never reads a secret itself");
  assert(/never scrapes it/i.test(registry), "wiring: the no-scraping rule is in the source, not only in a document");
  assert(
    /hasEnv: \(name: string\) => boolean/.test(registry),
    "wiring: capability is asked as a yes/no question, so no key value is ever handled here",
  );

  assert(coverageOf("unemployment rose in May", "unemployment rose sharply in May across the region") > 0.6, "wiring: coverage measurement is deterministic");
  assert(coverageOf("unrelated words entirely", "unemployment rose in May") === 0, "wiring: coverage does not invent overlap");
}
