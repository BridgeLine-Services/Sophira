/**
 * SOURCE INTELLIGENCE (directive 2026-11-15, Part 5).
 *
 * A dedicated, independently testable classifier for WHAT KIND OF SOURCE a page is
 * and WHAT THE EVIDENCE SUPPORTS about a claim. It is deliberately separate from the
 * three engines it must never replace:
 *
 *   authority.ts          ranks a source FOR AN ASSIGNMENT (unchanged)
 *   claims.ts             traces a claim to a verbatim retrieved passage (unchanged)
 *   citation-invariant.ts checks citation integrity in 12 steps (unchanged)
 *
 * This module adds the judgement those three do not make: is this satire, opinion,
 * fiction, sponsored, a preprint, retracted, or a real report - and is a factual claim
 * supported, contradicted, disputed, misleading, or simply unknown.
 *
 * NON-NEGOTIABLE RULES ENCODED HERE
 *  1. A satire publication is not "false". Satire is a format, and a satirical article
 *     may discuss a genuinely true event. It is simply unusable as FACTUAL evidence.
 *  2. A claim is never "false" merely because no supporting source was found. Absence
 *     of evidence returns `unverified`, and says so in plain words.
 *  3. A fact-check is evidence to weigh, not a verdict to copy.
 *  4. No model-generated percentages: every confidence is computed from observable
 *     signals counted in this file, and every assessment lists them.
 *  5. Nothing here invents content. No passage, no support.
 *
 * Pure: no network, no filesystem, no LLM. Deterministic for the same input.
 */

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

/** What FORMAT is this page? A page may carry several (a satirical article about a real event). */
export type ArticleFormat =
  | "verified_factual_reporting"
  | "news_reporting"
  | "investigative_reporting"
  | "opinion"
  | "editorial"
  | "commentary"
  | "satire"
  | "parody"
  | "fiction"
  | "sponsored"
  | "press_release"
  | "peer_reviewed"
  | "preprint"
  | "primary_source"
  | "secondary_source"
  | "government_publication"
  | "educational_resource"
  | "reference_work"
  | "dataset"
  | "unknown";

/** Peer-review status, stated honestly. */
export type PeerReviewStatus = "peer_reviewed" | "preprint" | "research_unconfirmed" | "not_research" | "unknown";

/** Publication integrity, from reliable metadata only. */
export type PublicationState = "retracted" | "corrected" | "expression_of_concern" | "clean" | "unknown";

export type MisinformationRisk = "low" | "elevated" | "high" | "unknown";

export type ClaimVerdict =
  | "supported"
  | "partially_supported"
  | "unverified"
  | "disputed"
  | "misleading"
  | "false"
  | "satirical_only";

export type ConfidenceBand = "low" | "moderate" | "high";

export type EvidenceRole = "primary" | "secondary" | "unclear";

/* ------------------------------------------------------------------ */
/* Plain-English labels (Part 11)                                      */
/* ------------------------------------------------------------------ */

/**
 * The words a student reads. One vocabulary, no engineering terms, and every label
 * that needs it carries a sentence of explanation.
 */
export const STUDENT_LABELS: Record<ArticleFormat, { label: string; explanation: string }> = {
  verified_factual_reporting: {
    label: "Verified reporting",
    explanation: "A news report whose main factual claims you can check against at least two independent sources.",
  },
  news_reporting: {
    label: "News reporting",
    explanation: "Reported facts by a news organisation. It can be accurate and still be wrong on a detail, so check important figures against the original document.",
  },
  investigative_reporting: {
    label: "Investigative reporting",
    explanation: "Original fact-finding by journalists, usually based on documents or interviews.",
  },
  opinion: {
    label: "Opinion",
    explanation: "Someone's view. It can be well informed, but it is not evidence that the view is correct.",
  },
  editorial: {
    label: "Editorial",
    explanation: "The publication's own institutional view, written by its editorial board rather than reporting a fact.",
  },
  commentary: {
    label: "Commentary",
    explanation: "Analysis or argument around the news, not a first-hand report.",
  },
  satire: {
    label: "Satire",
    explanation: "Deliberate humour that imitates news. It is not factual reporting and must not be used as evidence, even when it mentions a real event.",
  },
  parody: {
    label: "Parody",
    explanation: "A deliberate imitation for comic effect. Treat it as humour, never as a source of fact.",
  },
  fiction: {
    label: "Fiction",
    explanation: "An invented story. Useful for studying narrative, never as evidence about the real world.",
  },
  sponsored: {
    label: "Sponsored content",
    explanation: "Paid material. It is advertising, so treat its claims as a sales pitch.",
  },
  press_release: {
    label: "Press release",
    explanation: "An organisation describing itself. Useful as a statement of what that organisation says, not as independent confirmation.",
  },
  peer_reviewed: {
    label: "Peer-reviewed",
    explanation: "Research checked by other specialists before publication. The strongest academic evidence, though a single paper is still one result.",
  },
  preprint: {
    label: "Preprint",
    explanation: "Research shared publicly before peer review. Valuable and current, but not yet checked by other specialists.",
  },
  primary_source: {
    label: "Primary source",
    explanation: "The original material itself: a document, dataset, letter, statute or first-hand study.",
  },
  secondary_source: {
    label: "Secondary source",
    explanation: "A description or analysis of something original, such as a textbook or a news summary.",
  },
  government_publication: {
    label: "Government publication",
    explanation: "Published by an official body. Being official makes it authoritative for what that body says, not automatically correct about everything.",
  },
  educational_resource: {
    label: "Educational resource",
    explanation: "Written to teach a topic. Reliable for explanation and revision, usually not citable as original research.",
  },
  reference_work: {
    label: "Reference work",
    explanation: "An encyclopedia or similar summary. Good for orientation; follow its citations to the original evidence.",
  },
  dataset: {
    label: "Dataset",
    explanation: "Raw data you can analyse yourself. The most direct evidence there is, if you use the right variables and years.",
  },
  unknown: {
    label: "Not identified",
    explanation: "Sophira could not tell what kind of source this is, so treat it with caution and check it another way.",
  },
};

