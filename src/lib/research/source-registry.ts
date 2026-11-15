/**
 * SOURCE REGISTRY (directive 2026-11-15, Part 4).
 *
 * A configurable, data-defined catalogue of the academic, educational, government,
 * library, news, subject-specific and fact-checking sources Sophira is intended to
 * reach, each with HOW it may be reached. Nothing here performs retrieval: the
 * existing pipeline (provider.ts -> run.ts -> verify.ts -> policy.ts) stays the only
 * execution path, and this module never calls the network.
 *
 * THE HONESTY RULE THIS FILE EXISTS FOR:
 * "A website must not be marked connected simply because its name exists in a
 * configuration file." A source is CONNECTED only when a real capability is present
 * in this build AND a live check has actually succeeded (lastVerified). A missing
 * adapter, a missing key and an expired verification are three DIFFERENT states and
 * are never collapsed into "working".
 *
 * ACCESS BOUNDARY: sources that are licensed, paywalled or behind an account
 * (JSTOR, ScienceDirect, IEEE, Google Scholar, FT...) are recorded as `link_only` or
 * `institutional`. Sophira may point a student at them and use permitted metadata
 * APIs, and must never scrape them or bypass an access control - that boundary lives
 * in policy.ts and is not relaxed here.
 */

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export type SourceCategory =
  | "education"
  | "academic_research"
  | "government"
  | "library_history"
  | "news"
  | "reference"
  | "data"
  | "literature"
  | "philosophy"
  | "law"
  | "science"
  | "computing"
  | "fact_check";

export type RetrievalMethod =
  /** documented public API, no credentials needed */
  | "open_api"
  /** documented API that requires a (free or registered) key held server-side */
  | "api_with_key"
  /** downloadable bulk dataset / dump */
  | "bulk_dataset"
  /** ordinary public web page, fetched through verify.ts + policy.ts */
  | "open_web"
  /** licensed or account-gated: Sophira links the student to authorised access only */
  | "link_only";

export type ApiRequirement = "none" | "free_key" | "institutional" | "no_api";

export type Authentication = "none" | "free_key" | "institutional";

export type ContentType =
  | "articles"
  | "abstracts"
  | "full_text"
  | "books"
  | "datasets"
  | "statistics"
  | "legislation"
  | "court_decisions"
  | "archives"
  | "images"
  | "video"
  | "audio"
  | "textbooks"
  | "definitions"
  | "reference_entries";

export type Reliability =
  | "peer_reviewed"
  | "official"
  | "institutional"
  | "editorial"
  | "encyclopedic"
  | "community"
  | "mixed";

export interface SourceEntry {
  id: string;
  name: string;
  categories: SourceCategory[];
  /** One plain sentence: what a student can get here. */
  description: string;
  website: string;
  retrieval: RetrievalMethod[];
  api: {
    available: boolean;
    requirement: ApiRequirement;
    /** server-side environment variable that holds the key, when one is required */
    envKey?: string;
    baseUrl?: string;
  };
  authentication: Authentication;
  /** Plain-English limits a student could understand. */
  restrictions: string[];
  licensing: string;
  contentTypes: ContentType[];
  reliability: Reliability;
  /**
   * Set only when Sophira actually contains an adapter for this source. A named
   * source with no adapter is reachable (if at all) only through web search.
   */
  adapterId: string | null;
  /** True only when retrieving the full text is permitted by licence/terms. */
  fullTextRetrieval: boolean;
  /** ISO date of the last live check that actually succeeded. null = never checked. */
  lastVerified: string | null;
}

interface EntryInput {
  id: string;
  name: string;
  categories: SourceCategory[];
  description: string;
  website: string;
  retrieval: RetrievalMethod[];
  api?: Partial<SourceEntry["api"]>;
  authentication?: Authentication;
  restrictions?: string[];
  licensing: string;
  contentTypes: ContentType[];
  reliability: Reliability;
  adapterId?: string | null;
  fullTextRetrieval?: boolean;
}

function entry(input: EntryInput): SourceEntry {
  const retrieval = input.retrieval;
  const licenceOnly = retrieval.every((r) => r === "link_only");
  return {
    id: input.id,
    name: input.name,
    categories: input.categories,
    description: input.description,
    website: input.website,
    retrieval,
    api: {
      available: input.api?.available ?? false,
      requirement: input.api?.requirement ?? (licenceOnly ? "no_api" : "none"),
      envKey: input.api?.envKey,
      baseUrl: input.api?.baseUrl,
    },
    authentication: input.authentication ?? (licenceOnly ? "institutional" : "none"),
    restrictions: input.restrictions ?? [],
    licensing: input.licensing,
    contentTypes: input.contentTypes,
    reliability: input.reliability,
    adapterId: input.adapterId ?? null,
    fullTextRetrieval: input.fullTextRetrieval ?? retrieval.includes("open_web"),
    lastVerified: null,
  };
}

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

const LICENSED =
  "Needs an institutional or personal subscription. Sophira links you to authorised access and never bypasses a paywall.";

