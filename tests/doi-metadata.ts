/**
 * DOI METADATA TESTS (directive 2026-11-15, Part 6 items 1-5; Part 14 "academic research").
 *
 * Offline by construction: the resolver is injected, so the parsing and the judgement
 * are exercised against recorded Crossref shapes and no network call is made.
 *
 * The defect these tests exist for: before this round a DOI was treated as proof of
 * peer review, and a retracted paper still passed. Both are now separate questions with
 * separate honest answers.
 */
import {
  assessDoiRecord,
  doiFromText,
  doiFromUrl,
  isDoi,
  normalizeDoi,
  parseCrossrefWork,
  preprintServerFor,
  resolveDoi,
  DOI_MESSAGES,
  type DoiResolver,
} from "../src/lib/research/doi";

type Assert = (condition: boolean, message: string) => void;

const JOURNAL_WORK = {
  message: {
    DOI: "10.1038/s41586-026-01234-5",
    type: "journal-article",
    title: ["A measured result in climate science"],
    "container-title": ["Nature"],
    publisher: "Springer Nature",
    author: [
      { family: "Okafor", given: "Ada" },
      { family: "Lindqvist", given: "Bo" },
    ],
    issued: { "date-parts": [[2026, 2, 11]] },
    license: [{ URL: "https://creativecommons.org/licenses/by/4.0/" }],
    URL: "https://doi.org/10.1038/s41586-026-01234-5",
  },
};

const PREPRINT_WORK = {
  message: {
    DOI: "10.1101/2026.02.01.123456",
    type: "posted-content",
    title: ["A preprint about cell signalling"],
    publisher: "bioRxiv",
    author: [{ family: "Reyes", given: "M" }],
    issued: { "date-parts": [[2026, 2, 1]] },
  },
};

const RETRACTED_WORK = {
  message: {
    DOI: "10.1016/j.example.2019.01.001",
    type: "journal-article",
    title: ["A trial that was later withdrawn"],
    "container-title": ["Journal of Examples"],
    publisher: "Elsevier",
    author: [{ family: "Doe", given: "Jane" }],
    issued: { "date-parts": [[2019, 1, 1]] },
    "update-to": [{ type: "retraction", DOI: "10.1016/j.example.2019.01.001.retract", updated: { "date-parts": [[2021, 6, 30]] }, label: "Retraction" }],
  },
};

const CORRECTED_WORK = {
  message: {
    DOI: "10.1017/example.2020.5",
    type: "journal-article",
    title: ["A corrected result"],
    "container-title": ["Journal of Corrections"],
    author: [{ family: "Park", given: "Sun" }],
    issued: { "date-parts": [[2020, 5]] },
    "update-to": [{ type: "correction", updated: { "date-parts": [[2020, 9, 2]] } }],
  },
};

function fixedResolver(byDoi: Record<string, unknown | null>): DoiResolver {
  return {
    async fetchWork(doi: string) {
      if (doi in byDoi) return byDoi[doi];
      return null;
    },
  };
}

function failingResolver(): DoiResolver {
  return {
    async fetchWork() {
      throw new Error("network timeout");
    },
  };
}