export const CLAIM_LABELS: Record<ClaimVerdict, { label: string; explanation: string }> = {
  supported: {
    label: "Supported",
    explanation: "Retrieved evidence says the same thing, and nothing found contradicts it.",
  },
  partially_supported: {
    label: "Partly supported",
    explanation: "The evidence supports some of this, but not all of it. Use the narrower version.",
  },
  unverified: {
    label: "Not verified",
    explanation: "No evidence was found either way. That is not the same as false, and it is not proof.",
  },
  disputed: {
    label: "Disputed",
    explanation: "Credible evidence has been found on both sides of this claim.",
  },
  misleading: {
    label: "Misleading",
    explanation: "Something in it is real but presented in a way that would give a reader the wrong impression.",
  },
  false: {
    label: "Contradicted",
    explanation: "More than one credible source directly contradicts this.",
  },
  satirical_only: {
    label: "Only in satire",
    explanation: "This appears only in satirical writing. It is humour, not a factual claim, and cannot be used as evidence.",
  },
};

export function labelForFormat(format: ArticleFormat): { label: string; explanation: string } {
  return STUDENT_LABELS[format] ?? STUDENT_LABELS.unknown;
}

export function labelForVerdict(verdict: ClaimVerdict): { label: string; explanation: string } {
  return CLAIM_LABELS[verdict];
}

/* ------------------------------------------------------------------ */
/* Known publications                                                  */
/* ------------------------------------------------------------------ */

export interface KnownSatiricalPublication {
  /** Hostname without www., or a hostname + path prefix for a section. */
  host: string;
  pathPrefix?: string;
  name: string;
  note: string;
}

/**
 * Publications whose editorial MISSION is satire. Treated as a strong initial signal
 * only: the classification still records the article's other formats, and a factual
 * statement inside satire can still be checked independently.
 */
export const SATIRICAL_PUBLICATIONS: KnownSatiricalPublication[] = [
  {
    host: "theonion.com",
    name: "The Onion",
    note: "A satirical newspaper: every article is written as parody of news reporting.",
  },
  {
    host: "babylonbee.com",
    name: "The Babylon Bee",
    note: "A satirical site: articles are written as jokes in a news format.",
  },
  {
    host: "newyorker.com",
    pathPrefix: "/humor/borowitz-report",
    name: "The Borowitz Report (The New Yorker)",
    note: "A satirical column inside a real magazine. The surrounding magazine is not satire; this section is.",
  },
  {
    host: "clickhole.com",
    name: "ClickHole",
    note: "Satire of clickbait and online media, in a news-like format.",
  },
  {
    host: "reductress.com",
    name: "Reductress",
    note: "Satirical women's-magazine parody.",
  },
  {
    host: "thehardtimes.net",
    name: "The Hard Times",
    note: "Satirical music and culture reporting.",
  },
  {
    host: "thebeaverton.com",
    name: "The Beaverton",
    note: "Canadian satirical news site.",
  },
  {
    host: "duffelblog.com",
    name: "Duffel Blog",
    note: "Satirical military news.",
  },
  {
    host: "waterfordwhispersnews.com",
    name: "Waterford Whispers News",
    note: "Irish satirical news site.",
  },
];

/**
 * Sections of otherwise real publications that are humour or opinion rather than
 * reporting. Used to keep a genuinely reported article from inheriting the section's
 * weakness, and to keep a joke from being cited as news.
 */
export const HUMOUR_PATH_PREFIXES = ["/humor", "/humour", "/satire", "/comedy", "/the-borowitz-report", "/shouts-and-murmurs"];

const OPINION_PATH_PREFIXES = [
  "/opinion",
  "/opinions",
  "/editorial",
  "/editorials",
  "/oped",
  "/op-ed",
  "/commentary",
  "/commentisfree",
  "/voices",
  "/column",
  "/columns",
  "/perspective",
  "/analysis-opinion",
];

const SPONSORED_PATH_PREFIXES = ["/sponsored", "/paid", "/advertisement", "/partner-content", "/brand-studio", "/paid-content"];

const PRESS_RELEASE_PATH_PREFIXES = ["/press-release", "/press-releases", "/newsroom", "/media-release", "/media-releases"];

const PREPRINT_HOSTS = [
  "arxiv.org",
  "biorxiv.org",
  "medrxiv.org",
  "chemrxiv.org",
  "techrxiv.org",
  "eartharxiv.org",
  "ssrn.com",
  "researchsquare.com",
  "preprints.org",
  "osf.io",
  "psyarxiv.com",
  "edarxiv.org",
];

const PREPRINT_DOI_PREFIXES = ["10.48550/arxiv", "10.1101/", "10.2139/ssrn", "10.31234/"];

const ARCHIVE_PRIMARY_HOSTS = [
  "archives.gov",
  "loc.gov",
  "si.edu",
  "nationalarchives.gov.uk",
  "founders.archives.gov",
  "avalon.law.yale.edu",
  "presidency.ucsb.edu",
  "catalog.archives.gov",
  "ourdocuments.gov",
  "docsteach.org",
];

const COURT_AND_STATUTE_SIGNALS =
  /(supreme court|opinion of the court|u\.?s\.?c\.? §|statute|court of appeals|docket|plaintiff|defendant|united states code|code of federal regulations|public law \d|bill text|act of congress)/i;

const DATASET_SIGNALS = /(dataset|data set|time series|\.csv\b|\.xlsx\b|api endpoint|table \d|download the data|microdata)/i;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function matchesKnownSatire(host: string, path: string): KnownSatiricalPublication | null {
  for (const pub of SATIRICAL_PUBLICATIONS) {
    if (host !== pub.host && !host.endsWith(`.${pub.host}`)) continue;
    if (pub.pathPrefix && !path.startsWith(pub.pathPrefix)) continue;
    return pub;
  }
  return null;
}