export const SOURCE_REGISTRY: SourceEntry[] = [
  /* ---------------- 4.1 general education ---------------- */
  entry({
    id: "khan-academy",
    name: "Khan Academy",
    categories: ["education"],
    description: "Free lessons and practice from primary school through early university.",
    website: "https://www.khanacademy.org",
    retrieval: ["open_web"],
    licensing: "Free to read; not openly licensed for redistribution.",
    contentTypes: ["articles", "video", "reference_entries"],
    reliability: "institutional",
  }),
  entry({
    id: "ck-12",
    name: "CK-12",
    categories: ["education"],
    description: "Open textbooks and simulations for school science and maths.",
    website: "https://www.ck12.org",
    retrieval: ["open_web", "api_with_key"],
    api: { available: true, requirement: "free_key", envKey: "CK12_API_KEY" },
    authentication: "free_key",
    licensing: "Mostly CC BY-NC; check the item.",
    contentTypes: ["textbooks", "articles"],
    reliability: "institutional",
  }),
  entry({
    id: "openstax",
    name: "OpenStax",
    categories: ["education", "academic_research"],
    description: "Peer-reviewed open university textbooks, free to download.",
    website: "https://openstax.org",
    retrieval: ["open_web", "bulk_dataset"],
    licensing: "CC BY (most titles): reuse with attribution.",
    contentTypes: ["textbooks", "full_text"],
    reliability: "institutional",
  }),
  entry({
    id: "mit-ocw",
    name: "MIT OpenCourseWare",
    categories: ["education"],
    description: "Course notes, problem sets and reading lists from MIT courses.",
    website: "https://ocw.mit.edu",
    retrieval: ["open_web"],
    licensing: "CC BY-NC-SA 4.0.",
    contentTypes: ["articles", "video", "textbooks"],
    reliability: "institutional",
  }),
  entry({
    id: "coursera",
    name: "Coursera",
    categories: ["education"],
    description: "University-partnered online courses.",
    website: "https://www.coursera.org",
    retrieval: ["link_only"],
    restrictions: ["Course content usually needs a Coursera account; Sophira links you to it."],
    licensing: "All rights reserved; account required.",
    contentTypes: ["video", "articles"],
    reliability: "institutional",
  }),
  entry({
    id: "edx",
    name: "edX",
    categories: ["education"],
    description: "University-partnered online courses.",
    website: "https://www.edx.org",
    retrieval: ["link_only"],
    restrictions: ["Course content usually needs an edX account; Sophira links you to it."],
    licensing: "All rights reserved; account required.",
    contentTypes: ["video", "articles"],
    reliability: "institutional",
  }),
  entry({
    id: "pbs-learningmedia",
    name: "PBS LearningMedia",
    categories: ["education"],
    description: "Classroom videos and lesson plans across subjects.",
    website: "https://www.pbslearningmedia.org",
    retrieval: ["open_web"],
    licensing: "Free for classroom use; not general redistribution.",
    contentTypes: ["video", "articles"],
    reliability: "institutional",
  }),
  entry({
    id: "natgeo-education",
    name: "National Geographic Education",
    categories: ["education", "science"],
    description: "Geography, earth science and exploration resources.",
    website: "https://education.nationalgeographic.org",
    retrieval: ["open_web"],
    licensing: "All rights reserved; cite and link.",
    contentTypes: ["articles", "images"],
    reliability: "editorial",
  }),
  entry({
    id: "smithsonian-learning-lab",
    name: "Smithsonian Learning Lab",
    categories: ["education", "library_history"],
    description: "Museum objects, images and primary material for classrooms.",
    website: "https://learninglab.si.edu",
    retrieval: ["open_web"],
    licensing: "Open Access items are CC0; check each object.",
    contentTypes: ["images", "archives", "articles"],
    reliability: "institutional",
  }),
  entry({
    id: "gcfglobal",
    name: "GCFGlobal",
    categories: ["education"],
    description: "Plain-language tutorials for everyday and office skills.",
    website: "https://edu.gcfglobal.org",
    retrieval: ["open_web"],
    licensing: "Free to read.",
    contentTypes: ["articles"],
    reliability: "institutional",
  }),
  entry({
    id: "openlearn",
    name: "OpenLearn (The Open University)",
    categories: ["education"],
    description: "Free Open University courses and study units.",
    website: "https://www.open.edu/openlearn",
    retrieval: ["open_web"],
    licensing: "CC BY-NC-SA unless stated.",
    contentTypes: ["articles", "textbooks"],
    reliability: "institutional",
  }),
  entry({
    id: "oer-commons",
    name: "OER Commons",
    categories: ["education"],
    description: "Searchable library of openly licensed teaching material.",
    website: "https://www.oercommons.org",
    retrieval: ["open_web"],
    licensing: "Varies by item; openly licensed material predominates.",
    contentTypes: ["articles", "textbooks"],
    reliability: "community",
  }),
  entry({
    id: "project-gutenberg",
    name: "Project Gutenberg",
    categories: ["literature", "library_history"],
    description: "Full text of public-domain books.",
    website: "https://www.gutenberg.org",
    retrieval: ["open_web", "bulk_dataset"],
    licensing: "Public domain in the United States; check local law.",
    contentTypes: ["books", "full_text"],
    reliability: "community",
  }),

  /* ---------------- 4.2 academic research ---------------- */
  entry({
    id: "openalex",
    name: "OpenAlex",
    categories: ["academic_research"],
    description: "Open index of works, authors, venues and citation links.",
    website: "https://openalex.org",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://api.openalex.org" },
    licensing: "CC0 metadata.",
    contentTypes: ["abstracts", "reference_entries"],
    reliability: "mixed",
  }),
  entry({
    id: "crossref",
    name: "Crossref",
    categories: ["academic_research"],
    description: "DOI registration metadata, including retraction and correction links.",
    website: "https://www.crossref.org",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://api.crossref.org" },
    licensing: "Open metadata.",
    contentTypes: ["abstracts", "reference_entries"],
    reliability: "mixed",
  }),
  entry({
    id: "semantic-scholar",
    name: "Semantic Scholar",
    categories: ["academic_research"],
    description: "Scholarly search with citation context and abstracts.",
    website: "https://www.semanticscholar.org",
    retrieval: ["open_api", "api_with_key"],
    api: { available: true, requirement: "free_key", envKey: "SEMANTIC_SCHOLAR_API_KEY" },
    authentication: "free_key",
    licensing: "Free tier with rate limits.",
    contentTypes: ["abstracts"],
    reliability: "mixed",
  }),
  entry({
    id: "pubmed",
    name: "PubMed",
    categories: ["academic_research", "science"],
    description: "Biomedical and life-science literature index.",
    website: "https://pubmed.ncbi.nlm.nih.gov",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils" },
    licensing: "Public metadata; rate limits apply.",
    contentTypes: ["abstracts"],
    reliability: "mixed",
  }),
  entry({
    id: "europe-pmc",
    name: "Europe PMC",
    categories: ["academic_research", "science"],
    description: "Life-science literature, including open-access full text.",
    website: "https://europepmc.org",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://www.ebi.ac.uk/europepmc/webservices/rest" },
    licensing: "Open metadata; full text only where openly licensed.",
    contentTypes: ["abstracts", "full_text"],
    reliability: "mixed",
  }),
  entry({
    id: "eric",
    name: "ERIC (U.S. Department of Education)",
    categories: ["academic_research", "education"],
    description: "Education research reports and journal articles.",
    website: "https://eric.ed.gov",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://api.ies.ed.gov/eric" },
    licensing: "Public metadata.",
    contentTypes: ["abstracts", "full_text"],
    reliability: "official",
  }),
  entry({
    id: "core",
    name: "CORE",
    categories: ["academic_research"],
    description: "Aggregated open-access papers from repositories worldwide.",
    website: "https://core.ac.uk",
    retrieval: ["api_with_key"],
    api: { available: true, requirement: "free_key", envKey: "CORE_API_KEY" },
    authentication: "free_key",
    licensing: "Open access; check the item licence.",
    contentTypes: ["abstracts", "full_text"],
    reliability: "mixed",
  }),
  entry({
    id: "doaj",
    name: "DOAJ (Directory of Open Access Journals)",
    categories: ["academic_research"],
    description: "Directory of vetted open-access journals and their articles.",
    website: "https://doaj.org",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://doaj.org/api" },
    licensing: "Open metadata.",
    contentTypes: ["abstracts"],
    reliability: "institutional",
  }),
  entry({
    id: "arxiv",
    name: "arXiv",
    categories: ["academic_research", "science", "computing"],
    description: "Preprints in physics, maths, computing and related fields.",
    website: "https://arxiv.org",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "http://export.arxiv.org/api" },
    licensing: "Depends on the submission licence; often arXiv non-exclusive.",
    contentTypes: ["full_text", "abstracts"],
    reliability: "mixed",
    restrictions: ["Every arXiv item is a PREPRINT: not peer-reviewed, even when it later appears in a journal."],
  }),
  entry({
    id: "ssrn",
    name: "SSRN",
    categories: ["academic_research", "law"],
    description: "Working papers in law, economics and social science.",
    website: "https://www.ssrn.com",
    retrieval: ["link_only"],
    restrictions: ["Working papers are not peer-reviewed; many downloads need an account."],
    licensing: "All rights reserved; account often required.",
    contentTypes: ["abstracts"],
    reliability: "mixed",
  }),
  entry({
    id: "jstor",
    name: "JSTOR",
    categories: ["academic_research", "library_history"],
    description: "Archived scholarly journals and primary documents.",
    website: "https://www.jstor.org",
    retrieval: ["link_only"],
    restrictions: [LICENSED],
    licensing: "Licensed; institutional subscription required.",
    contentTypes: ["articles", "archives"],
    reliability: "peer_reviewed",
  }),
  entry({
    id: "ieee-xplore",
    name: "IEEE Xplore",
    categories: ["academic_research", "computing"],
    description: "Engineering and computing papers, standards and proceedings.",
    website: "https://ieeexplore.ieee.org",
    retrieval: ["link_only", "api_with_key"],
    api: { available: true, requirement: "free_key", envKey: "IEEE_API_KEY" },
    authentication: "free_key",
    restrictions: [LICENSED],
    licensing: "Licensed; full text needs a subscription.",
    contentTypes: ["abstracts", "articles"],
    reliability: "peer_reviewed",
    fullTextRetrieval: false,
  }),
  entry({
    id: "acm-dl",
    name: "ACM Digital Library",
    categories: ["academic_research", "computing"],
    description: "Computing research papers, proceedings and magazines.",
    website: "https://dl.acm.org",
    retrieval: ["link_only"],
    restrictions: [LICENSED],
    licensing: "Licensed.",
    contentTypes: ["abstracts", "articles"],
    reliability: "peer_reviewed",
    fullTextRetrieval: false,
  }),
  entry({
    id: "sciencedirect",
    name: "ScienceDirect (Elsevier)",
    categories: ["academic_research", "science"],
    description: "Elsevier journals across science and medicine.",
    website: "https://www.sciencedirect.com",
    retrieval: ["link_only", "api_with_key"],
    api: { available: true, requirement: "free_key", envKey: "ELSEVIER_API_KEY" },
    authentication: "free_key",
    restrictions: [LICENSED],
    licensing: "Licensed; text-and-data-mining access by agreement only.",
    contentTypes: ["abstracts", "articles"],
    reliability: "peer_reviewed",
    fullTextRetrieval: false,
  }),
  entry({
    id: "springer-nature",
    name: "Springer Nature",
    categories: ["academic_research", "science"],
    description: "Springer and Nature journals, books and metadata.",
    website: "https://www.springernature.com",
    retrieval: ["link_only", "api_with_key"],
    api: { available: true, requirement: "free_key", envKey: "SPRINGER_API_KEY" },
    authentication: "free_key",
    restrictions: [LICENSED],
    licensing: "Metadata open; full text licensed.",
    contentTypes: ["abstracts", "articles"],
    reliability: "peer_reviewed",
    fullTextRetrieval: false,
  }),
  entry({
    id: "wiley",
    name: "Wiley Online Library",
    categories: ["academic_research", "science"],
    description: "Wiley journals and reference works.",
    website: "https://onlinelibrary.wiley.com",
    retrieval: ["link_only"],
    restrictions: [LICENSED],
    licensing: "Licensed; text-and-data-mining by agreement.",
    contentTypes: ["abstracts", "articles"],
    reliability: "peer_reviewed",
    fullTextRetrieval: false,
  }),
  entry({
    id: "google-scholar",
    name: "Google Scholar",
    categories: ["academic_research"],
    description: "Broad scholarly discovery index.",
    website: "https://scholar.google.com",
    retrieval: ["link_only"],
    restrictions: [
      "Google Scholar's terms do not permit automated retrieval, so Sophira never scrapes it. You may search it yourself; Sophira links you there.",
    ],
    licensing: "No automated access permitted.",
    contentTypes: ["abstracts"],
    reliability: "mixed",
    fullTextRetrieval: false,
  }),

  /* ---------------- 4.3 government and scientific ---------------- */
  entry({
    id: "nasa",
    name: "NASA",
    categories: ["government", "science"],
    description: "Mission science, imagery and technical reports.",
    website: "https://www.nasa.gov",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "free_key", envKey: "NASA_API_KEY", baseUrl: "https://api.nasa.gov" },
    authentication: "free_key",
    licensing: "Mostly public domain (U.S. Government work).",
    contentTypes: ["articles", "datasets", "images"],
    reliability: "official",
  }),
  entry({
    id: "noaa",
    name: "NOAA",
    categories: ["government", "science", "data"],
    description: "Climate, ocean and weather data and reports.",
    website: "https://www.noaa.gov",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "none", baseUrl: "https://www.ncei.noaa.gov" },
    licensing: "Public domain (U.S. Government work).",
    contentTypes: ["datasets", "statistics", "articles"],
    reliability: "official",
  }),
  entry({
    id: "usgs",
    name: "USGS",
    categories: ["government", "science", "data"],
    description: "Earth science data, maps and publications.",
    website: "https://www.usgs.gov",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "none", baseUrl: "https://earthquake.usgs.gov" },
    licensing: "Public domain (U.S. Government work).",
    contentTypes: ["datasets", "statistics", "images"],
    reliability: "official",
  }),
  entry({
    id: "cdc",
    name: "CDC",
    categories: ["government", "science", "data"],
    description: "Public health guidance, surveillance data and reports.",
    website: "https://www.cdc.gov",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "none", baseUrl: "https://data.cdc.gov" },
    licensing: "Public domain (U.S. Government work).",
    contentTypes: ["statistics", "articles", "datasets"],
    reliability: "official",
    restrictions: ["Health guidance is dated: cite the version date the page shows, not today's date."],
  }),
  entry({
    id: "nih",
    name: "NIH",
    categories: ["government", "science"],
    description: "Biomedical research funding, reports and public data.",
    website: "https://www.nih.gov",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "none", baseUrl: "https://api.reporter.nih.gov" },
    licensing: "Public domain unless noted.",
    contentTypes: ["articles", "datasets"],
    reliability: "official",
  }),
  entry({
    id: "epa",
    name: "EPA",
    categories: ["government", "science", "data"],
    description: "Environmental regulation, monitoring data and reports.",
    website: "https://www.epa.gov",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "none", baseUrl: "https://aqs.epa.gov" },
    licensing: "Public domain (U.S. Government work).",
    contentTypes: ["statistics", "legislation", "datasets"],
    reliability: "official",
  }),
  entry({
    id: "nsf",
    name: "National Science Foundation",
    categories: ["government", "academic_research"],
    description: "Funded research awards, reports and statistics.",
    website: "https://www.nsf.gov",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "free_key", envKey: "NSF_API_KEY", baseUrl: "https://api.nsf.gov" },
    authentication: "free_key",
    licensing: "Public domain unless noted.",
    contentTypes: ["articles", "statistics"],
    reliability: "official",
  }),
  entry({
    id: "census",
    name: "U.S. Census Bureau",
    categories: ["government", "data"],
    description: "Population, housing and economic statistics.",
    website: "https://www.census.gov",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://api.census.gov" },
    licensing: "Public domain (U.S. Government work).",
    contentTypes: ["statistics", "datasets"],
    reliability: "official",
  }),
  entry({
    id: "bls",
    name: "Bureau of Labor Statistics",
    categories: ["government", "data"],
    description: "Employment, prices and wage statistics.",
    website: "https://www.bls.gov",
    retrieval: ["open_api"],
    api: { available: true, requirement: "free_key", envKey: "BLS_API_KEY", baseUrl: "https://api.bls.gov" },
    authentication: "free_key",
    licensing: "Public domain (U.S. Government work).",
    contentTypes: ["statistics", "datasets"],
    reliability: "official",
  }),
  entry({
    id: "data-gov",
    name: "Data.gov",
    categories: ["government", "data"],
    description: "Catalogue of U.S. federal open datasets.",
    website: "https://data.gov",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://catalog.data.gov" },
    licensing: "Varies by dataset; usually open.",
    contentTypes: ["datasets"],
    reliability: "official",
  }),
  entry({
    id: "world-bank",
    name: "World Bank Open Data",
    categories: ["government", "data", "academic_research"],
    description: "Development indicators for every country.",
    website: "https://data.worldbank.org",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://api.worldbank.org" },
    licensing: "CC BY 4.0.",
    contentTypes: ["statistics", "datasets"],
    reliability: "official",
  }),
  entry({
    id: "united-nations",
    name: "United Nations",
    categories: ["government", "data"],
    description: "UN statistics, Sustainable Development Goal indicators and official reports.",
    website: "https://data.un.org",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "none", baseUrl: "https://unstats.un.org" },
    licensing: "UN terms of use; cite the source.",
    contentTypes: ["statistics", "datasets", "articles"],
    reliability: "official",
  }),
  entry({
    id: "who",
    name: "World Health Organization",
    categories: ["government", "science", "data"],
    description: "Global health statistics, guidance and reports.",
    website: "https://www.who.int",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "none", baseUrl: "https://ghoapi.azureedge.net/api" },
    licensing: "CC BY-NC-SA 3.0 IGO unless noted.",
    contentTypes: ["statistics", "articles", "datasets"],
    reliability: "official",
  }),
  entry({
    id: "oecd",
    name: "OECD",
    categories: ["government", "data", "academic_research"],
    description: "Cross-country economic and social indicators.",
    website: "https://data.oecd.org",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://sdmx.oecd.org" },
    licensing: "OECD terms; cite the source.",
    contentTypes: ["statistics", "datasets"],
    reliability: "official",
  }),
  entry({
    id: "eurostat",
    name: "Eurostat",
    categories: ["government", "data"],
    description: "European Union statistics.",
    website: "https://ec.europa.eu/eurostat",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://ec.europa.eu/eurostat/api" },
    licensing: "Reuse permitted with attribution.",
    contentTypes: ["statistics", "datasets"],
    reliability: "official",
  }),
  entry({
    id: "nist",
    name: "NIST",
    categories: ["government", "science"],
    description: "Measurement standards, reference data and publications.",
    website: "https://www.nist.gov",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "none", baseUrl: "https://webbook.nist.gov" },
    licensing: "Public domain (U.S. Government work).",
    contentTypes: ["datasets", "articles", "definitions"],
    reliability: "official",
  }),
  entry({
    id: "congress-gov",
    name: "Congress.gov",
    categories: ["government", "law"],
    description: "Bill text, laws, votes and the Congressional Record.",
    website: "https://www.congress.gov",
    retrieval: ["open_api"],
    api: { available: true, requirement: "free_key", envKey: "CONGRESS_API_KEY", baseUrl: "https://api.congress.gov" },
    authentication: "free_key",
    licensing: "Public domain (U.S. Government work).",
    contentTypes: ["legislation", "full_text"],
    reliability: "official",
  }),
  entry({
    id: "gao",
    name: "Government Accountability Office",
    categories: ["government"],
    description: "Audit reports and evaluations of federal programmes.",
    website: "https://www.gao.gov",
    retrieval: ["open_web"],
    licensing: "Public domain (U.S. Government work).",
    contentTypes: ["articles", "full_text"],
    reliability: "official",
  }),

  /* ---------------- 4.4 libraries and history ---------------- */
  entry({
    id: "library-of-congress",
    name: "Library of Congress",
    categories: ["library_history", "government"],
    description: "Digitised collections, photographs, maps and manuscripts.",
    website: "https://www.loc.gov",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "none", baseUrl: "https://www.loc.gov" },
    licensing: "Varies by item; many are public domain.",
    contentTypes: ["archives", "images", "full_text"],
    reliability: "official",
  }),
  entry({
    id: "national-archives",
    name: "U.S. National Archives (NARA)",
    categories: ["library_history", "government"],
    description: "Federal records, including declassified historical documents.",
    website: "https://www.archives.gov",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "free_key", envKey: "NARA_API_KEY", baseUrl: "https://catalog.archives.gov" },
    authentication: "free_key",
    licensing: "Public domain (U.S. Government work).",
    contentTypes: ["archives", "full_text", "images"],
    reliability: "official",
    restrictions: ["Only records the catalogue publishes as public are reachable. Classified material is never retrieved."],
  }),
  entry({
    id: "internet-archive",
    name: "Internet Archive",
    categories: ["library_history", "reference"],
    description: "Books, audio, web archives and digitised collections.",
    website: "https://archive.org",
    retrieval: ["open_api", "open_web", "bulk_dataset"],
    api: { available: true, requirement: "none", baseUrl: "https://archive.org/advancedsearch.php" },
    licensing: "Varies by item; many public domain.",
    contentTypes: ["books", "archives", "images", "audio", "full_text"],
    reliability: "community",
  }),
  entry({
    id: "dpla",
    name: "Digital Public Library of America",
    categories: ["library_history"],
    description: "Aggregated digitised collections from U.S. libraries and museums.",
    website: "https://dp.la",
    retrieval: ["api_with_key"],
    api: { available: true, requirement: "free_key", envKey: "DPLA_API_KEY" },
    authentication: "free_key",
    licensing: "Varies by item.",
    contentTypes: ["archives", "images"],
    reliability: "institutional",
  }),
  entry({
    id: "europeana",
    name: "Europeana",
    categories: ["library_history"],
    description: "European cultural heritage collections.",
    website: "https://www.europeana.eu",
    retrieval: ["api_with_key"],
    api: { available: true, requirement: "free_key", envKey: "EUROPEANA_API_KEY" },
    authentication: "free_key",
    licensing: "Metadata CC0; items vary.",
    contentTypes: ["archives", "images"],
    reliability: "institutional",
  }),
  entry({
    id: "hathitrust",
    name: "HathiTrust",
    categories: ["library_history"],
    description: "Large digitised book corpus with full-text search.",
    website: "https://www.hathitrust.org",
    retrieval: ["link_only"],
    restrictions: [
      "In-copyright full text is not readable without institutional access; Sophira shows the catalogue record and links you to it.",
    ],
    licensing: "Licensed; full-text access depends on rights.",
    contentTypes: ["books", "archives"],
    reliability: "institutional",
  }),
  entry({
    id: "smithsonian",
    name: "Smithsonian Institution",
    categories: ["library_history", "science"],
    description: "Museum collections, objects and research.",
    website: "https://www.si.edu",
    retrieval: ["open_api"],
    api: { available: true, requirement: "free_key", envKey: "SMITHSONIAN_API_KEY", baseUrl: "https://api.si.edu" },
    authentication: "free_key",
    licensing: "Open Access items CC0.",
    contentTypes: ["images", "archives"],
    reliability: "institutional",
  }),
  entry({
    id: "google-books",
    name: "Google Books",
    categories: ["library_history", "reference"],
    description: "Book metadata, snippets and previews.",
    website: "https://books.google.com",
    retrieval: ["api_with_key"],
    api: { available: true, requirement: "free_key", envKey: "GOOGLE_BOOKS_API_KEY" },
    authentication: "free_key",
    restrictions: ["Snippets and previews only where the book is in copyright."],
    licensing: "Preview terms; no bulk text retrieval.",
    contentTypes: ["books", "reference_entries"],
    reliability: "mixed",
    fullTextRetrieval: false,
  }),

  /* ---------------- 4.5 news and journalism ---------------- */
  entry({
    id: "ap",
    name: "Associated Press",
    categories: ["news"],
    description: "Wire reporting that many outlets republish verbatim.",
    website: "https://apnews.com",
    retrieval: ["link_only"],
    restrictions: [
      "Licensed wire copy; linking only.",
      "Because many outlets republish AP, several 'different' articles can be one original report.",
    ],
    licensing: "Licensed.",
    contentTypes: ["articles"],
    reliability: "editorial",
  }),
  entry({
    id: "reuters",
    name: "Reuters",
    categories: ["news"],
    description: "International wire reporting.",
    website: "https://www.reuters.com",
    retrieval: ["link_only"],
    restrictions: ["Licensed; linking only."],
    licensing: "Licensed.",
    contentTypes: ["articles"],
    reliability: "editorial",
  }),
  entry({
    id: "bbc",
    name: "BBC",
    categories: ["news"],
    description: "Public-service news, analysis and explainers.",
    website: "https://www.bbc.com",
    retrieval: ["open_web"],
    restrictions: [
      "BBC 'Analysis', 'Opinion' and 'Verification' pieces are labelled: the format is not the same as a news report.",
    ],
    licensing: "All rights reserved; cite and link.",
    contentTypes: ["articles", "video"],
    reliability: "editorial",
  }),
  entry({
    id: "npr",
    name: "NPR",
    categories: ["news"],
    description: "U.S. public radio news and transcripts.",
    website: "https://www.npr.org",
    retrieval: ["open_web"],
    licensing: "All rights reserved; cite and link.",
    contentTypes: ["articles", "audio"],
    reliability: "editorial",
  }),
  entry({
    id: "pbs-news",
    name: "PBS NewsHour",
    categories: ["news"],
    description: "U.S. public television news and transcripts.",
    website: "https://www.pbs.org/newshour",
    retrieval: ["open_web"],
    licensing: "All rights reserved; cite and link.",
    contentTypes: ["articles", "video"],
    reliability: "editorial",
  }),
  entry({
    id: "guardian",
    name: "The Guardian",
    categories: ["news"],
    description: "Reporting, opinion and long-form journalism.",
    website: "https://www.theguardian.com",
    retrieval: ["open_web", "api_with_key"],
    api: { available: true, requirement: "free_key", envKey: "GUARDIAN_API_KEY", baseUrl: "https://content.guardianapis.com" },
    authentication: "free_key",
    licensing: "Open Platform terms; cite and link.",
    contentTypes: ["articles"],
    reliability: "editorial",
  }),
  entry({
    id: "nyt",
    name: "The New York Times",
    categories: ["news"],
    description: "Reporting, analysis and opinion.",
    website: "https://www.nytimes.com",
    retrieval: ["link_only", "api_with_key"],
    api: { available: true, requirement: "free_key", envKey: "NYT_API_KEY", baseUrl: "https://api.nytimes.com" },
    authentication: "free_key",
    restrictions: ["Metadata is available; article bodies need a subscription. Sophira never bypasses the paywall."],
    licensing: "Licensed.",
    contentTypes: ["articles"],
    reliability: "editorial",
    fullTextRetrieval: false,
  }),
  entry({
    id: "washington-post",
    name: "The Washington Post",
    categories: ["news"],
    description: "Reporting, analysis and opinion.",
    website: "https://www.washingtonpost.com",
    retrieval: ["link_only"],
    restrictions: [LICENSED],
    licensing: "Licensed.",
    contentTypes: ["articles"],
    reliability: "editorial",
    fullTextRetrieval: false,
  }),
  entry({
    id: "al-jazeera",
    name: "Al Jazeera",
    categories: ["news"],
    description: "International reporting with a non-Western perspective.",
    website: "https://www.aljazeera.com",
    retrieval: ["open_web"],
    licensing: "All rights reserved; cite and link.",
    contentTypes: ["articles", "video"],
    reliability: "editorial",
  }),
  entry({
    id: "financial-times",
    name: "Financial Times",
    categories: ["news"],
    description: "Business and economic reporting.",
    website: "https://www.ft.com",
    retrieval: ["link_only"],
    restrictions: [LICENSED],
    licensing: "Licensed.",
    contentTypes: ["articles"],
    reliability: "editorial",
    fullTextRetrieval: false,
  }),

  /* ---------------- 4.6 subject-specific ---------------- */
  entry({
    id: "mathworld",
    name: "Wolfram MathWorld",
    categories: ["reference", "science"],
    description: "Definitions and explanations across mathematics.",
    website: "https://mathworld.wolfram.com",
    retrieval: ["open_web"],
    licensing: "All rights reserved; cite and link.",
    contentTypes: ["definitions", "reference_entries"],
    reliability: "editorial",
  }),
  entry({
    id: "desmos",
    name: "Desmos",
    categories: ["education", "science"],
    description: "Graphing and interactive mathematics tools.",
    website: "https://www.desmos.com",
    retrieval: ["link_only"],
    restrictions: ["An interactive tool, not a citable text. Use it to explore, then cite a text."],
    licensing: "All rights reserved.",
    contentTypes: ["definitions"],
    reliability: "institutional",
    fullTextRetrieval: false,
  }),
  entry({
    id: "geogebra",
    name: "GeoGebra",
    categories: ["education", "science"],
    description: "Interactive geometry, algebra and statistics material.",
    website: "https://www.geogebra.org",
    retrieval: ["open_web"],
    licensing: "Mixed open licences on shared material.",
    contentTypes: ["definitions", "video"],
    reliability: "community",
  }),
  entry({
    id: "cern",
    name: "CERN Open Data",
    categories: ["science", "academic_research"],
    description: "Particle physics datasets, software and documentation.",
    website: "https://opendata.cern.ch",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "none", baseUrl: "https://opendata.cern.ch/api" },
    licensing: "CC0 / CC BY depending on dataset.",
    contentTypes: ["datasets", "articles"],
    reliability: "institutional",
  }),
  entry({
    id: "hyperphysics",
    name: "HyperPhysics",
    categories: ["reference", "science"],
    description: "Concept maps explaining physics topics.",
    website: "http://hyperphysics.phy-astr.gsu.edu",
    retrieval: ["open_web"],
    licensing: "Educational use with attribution.",
    contentTypes: ["reference_entries", "definitions"],
    reliability: "institutional",
  }),
  entry({
    id: "pubchem",
    name: "PubChem",
    categories: ["science", "data"],
    description: "Chemical structures, properties and bioactivity data.",
    website: "https://pubchem.ncbi.nlm.nih.gov",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://pubchem.ncbi.nlm.nih.gov/rest/pug" },
    licensing: "Public domain metadata.",
    contentTypes: ["datasets", "definitions"],
    reliability: "official",
  }),
  entry({
    id: "chemspider",
    name: "ChemSpider (Royal Society of Chemistry)",
    categories: ["science", "data"],
    description: "Chemical structure database.",
    website: "https://www.chemspider.com",
    retrieval: ["api_with_key"],
    api: { available: true, requirement: "free_key", envKey: "CHEMSPIDER_API_KEY" },
    authentication: "free_key",
    licensing: "Royal Society of Chemistry terms.",
    contentTypes: ["datasets", "definitions"],
    reliability: "institutional",
  }),
  entry({
    id: "ncbi",
    name: "NCBI (GenBank and friends)",
    categories: ["science", "data"],
    description: "Genetic sequences and molecular biology databases.",
    website: "https://www.ncbi.nlm.nih.gov",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils" },
    licensing: "Public domain metadata.",
    contentTypes: ["datasets"],
    reliability: "official",
  }),
  entry({
    id: "inaturalist",
    name: "iNaturalist",
    categories: ["science", "data"],
    description: "Citizen-science observations of organisms.",
    website: "https://www.inaturalist.org",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://api.inaturalist.org" },
    licensing: "Observation licences vary; many CC BY-NC.",
    contentTypes: ["images", "datasets"],
    reliability: "community",
    restrictions: ["Observations are community-verified identifications, not authoritative taxonomy."],
  }),
  entry({
    id: "encyclopedia-of-life",
    name: "Encyclopedia of Life",
    categories: ["science", "reference"],
    description: "Species pages aggregating taxonomic and ecological information.",
    website: "https://eol.org",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://eol.org/api" },
    licensing: "Mixed open licences.",
    contentTypes: ["reference_entries"],
    reliability: "mixed",
  }),
  entry({
    id: "medlineplus",
    name: "MedlinePlus",
    categories: ["science", "reference"],
    description: "Plain-language health information from the U.S. National Library of Medicine.",
    website: "https://medlineplus.gov",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "none", baseUrl: "https://connect.medlineplus.gov" },
    licensing: "Public domain (U.S. Government work).",
    contentTypes: ["reference_entries", "articles"],
    reliability: "official",
  }),
  entry({
    id: "mdn",
    name: "MDN Web Docs",
    categories: ["computing", "reference"],
    description: "Authoritative documentation for web platform technology.",
    website: "https://developer.mozilla.org",
    retrieval: ["open_web"],
    licensing: "CC BY-SA 2.5 for content.",
    contentTypes: ["reference_entries", "articles"],
    reliability: "institutional",
  }),
  entry({
    id: "github",
    name: "GitHub",
    categories: ["computing"],
    description: "Source repositories and documentation, where the licence permits use.",
    website: "https://github.com",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "free_key", envKey: "GITHUB_TOKEN", baseUrl: "https://api.github.com" },
    authentication: "free_key",
    licensing: "Each repository carries its own licence.",
    contentTypes: ["full_text", "reference_entries"],
    reliability: "community",
    restrictions: ["A repository being public is not permission to reuse it: check its licence."],
  }),
  entry({
    id: "poetry-foundation",
    name: "Poetry Foundation",
    categories: ["literature"],
    description: "Poems, poet biographies and criticism.",
    website: "https://www.poetryfoundation.org",
    retrieval: ["open_web"],
    licensing: "All rights reserved; cite and link.",
    contentTypes: ["full_text", "articles"],
    reliability: "editorial",
  }),
  entry({
    id: "sep",
    name: "Stanford Encyclopedia of Philosophy",
    categories: ["philosophy", "reference"],
    description: "Peer-reviewed philosophy reference articles with stable citations.",
    website: "https://plato.stanford.edu",
    retrieval: ["open_web"],
    licensing: "Free to read; cite the article and its archive address.",
    contentTypes: ["reference_entries"],
    reliability: "peer_reviewed",
  }),
  entry({
    id: "iep",
    name: "Internet Encyclopedia of Philosophy",
    categories: ["philosophy", "reference"],
    description: "Peer-reviewed philosophy reference articles.",
    website: "https://iep.utm.edu",
    retrieval: ["open_web"],
    licensing: "Free to read; cite and link.",
    contentTypes: ["reference_entries"],
    reliability: "peer_reviewed",
  }),
  entry({
    id: "fred",
    name: "FRED (Federal Reserve Bank of St. Louis)",
    categories: ["data", "government"],
    description: "U.S. economic time series, downloadable and citable.",
    website: "https://fred.stlouisfed.org",
    retrieval: ["api_with_key"],
    api: { available: true, requirement: "free_key", envKey: "FRED_API_KEY", baseUrl: "https://api.stlouisfed.org" },
    authentication: "free_key",
    licensing: "Free with attribution.",
    contentTypes: ["statistics", "datasets"],
    reliability: "institutional",
  }),
  entry({
    id: "imf",
    name: "International Monetary Fund",
    categories: ["data", "government"],
    description: "Macroeconomic and financial statistics.",
    website: "https://www.imf.org/en/Data",
    retrieval: ["open_api", "open_web"],
    api: { available: true, requirement: "none", baseUrl: "https://www.imf.org/external/datamapper/api" },
    licensing: "Reuse with attribution.",
    contentTypes: ["statistics", "datasets"],
    reliability: "official",
  }),
  entry({
    id: "cornell-lii",
    name: "Cornell Legal Information Institute",
    categories: ["law", "reference"],
    description: "Free access to U.S. statutes, regulations and case law.",
    website: "https://www.law.cornell.edu",
    retrieval: ["open_web"],
    licensing: "Free to read; cite and link.",
    contentTypes: ["legislation", "court_decisions", "reference_entries"],
    reliability: "institutional",
  }),
  entry({
    id: "courtlistener",
    name: "CourtListener (Free Law Project)",
    categories: ["law", "government"],
    description: "Public court opinions and oral arguments, including the Supreme Court.",
    website: "https://www.courtlistener.com",
    retrieval: ["open_api"],
    api: { available: true, requirement: "none", baseUrl: "https://www.courtlistener.com/api/rest/v4" },
    licensing: "Public domain opinions; cite the docket.",
    contentTypes: ["court_decisions", "full_text"],
    reliability: "institutional",
  }),
  entry({
    id: "supreme-court",
    name: "Supreme Court of the United States",
    categories: ["law", "government"],
    description: "Official opinions, orders and argument transcripts.",
    website: "https://www.supremecourt.gov",
    retrieval: ["open_web"],
    licensing: "Public domain (U.S. Government work).",
    contentTypes: ["court_decisions", "full_text"],
    reliability: "official",
  }),

  /* ---------------- 5.3 fact-checking resources ---------------- */
  entry({
    id: "snopes",
    name: "Snopes",
    categories: ["fact_check"],
    description: "Long-running fact-checking of viral claims, including satire labelling.",
    website: "https://www.snopes.com",
    retrieval: ["open_web"],
    licensing: "All rights reserved; cite and link.",
    contentTypes: ["articles"],
    reliability: "editorial",
    restrictions: ["A fact-check is evidence to weigh, never a substitute for the underlying evidence."],
  }),
  entry({
    id: "factcheck-org",
    name: "FactCheck.org",
    categories: ["fact_check"],
    description: "Fact-checks of political and public claims.",
    website: "https://www.factcheck.org",
    retrieval: ["open_web"],
    licensing: "Free to read; cite and link.",
    contentTypes: ["articles"],
    reliability: "editorial",
  }),
  entry({
    id: "politifact",
    name: "PolitiFact",
    categories: ["fact_check"],
    description: "Rated fact-checks of public statements.",
    website: "https://www.politifact.com",
    retrieval: ["open_web"],
    licensing: "Free to read; cite and link.",
    contentTypes: ["articles"],
    reliability: "editorial",
    restrictions: ["A rating is an editorial judgement on a stated scale; quote the rating and its date."],
  }),
  entry({
    id: "reuters-fact-check",
    name: "Reuters Fact Check",
    categories: ["fact_check"],
    description: "Fact-checks of viral images, video and claims.",
    website: "https://www.reuters.com/fact-check",
    retrieval: ["open_web"],
    licensing: "All rights reserved; cite and link.",
    contentTypes: ["articles"],
    reliability: "editorial",
  }),
  entry({
    id: "ap-fact-check",
    name: "AP Fact Check",
    categories: ["fact_check"],
    description: "Fact-checks from the Associated Press.",
    website: "https://apnews.com/hub/ap-fact-check",
    retrieval: ["open_web"],
    licensing: "Licensed.",
    contentTypes: ["articles"],
    reliability: "editorial",
  }),
  entry({
    id: "full-fact",
    name: "Full Fact",
    categories: ["fact_check"],
    description: "U.K. fact-checking of public claims and statistics.",
    website: "https://fullfact.org",
    retrieval: ["open_web"],
    licensing: "Free to read; cite and link.",
    contentTypes: ["articles"],
    reliability: "editorial",
  }),
  entry({
    id: "afp-fact-check",
    name: "AFP Fact Check",
    categories: ["fact_check"],
    description: "International fact-checks, strong on mislabelled images and video.",
    website: "https://factcheck.afp.com",
    retrieval: ["open_web"],
    licensing: "All rights reserved; cite and link.",
    contentTypes: ["articles"],
    reliability: "editorial",
  }),
  entry({
    id: "lead-stories",
    name: "Lead Stories",
    categories: ["fact_check"],
    description: "Debunking of trending false claims and fake news.",
    website: "https://leadstories.com",
    retrieval: ["open_web"],
    licensing: "All rights reserved; cite and link.",
    contentTypes: ["articles"],
    reliability: "editorial",
  }),
];