export async function runDoiTests(assert: Assert, section: (name: string) => void) {
  section("doi metadata: syntax, extraction and honesty (Part 6)");

  assert(normalizeDoi("10.1038/s41586-026-01234-5") === "10.1038/s41586-026-01234-5", "doi: a bare DOI normalises to itself");
  assert(normalizeDoi("https://doi.org/10.1038/S41586-026-01234-5") === "10.1038/s41586-026-01234-5", "doi: a resolver address becomes a bare, lower-case DOI");
  assert(normalizeDoi("doi: 10.1101/2026.02.01.123456") === "10.1101/2026.02.01.123456", "doi: a 'doi:' prefix is stripped");
  assert(normalizeDoi("see 10.1016/j.example.2019.01.001.") === "10.1016/j.example.2019.01.001", "doi: trailing punctuation is not part of the identifier");
  assert(normalizeDoi("not a doi at all") === null, "doi: ordinary text is not a DOI");
  assert(normalizeDoi(null) === null, "doi: a missing value stays missing");
  assert(!isDoi("12345"), "doi: a bare number is not accepted as a DOI");
  assert(isDoi("10.1000/xyz123"), "doi: a minimal registrant/suffix pair is accepted");

  assert(doiFromText("Abstract text. https://doi.org/10.1038/nature12373 is the record.") === "10.1038/nature12373", "doi: found inside free text");
  assert(doiFromUrl("https://doi.org/10.1038/nature12373") === "10.1038/nature12373", "doi: found inside an address");
  assert(doiFromText("no identifier here") === null, "doi: absent in text is absent, not guessed");

  assert(preprintServerFor("10.1101/2026.02.01.123456") === "bioRxiv or medRxiv", "doi: a bioRxiv registrant is a preprint server");
  assert(preprintServerFor("10.48550/arxiv.2603.01234") === "arXiv", "doi: an arXiv registrant is a preprint server");
  assert(preprintServerFor("10.1038/s41586-026-01234-5") === null, "doi: a journal registrant is not a preprint server");

  section("doi metadata: parsing the registration record");

  const journal = parseCrossrefWork(JOURNAL_WORK);
  assert(journal !== null, "doi: a journal article record parses");
  assert(journal!.title === "A measured result in climate science", "doi: the title comes from the record");
  assert(journal!.venue === "Nature", "doi: the venue comes from the record");
  assert(journal!.year === 2026 && journal!.publishedDate === "2026-02-11", "doi: the publication date is read, not invented");
  assert(journal!.authors.length === 2 && journal!.authors[0].family === "Okafor", "doi: authors are read in order");
  assert(journal!.workType === "journal-article", "doi: the work type is recorded");
  assert(!journal!.authors[0].organisation, "doi: a person is not marked as an organisation");

  const noDate = parseCrossrefWork({ message: { DOI: "10.1000/nodate", type: "journal-article", title: ["No date here"] } });
  assert(noDate !== null && noDate.year === null && noDate.publishedDate === null, "doi: a missing date stays missing (never today's date)");
  assert(noDate!.venue === null, "doi: a missing venue stays missing");

  const orgAuthor = parseCrossrefWork({
    message: { DOI: "10.1000/org", type: "report", title: ["Agency report"], author: [{ name: "World Health Organization" }] },
  });
  assert(orgAuthor!.authors[0].organisation, "doi: an organisational author is marked as an organisation");
  assert(orgAuthor!.authors[0].family === "World Health Organization", "doi: the organisational name is preserved verbatim");

  const partialDate = parseCrossrefWork({ message: { DOI: "10.1000/yearonly", type: "journal-article", title: ["T"], issued: { "date-parts": [[2018]] } } });
  assert(partialDate!.publishedDate === "2018", "doi: a year-only date is reported as a year, not padded with a fake month or day");

  assert(parseCrossrefWork({ message: { type: "journal-article" } }) === null, "doi: a record without an identifier is refused");
  assert(parseCrossrefWork(null) === null, "doi: nothing is not a record");
  assert(parseCrossrefWork({ message: { DOI: "garbage" } }) === null, "doi: a malformed identifier is refused");

  const garbage = parseCrossrefWork({ message: { DOI: "10.1000/odd", title: [{ unexpected: true }], author: "not-an-array" } });
  assert(garbage !== null, "doi: a record with odd field shapes still parses");
  assert(garbage!.authors.length === 0, "doi: an unreadable author list becomes empty, not fabricated");

  section("doi metadata: peer review is never assumed from a DOI (Part 6.4)");

  const journalAssessment = assessDoiRecord(journal, "10.1038/s41586-026-01234-5");
  assert(
    journalAssessment.peerReview === "research_unconfirmed",
    `doi: a journal article is UNCONFIRMED review, not 'peer reviewed' (got ${journalAssessment.peerReview})`,
  );
  assert(journalAssessment.citableAsReviewed, "doi: an unconfirmed journal article with a venue may still be cited as a journal article");
  assert(
    journalAssessment.uncertainty.includes("not recorded in the DOI registration"),
    "doi: the reason review cannot be confirmed from the record is stated",
  );
  assert(journalAssessment.usable && journalAssessment.publicationState === "clean", "doi: a resolved record with no updates is clean");

  const preprintRecord = parseCrossrefWork(PREPRINT_WORK);
  const preprintAssessment = assessDoiRecord(preprintRecord, "10.1101/2026.02.01.123456");
  assert(preprintAssessment.peerReview === "preprint", `doi: a bioRxiv DOI is a preprint (got ${preprintAssessment.peerReview})`);
  assert(
    preprintAssessment.notes.join(" ").includes("not been reviewed"),
    "doi: the preprint note says it has not been reviewed",
  );
  assert(!preprintAssessment.citableAsReviewed, "doi: a preprint is never citable as reviewed research");

  const datasetRecord = parseCrossrefWork({ message: { DOI: "10.5061/dryad.abc", type: "dataset", title: ["A dataset"] } });
  assert(assessDoiRecord(datasetRecord, "10.5061/dryad.abc").peerReview === "not_research", "doi: a dataset DOI is not research");

  section("doi metadata: retraction and correction (Part 6.5)");

  const retracted = parseCrossrefWork(RETRACTED_WORK);
  assert(retracted!.updates.length === 1 && retracted!.updates[0].type === "retraction", "doi: a retraction update is parsed");
  assert(retracted!.updates[0].date === "2021-06-30", "doi: the retraction date is recorded");
  const retractedAssessment = assessDoiRecord(retracted, "10.1016/j.example.2019.01.001");
  assert(retractedAssessment.publicationState === "retracted", "doi: a retraction is reported as retracted");
  assert(!retractedAssessment.usable, "doi: a retracted work is not usable");
  assert(
    retractedAssessment.notes.join(" ").includes("must not be used"),
    "doi: the student is told plainly that a retracted paper cannot be used",
  );

  const correctedAssessment = assessDoiRecord(parseCrossrefWork(CORRECTED_WORK), "10.1017/example.2020.5");
  assert(correctedAssessment.publicationState === "corrected", "doi: a correction is reported as corrected");
  assert(correctedAssessment.usable, "doi: a corrected paper is still usable, with the correction noted");

  const concernRecord = parseCrossrefWork({
    message: { DOI: "10.1000/concern", type: "journal-article", title: ["Flagged"], "update-to": [{ type: "expression_of_concern" }] },
  });
  assert(assessDoiRecord(concernRecord, "10.1000/concern").publicationState === "expression_of_concern", "doi: a concern is its own state");

  const relationRetracted = parseCrossrefWork({
    message: { DOI: "10.1000/related", type: "journal-article", title: ["Related"], relation: { "is-retracted-by": [{ id: "10.1000/r" }] } },
  });
  assert(
    assessDoiRecord(relationRetracted, "10.1000/related").publicationState === "retracted",
    "doi: a retraction declared as a relation is also caught",
  );

  section("doi metadata: resolution states are never confused (Parts 6, 15)");

  const ok = await resolveDoi("10.1038/s41586-026-01234-5", fixedResolver({ "10.1038/s41586-026-01234-5": JOURNAL_WORK }));
  assert(ok.state === "resolved", `doi: a registered DOI resolves (got ${ok.state})`);
  assert(ok.assessment?.record?.title === "A measured result in climate science", "doi: the resolved record is returned");

  const missing = await resolveDoi("10.9999/does-not-exist", fixedResolver({}));
  assert(missing.state === "not_registered", `doi: an unregistered DOI is not_registered (got ${missing.state})`);
  assert(missing.message === DOI_MESSAGES.notRegistered, "doi: the unregistered message is the honest one");

  const down = await resolveDoi("10.1038/s41586-026-01234-5", failingResolver());
  assert(down.state === "unavailable", `doi: a failing service is unavailable, NOT not_registered (got ${down.state})`);
  assert(
    down.message === DOI_MESSAGES.unavailable && down.message.includes("Nothing was invented"),
    "doi: an unreachable service says the citation is unconfirmed, and says nothing was invented",
  );

  const bad = await resolveDoi("certainly not a doi", fixedResolver({}));
  assert(bad.state === "invalid", "doi: a malformed identifier is never looked up");

  const emptyAssessment = assessDoiRecord(null, "10.9999/none");
  assert(!emptyAssessment.usable && emptyAssessment.peerReview === "unknown", "doi: an unresolved DOI teaches nothing, so nothing is claimed");
  assert(
    emptyAssessment.uncertainty.includes("must not be cited as verified"),
    "doi: an unresolved DOI is explicitly not citable as verified",
  );

  for (const message of Object.values(DOI_MESSAGES)) {
    assert(
      !/API|JSON|HTTP|404|Crossref|endpoint|token|schema/i.test(message),
      "doi: student-facing messages name no vendor, code or status",
    );
  }

  section("doi metadata: the live resolver is bounded (Part 15)");

  const { readFileSync } = await import("fs");
  const source = readFileSync("src/lib/research/doi.ts", "utf8");
  assert(/AbortSignal\.timeout\(\d/.test(source), "doi: the live call has an explicit timeout");
  assert(/api\.crossref\.org/.test(source), "doi: the live call contacts the registration agency, not an arbitrary host");
  assert(!/process\.env/.test(source), "doi: no key or environment variable is read");
  assert(/if \(res\.status === 404\) return null/.test(source), "doi: a 404 is the only 'not registered' answer; other failures are not");
}