function startsWithAny(path: string, prefixes: string[]): string | null {
  for (const p of prefixes) if (path.startsWith(p)) return p;
  return null;
}

/** Finds an opinion/editorial SECTION anywhere in the path, not only at its start. */
function opinionSegmentOf(path: string): string | null {
  const segments = path.split("/").filter(Boolean);
  const bare = OPINION_PATH_PREFIXES.map((p) => p.replace(/^\//, ""));
  for (const seg of segments) {
    for (const prefix of bare) {
      if (seg === prefix || seg.startsWith(`${prefix}-`)) return seg;
    }
  }
  return null;
}

/** Typosquat detection: "abcnews.com.co" imitating "abcnews.com". Objective, not editorial. */
const IMPERSONATED_HOSTS = [
  "abcnews.com",
  "cbsnews.com",
  "nbcnews.com",
  "cnn.com",
  "bbc.com",
  "reuters.com",
  "apnews.com",
  "nytimes.com",
  "washingtonpost.com",
  "theguardian.com",
  "npr.org",
  "usatoday.com",
  "snopes.com",
  "who.int",
  "cdc.gov",
  "nasa.gov",
  "nih.gov",
];

export function looksLikeImpersonation(host: string): string | null {
  if (!host) return null;
  for (const real of IMPERSONATED_HOSTS) {
    if (host === real) continue;
    const realLabel = real.split(".")[0];
    // abcnews.com.co  /  cnn.com.co  /  reuters.co  /  bbcnews.com
    if (host.startsWith(`${real}.`) || host === `${realLabel}.co` || host === `${realLabel}.news` || host === `${realLabel}.info`) {
      return real;
    }
    if (host.replace(/[^a-z]/g, "") === `${realLabel}news` && real !== `${realLabel}news.com`) return real;
  }
  return null;
}

/** How much of the claim's vocabulary the passage covers (rough, deterministic). */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "in", "on", "to", "is", "are", "was", "were", "be", "been",
  "that", "this", "for", "with", "as", "by", "it", "its", "their", "they", "have", "has", "had",
  "not", "but", "from", "at", "which", "who", "than", "then", "so", "such", "can", "may", "might",
  "will", "would", "should", "could", "more", "most", "some", "any", "all", "no", "there", "about",
]);

function contentWords(text: string): Set<string> {
  const words = (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
  return new Set(words);
}

export function coverageOf(claim: string, passage: string): number {
  const c = contentWords(claim);
  if (c.size === 0) return 0;
  const p = contentWords(passage);
  let hits = 0;
  c.forEach((w) => {
    if (p.has(w)) hits++;
  });
  return hits / c.size;
}

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,.]*\s?(%|percent|million|billion|thousand)?/gi) ?? []).map((n) =>
    n.replace(/\s+/g, " ").trim().toLowerCase(),
  );
}

function band(confidence: number): ConfidenceBand {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.45) return "moderate";
  return "low";
}

/* ------------------------------------------------------------------ */
/* Source assessment                                                   */
/* ------------------------------------------------------------------ */

export interface SourceMetadata {
  /** Set only from a reliable record (Crossref update-to, publisher notice). */
  retracted?: boolean;
  corrected?: boolean;
  expressionOfConcern?: boolean;
  /** Did the caller actually check a retraction record? Absence of a record is not proof. */
  retractionChecked?: boolean;
  peerReviewed?: boolean;
  venue?: string | null;
  /** Format the publisher itself declares, e.g. "Opinion", "Satire". */
  declaredFormat?: string | null;
  section?: string | null;
}

/**
 * The compact form stored beside a verified source and shown on screen (Part 8 wiring).
 *
 * Deliberately small: every field here is something a student can read. The full
 * assessment stays in this module, so the stored record never becomes a second copy of
 * the classifier's internals that could drift from it.
 */
export interface SourceSummary {
  /** The student-facing words, e.g. "News reporting", "Satire", "Opinion". */
  label: string;
  /** One sentence a non-specialist can act on. */
  explanation: string;
  primaryFormat: ArticleFormat;
  formats: ArticleFormat[];
  role: "primary" | "secondary" | "unclear";
  peerReview: PeerReviewStatus;
  publicationState: PublicationState;
  risk: MisinformationRisk;
  satire: boolean;
  /** May this be used as factual evidence for an assignment? */
  usable: boolean;
  /** Why not, when it may not. */
  blockedReason: string | null;
  uncertainty: string;
}

/** Reduces a full assessment to the stored, student-facing summary. Pure. */
export function summarizeSourceAssessment(assessment: SourceAssessment): SourceSummary {
  const suitability = evidenceSuitability(assessment);
  return {
    label: assessment.label,
    explanation: assessment.explanation,
    primaryFormat: assessment.primaryFormat,
    formats: assessment.formats,
    role: assessment.evidenceRole,
    peerReview: assessment.peerReview,
    publicationState: assessment.publicationState,
    risk: assessment.misinformationRisk,
    satire: assessment.satire.isSatire,
    usable: suitability.allowed && assessment.usableAsEvidence,
    blockedReason: suitability.allowed && assessment.usableAsEvidence ? null : suitability.reason,
    uncertainty: assessment.uncertainty,
  };
}

export interface SourceAssessmentInput {
  url: string;
  title?: string | null;
  publisher?: string | null;
  byline?: string | null;
  snippet?: string | null;
  content?: string | null;
  publishedDate?: string | null;
  doi?: string | null;
  metadata?: SourceMetadata;
  /** How many genuinely independent sources the caller has already found for the main claim. */
  corroboration?: { independentSources: number; checkedAt?: string } | null;
  /** Clock for the verification date. Injectable so tests are deterministic. */
  asOf?: Date;
}