/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */

const BY_ID = new Map(SOURCE_REGISTRY.map((s) => [s.id, s]));

export function sourceById(id: string): SourceEntry | null {
  return BY_ID.get(id) ?? null;
}

export function sourcesForCategory(category: SourceCategory): SourceEntry[] {
  return SOURCE_REGISTRY.filter((s) => s.categories.includes(category));
}

/** Sources that may only be linked to: never fetched, never scraped. */
export function linkOnlySources(): SourceEntry[] {
  return SOURCE_REGISTRY.filter((s) => !s.retrieval.some((r) => r !== "link_only"));
}

/** Every source with at least one retrieval method that fetches content. */
export function fetchableSources(): SourceEntry[] {
  return SOURCE_REGISTRY.filter((s) =>
    s.retrieval.some((r) => r === "open_web" || r === "open_api" || r === "api_with_key" || r === "bulk_dataset"),
  );
}

export const FACT_CHECK_SOURCES: SourceEntry[] = sourcesForCategory("fact_check");

export function registryCounts(): { total: number; categories: Record<string, number> } {
  const categories: Record<string, number> = {};
  for (const s of SOURCE_REGISTRY) {
    for (const c of s.categories) categories[c] = (categories[c] ?? 0) + 1;
  }
  return { total: SOURCE_REGISTRY.length, categories };
}

/* ------------------------------------------------------------------ */
/* Honest connection state                                             */
/* ------------------------------------------------------------------ */

/** The same six states the owner readiness screen already uses. */
export type SourceState =
  | "connected"
  | "available"
  | "not-connected"
  | "needs-attention"
  | "unavailable"
  | "requires-owner-setup";

export interface RegistryContext {
  /** True only when a real external web search can run (researchReadiness().searchable). */
  searchConfigured: boolean;
  /** Does the server hold this environment variable? Never returns its value. */
  hasEnv: (name: string) => boolean;
  /** Now, for staleness. Injectable so tests are deterministic. */
  now?: Date;
}

export const VERIFICATION_STALE_DAYS = 90;

export interface SourceStatus {
  id: string;
  name: string;
  state: SourceState;
  /** Plain language, safe for a student or the owner to read. */
  explanation: string;
  /** Technical half, for the owner screen only. */
  ownerDetail: string;
}

function daysSince(iso: string, now: Date): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - then) / 86_400_000;
}

/**
 * What can Sophira ACTUALLY do with this source right now?
 *
 * The directive's rule is enforced here in code: a name in the registry proves
 * nothing. `connected` requires a live verification inside the staleness window AND a
 * capability that can reach the source. Everything else is reported as what it is.
 */