export interface SourceAssessment {
  url: string;
  host: string;
  /** Every format that genuinely applies, most specific first. */
  formats: ArticleFormat[];
  /** The single best description of the page, for a label on screen. */
  primaryFormat: ArticleFormat;
  satire: { isSatire: boolean; isParody: boolean; confidence: number; signals: string[] };
  peerReview: PeerReviewStatus;
  evidenceRole: EvidenceRole;
  publicationState: PublicationState;
  /** True when a retraction record was actually consulted. */
  retractionChecked: boolean;
  misinformationRisk: MisinformationRisk;
  /** May this be used as factual evidence in academic work? */
  usableAsEvidence: boolean;
  /** Plain-English version of the verdict, safe to show a student. */
  label: string;
  explanation: string;
  /** Observable reasons, in order of weight. */
  evidence: string[];
  /** What still cannot be determined. */
  uncertainty: string;
  confidence: number;
  confidenceBand: ConfidenceBand;
  checkedAt: string;
}

const SENSATIONAL = /(shocking|you won'?t believe|miracle|secret cure|doctors hate|they don'?t want you to know|bombshell|explosive|outrageous|insane|mind-?blowing)/i;
const ABSURD_MARKERS = /(time travell?er|alien(s)? (landed|built|wrote)|unicorn|leprechaun|zombie apocalypse|sentient (toaster|robot uprising)|shark (on|in) (a )?(highway|sidewalk)|bigfoot (elected|appointed)|teleport)/i;
/** The publisher declaring the piece itself is satire, parody or fiction. Decisive alone. */
const SELF_DECLARED_SATIRE =
  /(this (article|story|post|piece|column|site|publication|account) is (a |an )?(satir\w*|parody|spoof|fictional|humou?r|not real)|(is|are) (a |an )?(satirical|parody|fictional) (publication|site|account|column|newspaper)|satire disclaimer|parody (site|account)|not intended to be (taken|read) as (fact|real|news)|works? of (satire|fiction))/i;
const FICTION_MARKERS = /(a novel by|chapter (one|1)\b|once upon a time|fiction|short story|he said, she said|the end\.|prologue)/i;

export function assessSource(input: SourceAssessmentInput): SourceAssessment {
  const now = input.asOf ?? new Date();
  const host = hostOf(input.url);
  const path = pathOf(input.url);
  const meta = input.metadata ?? {};
  const title = input.title ?? "";
  const text = `${title} ${input.snippet ?? ""} ${(input.content ?? "").slice(0, 6000)}`;
  const evidence: string[] = [];
  const uncertainty: string[] = [];

  /* ---- 1. Satire and parody ---------------------------------------- */
  const known = matchesKnownSatire(host, path);
  const satireSignals: string[] = [];
  let satireScore = 0;

  if (known) {
    satireScore += 0.72;
    satireSignals.push(`${known.name} is a known satirical publication: ${known.note}`);
  }
  if (SELF_DECLARED_SATIRE.test(text)) {
    satireScore += 0.62;
    satireSignals.push("The page itself says it is satire, parody or fiction, so there is nothing to infer.");
  }
  if (startsWithAny(path, HUMOUR_PATH_PREFIXES)) {
    satireScore += 0.18;
    satireSignals.push(`The address is inside a humour section (${path.split("/")[1] ?? "humour"}).`);
  }
  if (ABSURD_MARKERS.test(text) && (known || SELF_DECLARED_SATIRE.test(text) || SENSATIONAL.test(text))) {
    satireScore += 0.12;
    satireSignals.push("The scenario described is impossible or absurd, which real reporting would not present as fact.");
  }
  if (SENSATIONAL.test(text)) {
    satireScore += 0.06;
    satireSignals.push("The wording is written to shock rather than to inform.");
  }

  const satireConfidence = Math.min(0.95, Number(satireScore.toFixed(2)));
  const isSatire = satireConfidence >= 0.5;
  const isParody = isSatire && /parody|spoof/i.test(`${text} ${meta.declaredFormat ?? ""}`);

  if (isSatire) {
    evidence.push(
      known
        ? `Publication format: satire. ${known.name} publishes humorous imitations of news, not factual reporting.`
        : "The page reads as satire or parody rather than factual reporting.",
    );
  } else if (satireScore > 0) {
    uncertainty.push("There are mild humour signals, but not enough to call this satire. Treat the format as unconfirmed.");
  }

  /* ---- 2. Format from the publication's own structure -------------- */
  const formats: ArticleFormat[] = [];
  const declared = (meta.declaredFormat ?? "").toLowerCase();
  const section = (meta.section ?? "").toLowerCase();

  if (declared.includes("satire")) formats.push("satire");
  if (declared.includes("parody")) formats.push("parody");
  if (declared.includes("opinion")) formats.push("opinion");
  if (declared.includes("editorial") || section.includes("editorial")) formats.push("editorial");
  if (declared.includes("commentary") || declared.includes("analysis")) formats.push("commentary");

  // NYT-style addresses put the section mid-path (/2026/03/01/opinion/slug), so the
  // check is by SEGMENT, not by prefix.
  const opinionSegment = opinionSegmentOf(path);
  if (opinionSegment && !isSatire) {
    if (opinionSegment.startsWith("editorial")) formats.push("editorial");
    else if (opinionSegment.startsWith("comment") || opinionSegment.startsWith("column") || opinionSegment.startsWith("voices")) formats.push("commentary");
    else if (!formats.includes("opinion")) formats.push("opinion");
    evidence.push(`The address sits in the publication's ${opinionSegment} section, which is argument or views, not reporting.`);
  }
  if (/\b(op-?ed|opinion|editorial|commentary|column|perspective)\b/i.test(title) && !isSatire) {
    if (/\beditorial\b/i.test(title)) formats.push("editorial");
    else formats.push("opinion");
    evidence.push("The headline itself is marked as opinion or editorial.");
  }
  if (/editorial board/i.test(input.byline ?? "")) {
    if (!formats.includes("editorial")) formats.push("editorial");
    evidence.push("The byline is the editorial board, which states the publication's institutional view.");
  }

  const sponsoredPath = startsWithAny(path, SPONSORED_PATH_PREFIXES);
  if (sponsoredPath || /(sponsored content|paid post|partner content|advertisement|paid for by)/i.test(text)) {
    formats.push("sponsored");
    evidence.push("The page is labelled as paid or sponsored content, so it is advertising.");
  }

  const pressPath = startsWithAny(path, PRESS_RELEASE_PATH_PREFIXES);
  if (pressPath || /(for immediate release|press release|media contact:)/i.test(text)) {
    formats.push("press_release");
    evidence.push("The page is a press release: an organisation's own statement about itself.");
  }

  if (isSatire) formats.unshift(isParody ? "parody" : "satire");
  if (!isSatire && !isParody && FICTION_MARKERS.test(text) && /(short story|novel|fiction|chapter one|once upon a time)/i.test(text)) {
    formats.push("fiction");
    evidence.push("The page reads as fiction rather than reporting.");
  }

  /* ---- 3. Peer review, preprint, research -------------------------- */
  const doi = input.doi ?? (/10\.\d{4,9}\/[^\s"'<>]+/.exec(text)?.[0] ?? null);
  const doiLooksPreprint = doi ? PREPRINT_DOI_PREFIXES.some((p) => doi.toLowerCase().startsWith(p)) : false;
  const preprintHost = PREPRINT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

  let peerReview: PeerReviewStatus = "unknown";
  if (preprintHost || doiLooksPreprint) {
    peerReview = "preprint";
    formats.push("preprint");
    evidence.push(
      "This is a preprint: shared publicly before peer review. It is current and useful, but it has not been checked by other specialists.",
    );
  } else if (meta.peerReviewed === true) {
    peerReview = "peer_reviewed";
    formats.push("peer_reviewed");
    evidence.push("The record states this article was peer reviewed before publication.");
  } else if (doi) {
    peerReview = "research_unconfirmed";
    formats.push("peer_reviewed");
    evidence.push(
      `It carries a DOI (${doi}), which means it is a registered publication, but peer-review status could not be confirmed from the record, so it is reported as unconfirmed.`,
    );
    uncertainty.push("Peer review was not confirmed: a DOI proves registration, not review.");
  } else if (/(journal|proceedings|thesis|dissertation|working paper)/i.test(text)) {
    peerReview = "research_unconfirmed";
    uncertainty.push("It looks like academic writing, but no DOI or peer-review record was found.");
  } else {
    peerReview = "not_research";
  }

  /* ---- 4. Government, education, reference, data ------------------- */
  const isGov = /(^|\.)gov(\.|$)/.test(host);
  if (isGov && !formats.includes("government_publication")) {
    formats.push("government_publication");
    evidence.push("Published on an official government domain.");
  }
  if (DATASET_SIGNALS.test(text) || /(census\.gov|data\.gov|fred\.stlouisfed|worldbank\.org|eurostat)/.test(host)) {
    formats.push("dataset");
  }
  if (/(khanacademy|openstax|ck12|ocw\.mit|openlearn|gcfglobal|oercommons|pbslearningmedia)/.test(host)) {
    formats.push("educational_resource");
  }
  if (/(britannica|wikipedia|mathworld|plato\.stanford|iep\.utm|encyclopedia)/.test(host)) {
    formats.push("reference_work");
  }

  /* ---- 6. News formats and corroboration --------------------------- */
  const isNewsPublisher =
    /(reuters|apnews|bbc\.|npr\.org|pbs\.org|theguardian|nytimes|washingtonpost|aljazeera|ft\.com|bloomberg|cnn|abcnews|cbsnews|nbcnews|usatoday|economist)/.test(
      host,
    ) && !formats.includes("sponsored");
  const investigation = /(investigation|investigates|investigative|leaked documents|records show)/i.test(text);

  if (isNewsPublisher || /(report(ed|s)? that|according to (officials|police|the (agency|department)))/i.test(text)) {
    formats.push(investigation ? "investigative_reporting" : "news_reporting");
  }

  /* ---- 5. Primary vs secondary (after news formats are known) ------- */
  const archivePrimary = ARCHIVE_PRIMARY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  const primarySignals =
    archivePrimary ||
    COURT_AND_STATUTE_SIGNALS.test(text) ||
    /(primary source|first-?hand|transcript|diary|manuscript|original (document|letter|text)|treaty text|full text of)/i.test(text) ||
    formats.includes("dataset") ||
    peerReview === "peer_reviewed" ||
    peerReview === "preprint";

  const reportingFormat = formats.includes("news_reporting") || formats.includes("investigative_reporting");
  let evidenceRole: EvidenceRole = "unclear";
  if (primarySignals) {
    evidenceRole = "primary";
    formats.push("primary_source");
  } else if (formats.includes("reference_work") || formats.includes("educational_resource") || reportingFormat) {
    evidenceRole = "secondary";
    formats.push("secondary_source");
  }

  const corroborated = (input.corroboration?.independentSources ?? 0) >= 2;
  if (formats.includes("news_reporting") && corroborated && !isSatire && formats.every((f) => f !== "opinion" && f !== "editorial" && f !== "sponsored")) {
    formats.unshift("verified_factual_reporting");
    evidence.push(
      `Its main claim is reported by ${input.corroboration?.independentSources} independent sources, so the reporting is corroborated.`,
    );
  }

  /* ---- 7. Publication integrity ------------------------------------ */
  const retractionChecked = meta.retractionChecked === true;
  let publicationState: PublicationState = "unknown";
  if (meta.retracted === true) {
    publicationState = "retracted";
    evidence.push("A retraction record exists for this publication. Its findings should not be used.");
  } else if (meta.corrected === true) {
    publicationState = "corrected";
    evidence.push("The publication has issued a correction. Cite the corrected version and say so.");
  } else if (meta.expressionOfConcern === true) {
    publicationState = "expression_of_concern";
    evidence.push("The publisher has flagged a concern about this article.");
  } else if (retractionChecked) {
    publicationState = "clean";
    evidence.push("A retraction and correction record was checked and found nothing against this item.");
  } else {
    uncertainty.push("No retraction or correction record was consulted, so that status is unknown rather than clear.");
  }

  /* ---- 8. Misinformation risk -------------------------------------- */
  const risk: string[] = [];
  const impersonated = looksLikeImpersonation(host);
  if (impersonated) risk.push(`The address imitates ${impersonated}, which is a common sign of a look-alike site.`);
  if (!input.byline && !formats.includes("government_publication") && !formats.includes("dataset") && !formats.includes("peer_reviewed")) {
    risk.push("No author is named.");
  }
  if (!input.publishedDate && !formats.includes("dataset")) risk.push("No publication date is shown, so the information cannot be placed in time.");
  if (SENSATIONAL.test(text) && !isSatire) risk.push("The wording is sensational rather than descriptive.");
  if (/(according to (a|an) (viral|social media)|shared (widely|thousands of times)|screenshot (shows|proves)|anonymous source)/i.test(text)) {
    risk.push("The claim rests on social media, a screenshot or an unnamed source rather than a document.");
  }
  if (numbersIn(text).length >= 3 && !/(source|data|census|study|survey|report|table)/i.test(text)) {
    risk.push("It contains several figures without saying where they come from.");
  }

  let misinformationRisk: MisinformationRisk;
  if (isSatire) {
    misinformationRisk = "unknown"; // satire is a format question, not a truth question
    uncertainty.push("Satire is not misinformation: a satirical article may still describe a real event accurately, so its individual statements must each be checked.");
  } else if (impersonated || risk.length >= 3) {
    misinformationRisk = "high";
  } else if (risk.length >= 1) {
    misinformationRisk = "elevated";
  } else {
    misinformationRisk = "low";
  }

  /* ---- 9. The plain-English verdict -------------------------------- */
  const uniqueFormats = dedupeFormats(formats);
  // Priority is explicit and ordered, so a page that is both an editorial and a news
  // section is described by the stronger claim about WHAT IT IS.
  const FORMAT_PRIORITY: ArticleFormat[] = [
    "sponsored",
    "satire",
    "parody",
    "fiction",
    "press_release",
    "editorial",
    "opinion",
    "commentary",
    "verified_factual_reporting",
    "investigative_reporting",
    "news_reporting",
    "peer_reviewed",
    "preprint",
    "government_publication",
    "dataset",
    "primary_source",
    "secondary_source",
    "educational_resource",
    "reference_work",
  ];
  const primaryFormat: ArticleFormat =
    FORMAT_PRIORITY.find((f) => uniqueFormats.includes(f)) ?? uniqueFormats[0] ?? "unknown";

  const informational = !isSatire && !["sponsored", "fiction", "parody"].includes(primaryFormat);
  const usableAsEvidence = informational && publicationState !== "retracted";

  if (publicationState === "retracted") {
    evidence.push("This item is retracted, so it is never usable as academic evidence.");
  }

  const label = STUDENT_LABELS[primaryFormat].label;
  let explanation = STUDENT_LABELS[primaryFormat].explanation;
  if (isSatire) {
    explanation =
      "This is satirical writing: it imitates news to be funny. Nothing in it should be used as a fact about the world " +
      "unless you can check the same statement in a normal source. Satire is not the same as a lie.";
  } else if (publicationState === "retracted") {
    explanation = "This research has been retracted by its publisher, so its findings cannot be used, even in a literature review.";
  } else if (formats.includes("opinion") && formats.includes("news_reporting")) {
    explanation = "This mixes reported facts with the author's opinion. Quote only the reported parts as fact.";
  }

  const confidence = Number(
    Math.min(
      0.95,
      0.4 +
        (isSatire ? 0.4 : 0) +
        (formats.length > 1 ? 0.1 : 0) +
        (evidence.length >= 3 ? 0.1 : 0) +
        (peerReview === "peer_reviewed" || peerReview === "preprint" ? 0.1 : 0) +
        (publicationState !== "unknown" ? 0.1 : 0),
    ).toFixed(2),
  );

  return {
    url: input.url,
    host,
    formats: uniqueFormats,
    primaryFormat,
    satire: { isSatire, isParody, confidence: satireConfidence, signals: satireSignals },
    peerReview,
    evidenceRole,
    publicationState,
    retractionChecked,
    misinformationRisk,
    usableAsEvidence,
    label,
    explanation,
    evidence,
    uncertainty: uncertainty.length ? uncertainty.join(" ") : "Nothing further is uncertain about the format of this source.",
    confidence,
    confidenceBand: band(confidence),
    checkedAt: now.toISOString(),
  };
}

function dedupeFormats(formats: ArticleFormat[]): ArticleFormat[] {
  const out: ArticleFormat[] = [];
  for (const f of formats) if (!out.includes(f)) out.push(f);
  return out.length ? out : ["unknown"];
}

/* ------------------------------------------------------------------ */
/* Claim assessment                                                    */
/* ------------------------------------------------------------------ */

export interface EvidencePassage {
  url: string;
  sourceName?: string;
  /** The passage as retrieved. A claim is never supported by an absent passage. */
  passage: string;
  publishedDate?: string | null;
  reliability?: "official" | "peer_reviewed" | "editorial" | "institutional" | "community" | "unknown";
  /** Set by the caller when it knows this is not a republication of the same original report. */
  independent?: boolean;
  /** True when this evidence itself comes from satire or fiction: it cannot support a fact. */
  satire?: boolean;
}

export interface FactCheckFinding {
  organization: string;
  url: string;
  conclusion: "false" | "misleading" | "true" | "mixed" | "unrated";
  date?: string | null;
}

export interface ClaimAssessmentInput {
  claim: string;
  supporting?: EvidencePassage[];
  contradicting?: EvidencePassage[];
  factChecks?: FactCheckFinding[];
  /** The writing presents the claim as true NOW ("currently", "this year"). */
  presentedAsCurrent?: boolean;
  asOf?: Date;
}

export interface ClaimAssessment {
  claim: string;
  verdict: ClaimVerdict;
  confidence: number;
  confidenceBand: ConfidenceBand;
  label: string;
  explanation: string;
  /** URLs plus a short quote, so the evidence can be inspected. */
  supportingEvidence: string[];
  contradictingEvidence: string[];
  factChecksWeighed: string[];
  /** The honest sentence about what is still unknown. */
  uncertainty: string;
  checkedAt: string;
}

const RECENT_WINDOW_DAYS = 730;

function yearsOld(publishedDate: string | null | undefined, now: Date): number | null {
  if (!publishedDate) return null;
  const t = Date.parse(publishedDate);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 86_400_000;
}

function quote(p: EvidencePassage): string {
  const snippet = p.passage.trim().replace(/\s+/g, " ").slice(0, 180);
  return `${p.sourceName ?? p.url}: "${snippet}${p.passage.trim().length > 180 ? "..." : ""}" (${p.url})`;
}

/**
 * Classifies a CLAIM from the evidence actually retrieved for it.
 *
 * The decision order matters and is the whole point:
 *   no evidence at all        -> unverified   (never false)
 *   satire only               -> satirical_only
 *   contradiction without support -> disputed, or contradicted when independent and direct
 *   support without contradiction -> supported / partially_supported by coverage
 *   support and contradiction -> disputed
 *   supported but presented as current while the evidence is years old -> misleading
 */
export function assessClaim(input: ClaimAssessmentInput): ClaimAssessment {
  const now = input.asOf ?? new Date();
  const claim = input.claim.trim();
  const allSupport = input.supporting ?? [];
  const allAgainst = input.contradicting ?? [];
  const factChecks = input.factChecks ?? [];

  const satiricalSupport = allSupport.filter((p) => p.satire === true);
  const support = allSupport.filter((p) => p.satire !== true && p.passage.trim().length > 0);
  const against = allAgainst.filter((p) => p.satire !== true && p.passage.trim().length > 0);

  const supportingEvidence = support.map(quote);
  const contradictingEvidence = against.map(quote);
  const factChecksWeighed = factChecks.map(
    (f) => `${f.organization} rated this "${f.conclusion}"${f.date ? ` on ${f.date}` : ""} (${f.url})`,
  );

  const independentSupport = support.filter((p) => p.independent === true);
  const independentAgainst = against.filter((p) => p.independent !== false);

  // Best coverage of the claim found in any supporting passage.
  const bestCoverage = support.reduce((max, p) => Math.max(max, coverageOf(claim, p.passage)), 0);

  const factCheckFalse = factChecks.some((f) => f.conclusion === "false");
  const factCheckMisleading = factChecks.some((f) => f.conclusion === "misleading");
  const factCheckTrue = factChecks.some((f) => f.conclusion === "true");

  let verdict: ClaimVerdict;
  const reasons: string[] = [];
  let confidence = 0.5;

  if (support.length === 0 && against.length === 0 && factChecks.length === 0) {
    if (satiricalSupport.length > 0) {
      verdict = "satirical_only";
      confidence = Math.min(0.9, 0.5 + 0.15 * satiricalSupport.length);
      reasons.push(
        "The only place this statement appears is satirical writing. Satire is humour in a news format: it is not evidence that the statement is true, and it is not evidence that it is false either.",
      );
    } else {
      verdict = "unverified";
      confidence = 0.85;
      reasons.push(
        "No supporting or contradicting evidence was found. That is not proof the claim is false: it means the claim has not been checked, so it cannot be presented as fact.",
      );
    }
  } else if (support.length === 0 && against.length === 0 && factChecks.length > 0) {
    // Only fact-checks were consulted.
    if (factCheckFalse) {
      verdict = "false";
      confidence = 0.6;
      reasons.push("A fact-checking organisation has examined this and rated it false.");
    } else if (factCheckMisleading) {
      verdict = "misleading";
      confidence = 0.55;
      reasons.push("A fact-checking organisation has examined this and rated it misleading.");
    } else if (factCheckTrue) {
      verdict = "supported";
      confidence = 0.5;
      reasons.push("A fact-checking organisation has examined this and rated it true.");
    } else {
      verdict = "unverified";
      confidence = 0.6;
      reasons.push("A fact-check exists but does not settle the claim.");
    }
    reasons.push("A fact-check is someone else's judgement: weigh it, do not treat it as the underlying evidence.");
  } else if (support.length === 0) {
    // Contradicting evidence only.
    const strongAgainst =
      independentAgainst.length >= 2 ||
      independentAgainst.some((p) => p.reliability === "official" || p.reliability === "peer_reviewed");
    if (factCheckFalse || (strongAgainst && independentAgainst.length >= 2)) {
      verdict = "false";
      confidence = Math.min(0.9, 0.55 + 0.1 * independentAgainst.length);
      reasons.push(
        `${independentAgainst.length === 1 ? "A credible source directly contradicts" : `${independentAgainst.length} credible sources directly contradict`} this claim, and no supporting evidence was found.`,
      );
    } else {
      verdict = "disputed";
      confidence = 0.5;
      reasons.push(
        "Something credible contradicts this claim, but one contradiction is not the same as proof, and nothing was found on the other side.",
      );
    }
  } else if (against.length === 0) {
    // Supporting evidence only.
    if (input.presentedAsCurrent) {
      const ages = support.map((p) => yearsOld(p.publishedDate, now)).filter((d): d is number => d !== null);
      if (ages.length > 0 && ages.every((d) => d > RECENT_WINDOW_DAYS)) {
        verdict = "misleading";
        confidence = 0.65;
        reasons.push(
          `The evidence is more than two years old (oldest ${Math.round(Math.max(...ages) / 365)} years) but the claim is written as if it were current. State the year the figure belongs to.`,
        );
      } else {
        verdict = bestCoverage >= 0.6 ? "supported" : "partially_supported";
        confidence = Math.min(0.85, 0.45 + 0.15 * (independentSupport.length || 1) + (bestCoverage >= 0.6 ? 0.1 : 0));
        reasons.push(
          bestCoverage >= 0.6
            ? `A retrieved passage supports this claim${independentSupport.length >= 2 ? `, and ${independentSupport.length} independent sources agree` : ""}.`
            : "The passage covers only part of the claim, so only the covered part can be stated as fact.",
        );
      }
    } else {
      verdict = bestCoverage >= 0.6 ? "supported" : "partially_supported";
      confidence = Math.min(0.85, 0.45 + 0.15 * (independentSupport.length || 1) + (bestCoverage >= 0.6 ? 0.1 : 0));
      reasons.push(
        bestCoverage >= 0.6
          ? `A retrieved passage supports this claim${independentSupport.length >= 2 ? `, and ${independentSupport.length} independent sources agree` : " from one source"}.`
          : "The passage covers only part of the claim, so only the covered part can be stated as fact.",
      );
      if (independentSupport.length < 2) {
        reasons.push(
          support.length > 1
            ? "Several results repeat the same original report rather than confirming it separately, so they count as one source, not several."
            : "Only one source was found, which is the weakest form of support.",
        );
      }
    }
  } else {
    // Evidence on both sides.
    verdict = "disputed";
    confidence = 0.6;
    reasons.push(
      "Credible evidence supports part of this and credible evidence contradicts part of it. Present both sides and name the disagreement.",
    );
  }

  // Individually-numbered claims: a figure in the claim that no supporting passage contains.
  if (verdict === "supported" || verdict === "partially_supported") {
    const claimNumbers = numbersIn(claim);
    const missing = claimNumbers.filter((n) => !support.some((p) => numbersIn(p.passage).includes(n)));
    if (missing.length > 0) {
      verdict = "partially_supported";
      reasons.push(
        `The figure${missing.length > 1 ? "s" : ""} ${missing.slice(0, 3).join(", ")} ${missing.length > 1 ? "do" : "does"} not appear in any retrieved passage, so ${missing.length > 1 ? "they" : "it"} cannot be cited yet.`,
      );
      confidence = Math.max(0.3, confidence - 0.15);
    }
  }

  const uncertaintyParts: string[] = [];
  if (verdict === "unverified") {
    uncertaintyParts.push("This has not been checked against a real source, so it stays unverified rather than being called false.");
  }
  if (verdict === "satirical_only") {
    uncertaintyParts.push(
      "Whether the underlying event is real is a separate question that needs normal sources; the satirical article proves nothing either way.",
    );
  }
  if (support.length > 0 && independentSupport.length < 2) {
    uncertaintyParts.push("Only one independent source was available.");
  }
  if (verdict === "disputed") {
    uncertaintyParts.push("Which side is better evidenced depends on the documents themselves, so read both before deciding.");
  }
  if (against.length > 0 && support.length > 0) {
    uncertaintyParts.push("Conflicting sources exist on both sides of this claim.");
  }
  if (factChecks.length > 0) {
    uncertaintyParts.push("A fact-check is a secondary judgement and does not replace reading the evidence it cites.");
  }
  if (uncertaintyParts.length === 0) {
    uncertaintyParts.push("Nothing further is uncertain given the evidence retrieved.");
  }

  const meta = CLAIM_LABELS[verdict];

  return {
    claim,
    verdict,
    confidence: Number(confidence.toFixed(2)),
    confidenceBand: band(confidence),
    label: meta.label,
    explanation: [meta.explanation, ...reasons].join(" "),
    supportingEvidence,
    contradictingEvidence,
    factChecksWeighed,
    uncertainty: uncertaintyParts.join(" "),
    checkedAt: now.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Assignment-facing helpers                                           */
/* ------------------------------------------------------------------ */

/**
 * Should this source be offered as evidence for a school assignment?
 * Satire, fiction, parody, sponsored content and retracted work are excluded with a
 * reason a student can act on - never silently dropped.
 */
export function evidenceSuitability(assessment: SourceAssessment): { allowed: boolean; reason: string } {
  if (assessment.publicationState === "retracted") {
    return { allowed: false, reason: "This research has been retracted, so it cannot be used as evidence." };
  }
  if (assessment.satire.isSatire) {
    return {
      allowed: false,
      reason: "Satire is humour in a news format. It is not evidence, though it can be a useful example of persuasive writing.",
    };
  }
  if (assessment.primaryFormat === "fiction") {
    return { allowed: false, reason: "Fiction cannot be used as evidence about the real world." };
  }
  if (assessment.primaryFormat === "sponsored") {
    return { allowed: false, reason: "Sponsored content is advertising, so it is not independent evidence." };
  }
  return { allowed: true, reason: assessment.explanation };
}

/** One line for a results list. */
export function summarizeSource(assessment: SourceAssessment): string {
  const bits = [assessment.label];
  if (assessment.satire.isSatire) bits.push("not factual evidence");
  if (assessment.peerReview === "preprint") bits.push("not yet peer reviewed");
  if (assessment.publicationState === "retracted") bits.push("retracted");
  if (assessment.evidenceRole === "primary") bits.push("primary source");
  return bits.join(" - ");
}