export function sourceStatus(source: SourceEntry, ctx: RegistryContext): SourceStatus {
  const now = ctx.now ?? new Date();
  const base = { id: source.id, name: source.name };

  const onlyLinks = !source.retrieval.some((r) => r !== "link_only");
  const reachableByWeb = source.retrieval.includes("open_web") && source.fullTextRetrieval;
  const needsKey = source.api.requirement === "free_key";
  const keyName = source.api.envKey ?? "";
  const hasKey = needsKey && keyName ? ctx.hasEnv(keyName) : false;
  const canCallApi = source.api.available && (source.api.requirement === "none" || hasKey);
  const canReach = reachableByWeb || canCallApi;

  const verified = source.lastVerified;
  const fresh = verified !== null && daysSince(verified, now) <= VERIFICATION_STALE_DAYS;

  if (verified !== null && !fresh) {
    return {
      ...base,
      state: "needs-attention",
      explanation: `Sophira last checked ${source.name} a while ago, so anything it reports about this source may be out of date.`,
      ownerDetail: `Last live verification ${verified} is older than ${VERIFICATION_STALE_DAYS} days. Re-run the source check.`,
    };
  }

  if (onlyLinks) {
    return {
      ...base,
      state: "not-connected",
      explanation: `Sophira cannot read ${source.name} directly. It can show you the way there so you can open it with your own access.`,
      ownerDetail: `Retrieval is link_only: ${source.restrictions[0] ?? "licensed or account-gated."}`,
    };
  }

  if (needsKey && !hasKey) {
    return {
      ...base,
      state: "requires-owner-setup",
      explanation: `${source.name} needs an account key that has not been added yet, so Sophira cannot search it. Your other sources still work.`,
      ownerDetail: `Set ${keyName || "the provider API key"} in the hosting environment to enable the ${source.id} adapter.`,
    };
  }

  if (!canReach) {
    return {
      ...base,
      state: "unavailable",
      explanation: `${source.name} cannot be reached from this installation right now. Sophira will use your other sources and will tell you what it could not reach.`,
      ownerDetail: `No usable retrieval path: retrieval=${source.retrieval.join("|")}, api.available=${source.api.available}.`,
    };
  }

  if (!ctx.searchConfigured && !canCallApi) {
    return {
      ...base,
      state: "requires-owner-setup",
      explanation: `Online research is turned off in this installation, so ${source.name} cannot be searched yet. Your saved documents still work.`,
      ownerDetail: "researchReadiness() is not external: no web search provider is configured.",
    };
  }

  if (fresh) {
    return {
      ...base,
      state: "connected",
      explanation: `${source.name} is set up and was checked successfully.`,
      ownerDetail: `Live verification recorded ${verified}.`,
    };
  }

  return {
    ...base,
    state: "available",
    explanation: `${source.name} can be reached, but Sophira has not confirmed it with a live check on this installation yet.`,
    ownerDetail: "Capability present, lastVerified is null: reported as Available, never as Connected.",
  };
}

export function catalogStatus(ctx: RegistryContext): SourceStatus[] {
  return SOURCE_REGISTRY.map((s) => sourceStatus(s, ctx));
}

export function catalogCounts(rows: SourceStatus[]): Record<SourceState, number> {
  const out: Record<SourceState, number> = {
    connected: 0,
    available: 0,
    "not-connected": 0,
    "needs-attention": 0,
    unavailable: 0,
    "requires-owner-setup": 0,
  };
  for (const row of rows) out[row.state]++;
  return out;
}

/* ------------------------------------------------------------------ */
/* Recording a real verification                                       */
/* ------------------------------------------------------------------ */

/**
 * Records that a live check of this source SUCCEEDED at `at` (ISO date). Only a
 * completed check may call this; holding a configured key is not a verification.
 */
export function markSourceVerified(id: string, at: string = new Date().toISOString()): boolean {
  const source = BY_ID.get(id);
  if (!source) return false;
  source.lastVerified = at;
  return true;
}

/** Testing seam: forget verification results (used by the test suite only). */
export function resetSourceVerification(): void {
  for (const s of SOURCE_REGISTRY) s.lastVerified = null;
}
