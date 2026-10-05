/**
 * Assignment-aware source authority (2026-10-05 round) — an EXTENSION of
 * the existing ranking system (src/lib/research/research.ts), never a
 * replacement: rankCandidates() keeps working exactly as before and is
 * still used as the generic fallback.
 *
 * The pipeline:
 *   1. classifyAssignment()   — deterministic subject/level/instruction
 *                               classification of the research task.
 *   2. AUTHORITY_PROFILES     — configurable, data-defined tier profiles
 *                               per category (HISTORY, SCIENCE, CURRENT
 *                               EVENTS, LITERATURE, SOCIAL SCIENCE).
 *   3. rankCandidatesForAssignment() — ranks hits under the task's
 *                               profile, considering:
 *                                 - assignment subject (via the profile)
 *                                 - grade level (spec.academicLevel)
 *                                 - teacher instructions (OVERRIDE)
 *                                 - required source type (OVERRIDE)
 *                                 - publication date vs dateRange
 *                                 - primary vs secondary source
 *                                 - peer-review status
 *                                 - institutional authority (only where
 *                                   the profile values it — .gov/.edu are
 *                                   NEVER blindly prioritized)
 *                                 - source relevance to the topic
 *                                 - evidence quality of the snippet
 *   4. The decision is RETURNED with every candidate and STORED with the
 *      source, so the final citation audit can explain exactly why the
 *      source was accepted.
 *
 * Teacher requirements override generic ranking preferences: a hit that
 * satisfies the teacher's required source type outranks one that does
 * not, regardless of the profile.
 */

import type { SearchHit } from "./provider";
import type { ResearchSpecInput } from "./research";

/* ------------------------------------------------------------------ */
/* Signal patterns                                                     */
/* ------------------------------------------------------------------ */

const PEER_REVIEW_DOMAINS =
  /(jstor\.org|doi\.org|pubmed|ncbi\.nlm|springer|sciencedirect|nature\.com|oup\.com|cambridge\.org|wiley\.com|elsevier|lancet|bmj\.com|nejm\.org|plos\.org|muse\.jhu|tandfonline|sagepub)/;

/** Journal domains WITHOUT the NIH/PubMed family — the science profile keeps
 * "Peer-reviewed journals" (tier 1) separate from "NIH/PubMed" (tier 2),
 * exactly as the authority hierarchy specifies. */
const JOURNAL_CORE_DOMAINS =
  /(jstor\.org|doi\.org|springer|sciencedirect|nature\.com|oup\.com|cambridge\.org|wiley\.com|elsevier|lancet|bmj\.com|nejm\.org|plos\.org|muse\.jhu|tandfonline|sagepub)/;

const GOV_DOMAIN = /\.gov$|\.gov\//;
const EDU_DOMAIN = /\.edu$|\.ac\.[a-z]{2}$/;
const MUSEUM_DOMAIN = /(museum|si\.edu|metmuseum|britishmuseum|history\.org|monticello|mountvernon|gettysburg)/;
const ARCHIVE_DOMAIN = /(archive|loc\.gov|nationalarchives|founders\.online|avalon\.law|presidency\.ucsb)/;
const STATS_DOMAIN = /(census\.gov|bls\.gov|data\.gov|nces|stats\.|oecd\.org|worldbank|imf\.org|federalreserve|bea\.gov|cdc\.gov\/data)/;
const RESEARCH_ORG_DOMAIN = /(pewresearch|brookings|rand\.org|urban\.org|nber\.org|kff\.org|nih\.gov|who\.int|nasa\.gov|noaa\.gov|aaas\.org|nationalacademies|cdc\.gov)/;
const NEWS_WIRE = /(reuters\.com|apnews\.com|afp\.com|bloomberg\.com)/;
const ESTABLISHED_NEWS = /(bbc\.(com|co\.uk)|npr\.org|theguardian|economist\.com|nytimes|wsj\.com|washingtonpost|atlantic\.com|newyorker|aljazeera|pbs\.org)/;
const LITERARY_ORG = /(poetryfoundation|poets\.org|gutenberg\.org|archive\.org|penguinrandomhouse|harpercollins|library\.org)/;

const SIGNALS = (hit: SearchHit): string =>
  `${hit.title} ${hit.snippet}`.toLowerCase();

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

export type AuthorityCategory =
  | "history"
  | "science"
  | "current_events"
  | "literature"
  | "social_science"
  | "general";

export interface AssignmentClassification {
  category: AuthorityCategory;
  rationale: string;
  confidence: number; // 0..1, deterministic signal strength
}

const CATEGORY_SIGNALS: Record<
  Exclude<AuthorityCategory, "general">,
  { patterns: RegExp; label: string }
> = {
  history: {
    patterns: /(histor(y|ian|ical)|civil war|revolution|ancient|medieval|archive|museum|civilization|empire|century|colonial|dynasty|primary source)/,
    label: "history",
  },
  science: {
    patterns: /(biolog(y|ical)|chemistry|physics|neurosci|genetic|evolution|climat|ecosystem|cell |organism|disease|medicine|clinical|epidemiolog|lab |laborator|photosynthes|mitosis)/,
    label: "biology/science",
  },
  current_events: {
    patterns: /(current event|this year|this month|breaking|latest|news|election|policy debate|crisis|ongoing|war in|2025|2026)/,
    label: "current events",
  },
  literature: {
    patterns: /(literatur|novel|poetr|poem|shakespeare|literary|playwright|author|criticism|short stor|narrator|protagonist|metaphor)/,
    label: "literature",
  },
  social_science: {
    patterns: /(sociolog|psycholog|econom(ic|ics)|anthropolog|political science|geograph|demograph|societ|social |census|inequalit|criminolog|linguistic)/,
    label: "social science",
  },
};

/**
 * Deterministic classification of the assignment/research task. The
 * teacher's own words (subject hints inside teacherRequirements /
 * sourceType) carry the most weight; then the topic/question/course text.
 * No signal → "general": the assignment's teacher/rubric requirements
 * determine the hierarchy, and if those are absent the generic ranking
 * (unchanged rankCandidates) applies.
 */
export function classifyAssignment(spec: ResearchSpecInput): AssignmentClassification {
  const teacherText = `${spec.teacherRequirements ?? ""} ${spec.sourceType ?? ""}`.toLowerCase();
  const taskText = `${spec.topic} ${spec.question ?? ""} ${spec.course ?? ""}`.toLowerCase();

  let best: { category: AuthorityCategory; hits: number } = { category: "general", hits: 0 };
  for (const [key, sig] of Object.entries(CATEGORY_SIGNALS)) {
    const teacherHits = (teacherText.match(sig.patterns) ?? []).length * 2; // teacher words weigh double
    const taskHits = (taskText.match(sig.patterns) ?? []).length;
    const total = teacherHits + taskHits;
    if (total > best.hits) best = { category: key as AuthorityCategory, hits: total };
  }

  if (best.hits === 0) {
    return {
      category: "general",
      rationale:
        "No subject signal in the topic or teacher requirements — using the assignment's teacher/rubric requirements; without any, the generic ranking applies.",
      confidence: 0,
    };
  }
  return {
    category: best.category,
    rationale: `Classified as ${CATEGORY_SIGNALS[best.category as Exclude<AuthorityCategory, "general">].label} from the assignment text (${best.hits} weighted signal(s)).`,
    confidence: Math.min(1, best.hits / 5),
  };
}

/* ------------------------------------------------------------------ */
/* Configurable authority profiles                                     */
/* ------------------------------------------------------------------ */

export interface AuthorityTier {
  name: string;
  domains: RegExp;
  signals?: RegExp;
}

export interface AuthorityProfile {
  category: AuthorityCategory;
  description: string;
  tiers: AuthorityTier[]; // ordered: index 0 is the highest authority
}

export const AUTHORITY_PROFILES: Record<AuthorityCategory, AuthorityProfile> = {
  history: {
    category: "history",
    description: "History: primary sources first, then scholarship.",
    tiers: [
      { name: "Primary sources", domains: ARCHIVE_DOMAIN, signals: /(primary source|firsthand|original (document|letter|diary|manuscript|map)|digital collection|transcript)/ },
      { name: "Scholarly books/articles", domains: /(jstor|doi\.org|cambridge\.org|oup\.com|muse\.jhu|tandfonline|university ?press)/, signals: /(university press|monograph|scholarly)/ },
      { name: "University archives", domains: EDU_DOMAIN, signals: /(archive|special collections|library|manuscript)/ },
      { name: "Museums", domains: MUSEUM_DOMAIN, signals: /(exhibit|collection|artifact)/ },
      { name: "Government archives", domains: /(nara|archives\.gov)/, signals: /(records|national archives)/ },
    ],
  },
  science: {
    category: "science",
    description: "Biology/science: peer-reviewed journals first.",
    tiers: [
      { name: "Peer-reviewed journals", domains: JOURNAL_CORE_DOMAINS },
      { name: "NIH/PubMed", domains: /(pubmed|ncbi\.nlm|nih\.gov)/ },
      { name: "University sources", domains: EDU_DOMAIN },
      { name: "Academic textbooks", domains: /(openstax|ncbi\.nlm\.nih\.gov\/books|textbook)/, signals: /(textbook|openstax)/ },
      { name: "Reputable scientific organizations", domains: RESEARCH_ORG_DOMAIN },
    ],
  },
  current_events: {
    category: "current_events",
    description: "Current events: original reporting first.",
    tiers: [
      { name: "Original reporting", domains: NEWS_WIRE },
      { name: "Government releases", domains: GOV_DOMAIN, signals: /(press release|statement|announcement|briefing)/ },
      { name: "Primary documents", domains: /(courtlistener|govinfo|congress\.gov|documents)/, signals: /(full text|transcript|filing|bill text)/ },
      { name: "Established news organizations", domains: ESTABLISHED_NEWS },
    ],
  },
  literature: {
    category: "literature",
    description: "Literature: the primary text first.",
    tiers: [
      { name: "Primary text", domains: /(gutenberg|archive\.org|poets\.org|poetryfoundation)/, signals: /(full text|complete text|original text|\be-?text\b)/ },
      { name: "Scholarly criticism", domains: /(jstor|muse\.jhu|cambridge\.org|oup\.com|mla\.org)/, signals: /(criticism|critical (essay|analysis)|scholarly)/ },
      { name: "University sources", domains: EDU_DOMAIN },
      { name: "Academic journals", domains: PEER_REVIEW_DOMAINS },
      { name: "Reputable literary organizations", domains: LITERARY_ORG },
    ],
  },
  social_science: {
    category: "social_science",
    description: "Social science: peer-reviewed research first.",
    tiers: [
      { name: "Peer-reviewed research", domains: JOURNAL_CORE_DOMAINS },
      { name: "Government statistics", domains: STATS_DOMAIN, signals: /(statistics|data|census|survey)/ },
      { name: "University research", domains: EDU_DOMAIN },
      { name: "Established research organizations", domains: RESEARCH_ORG_DOMAIN },
      { name: "Reputable secondary sources", domains: /(britannica|wikipedia\.org|encyclopedia)/ },
    ],
  },
  general: {
    category: "general",
    description: "General academic: the assignment's teacher/rubric requirements determine the authority hierarchy.",
    tiers: [], // resolved at runtime from the teacher's required source type
  },
};

/** Configurability: an owner/spec can replace or add a profile. */
export function registerAuthorityProfile(profile: AuthorityProfile): void {
  AUTHORITY_PROFILES[profile.category] = profile;
}

/** The teacher's explicit source-type requirement, parsed deterministically. */
export type TeacherSourceType =
  | "peer_reviewed"
  | "government"
  | "university"
  | "primary"
  | "any"
  | "unrecognized";

export function parseTeacherSourceType(sourceType: string | null | undefined): TeacherSourceType {
  const st = (sourceType ?? "").toLowerCase();
  if (!st || st === "any" || st === "any reputable") return "any";
  if (/primary/.test(st)) return "primary";
  if (/peer[- ]?review|journal|scholarly|academic source|doi/.test(st)) return "peer_reviewed";
  if (/government|gov\b/.test(st)) return "government";
  if (/university|edu\b/.test(st)) return "university";
  return "unrecognized";
}

function satisfiesTeacherRequirement(
  hit: SearchHit,
  domain: string,
  requirement: TeacherSourceType
): boolean {
  const sig = SIGNALS(hit);
  switch (requirement) {
    case "peer_reviewed":
      return PEER_REVIEW_DOMAINS.test(domain) || /doi|10\.\d{4,}/.test(sig);
    case "government":
      return /\.gov$/.test(domain);
    case "university":
      return EDU_DOMAIN.test(domain);
    case "primary":
      return ARCHIVE_DOMAIN.test(domain) || /(primary source|firsthand|full text|original (document|text|letter|diary|manuscript))/.test(sig);
    case "any":
      return true;
    default:
      return false; // unrecognized requirements: no boost either way
  }
}

/* ------------------------------------------------------------------ */
/* The authority decision (stored with the source)                     */
/* ------------------------------------------------------------------ */

export interface AuthorityDecision {
  category: AuthorityCategory;
  classification_rationale: string;
  tier: number | null; // 1-based within the profile; null = no tier match
  tier_name: string | null;
  score: number;
  primary_source: boolean;
  peer_reviewed: boolean;
  institutional: boolean; // recorded for explanation, never a blind boost
  teacher_required: boolean; // satisfies the teacher's explicit requirement
  date_fit: number;
  relevance: number;
  evidence_quality: number;
  reasons: string[]; // human-readable: why this source was accepted
}

export function assessSourceAuthority(
  hit: SearchHit,
  spec: ResearchSpecInput,
  profile: AuthorityProfile,
  classification: AssignmentClassification
): AuthorityDecision {
  const reasons: string[] = [];
  let domain = "";
  try { domain = new URL(hit.url).hostname.replace(/^www\./, ""); } catch { /* invalid below */ }
  const sig = SIGNALS(hit);

  let score = 0;
  let tier: number | null = null;
  let tierName: string | null = null;

  // Profile tier match (index 0 = tier 1 = highest).
  for (let i = 0; i < profile.tiers.length; i++) {
    const t = profile.tiers[i];
    if (t.domains.test(domain) || (t.signals?.test(sig) ?? false)) {
      tier = i + 1;
      tierName = t.name;
      score += (profile.tiers.length - i) * 3;
      reasons.push(`Tier ${tier} of the ${profile.category} authority profile: ${t.name}.`);
      break;
    }
  }

  // Teacher requirement OVERRIDE: generic preferences never beat it.
  const requirement = parseTeacherSourceType(spec.sourceType);
  let teacher_required = false;
  if (requirement !== "any" && requirement !== "unrecognized") {
    if (satisfiesTeacherRequirement(hit, domain, requirement)) {
      teacher_required = true;
      score += 10;
      reasons.push("Satisfies the teacher's required source type — teacher requirements override generic ranking.");
    } else {
      score -= 8;
      reasons.push("Does not satisfy the teacher's required source type — ranks below sources that do.");
    }
  }

  // Publication date fit vs the assignment's date range.
  let date_fit = 0;
  const published = hit.published ? Date.parse(hit.published) : NaN;
  if (!Number.isNaN(published) && /recent|last[- ]?5[- ]?years/.test(spec.dateRange ?? "")) {
    const years = (Date.now() - published) / (365.25 * 86_400_000);
    if (years <= 2) { date_fit = 4; reasons.push("Published within the last two years (recent-source requirement)."); }
    else if (years <= 5) { date_fit = 3; reasons.push("Published within the last five years (recent-source requirement)."); }
    else { date_fit = -3; reasons.push("Older than the assignment's recent-source requirement — ranked below newer sources."); }
    score += date_fit;
  }

  // Source relevance: topic/question word overlap with title+snippet.
  const topicWords = new Set(
    (`${spec.topic} ${spec.question ?? ""}`)
      .toLowerCase()
      .match(/[a-z][a-z'-]{3,}/g) ?? []
  );
  const sigWords = new Set(sig.match(/[a-z][a-z'-]{3,}/g) ?? []);
  let overlap = 0;
  topicWords.forEach((w) => { if (sigWords.has(w)) overlap++; });
  const relevance = topicWords.size > 0 ? overlap / topicWords.size : 0;
  if (relevance >= 0.2) {
    score += Math.round(relevance * 5);
    reasons.push(`Relevant to the topic (${Math.round(relevance * 100)}% term overlap).`);
  }

  // Evidence quality of what the search returned.
  let evidence_quality = 0;
  if (hit.snippet && hit.snippet.length >= 120) { evidence_quality += 1; }
  if (/\d/.test(hit.snippet ?? "")) { evidence_quality += 1; }
  if (evidence_quality > 0) score += evidence_quality;
  if (evidence_quality === 0) reasons.push("Thin snippet — lower evidence-quality signal.");

  // Transport sanity (same policy as the existing generic ranker).
  if (hit.url.startsWith("http://")) { score -= 5; reasons.push("Plain HTTP — downranked."); }
  if (!hit.url.startsWith("http")) score -= 10; // invalid → filtered out

  // GENERAL with no teacher requirement: the assignment's teacher/rubric
  // requirements were supposed to determine the hierarchy and there are
  // none — fall back to the existing GENERIC domain-quality heuristic
  // (documented in research.ts; unchanged for every other path).
  if (profile.tiers.length === 0 && requirement === "any") {
    if (/\.gov$|\.edu$|\.ac\.[a-z]{2}$/.test(domain)) score += 3;
    if (PEER_REVIEW_DOMAINS.test(domain)) score += 3;
    if (/(wikipedia\.org|britannica\.com)/.test(domain)) score -= 1;
    if (hit.title && hit.snippet) score += 1;
    reasons.push("No profile applies and no teacher requirement exists — generic domain-quality heuristic used (the unchanged pre-existing behavior).");
  } else if (tier === null && requirement === "any") {
    reasons.push("No profile tier matched — ranked by relevance and evidence quality alone.");
  }

  return {
    category: classification.category,
    classification_rationale: classification.rationale,
    tier,
    tier_name: tierName,
    score,
    primary_source: /primary/i.test(tierName ?? "") || (requirement === "primary" && teacher_required),
    peer_reviewed: PEER_REVIEW_DOMAINS.test(domain) || /doi|10\.\d{4,}/.test(sig),
    institutional: /\.gov$|\.ac\./.test(domain) || EDU_DOMAIN.test(domain) || MUSEUM_DOMAIN.test(domain) || ARCHIVE_DOMAIN.test(domain),
    teacher_required,
    date_fit,
    relevance,
    evidence_quality,
    reasons,
  };
}

/* ------------------------------------------------------------------ */
/* Assignment-aware ranking (extends, never replaces, rankCandidates)   */
/* ------------------------------------------------------------------ */

export interface RankedCandidate {
  hit: SearchHit;
  decision: AuthorityDecision;
}

export function rankCandidatesForAssignment(
  hits: SearchHit[],
  spec: ResearchSpecInput
): RankedCandidate[] {
  const classification = classifyAssignment(spec);
  const profile = AUTHORITY_PROFILES[classification.category];
  const ranked = hits.map((hit) => ({
    hit,
    decision: assessSourceAuthority(hit, spec, profile, classification),
  }));
  // Teacher requirements OVERRIDE generic ranking preferences: when the
  // teacher required a specific source type, satisfying hits ALWAYS rank
  // above non-satisfying ones — no amount of profile tier or relevance
  // beats the gate. ("any"/unrecognized requirements: pure score.)
  const req = parseTeacherSourceType(spec.sourceType);
  const teacherGate = req !== "any" && req !== "unrecognized";
  // Same filter policy as the existing generic ranker: unusable hits out.
  // Ordering: teacher gate first, then the profile's authority TIER (the
  // hierarchy itself), then score (relevance, evidence quality, date fit)
  // to rank within a tier. Sources without a tier match sort after all
  // tier-matched ones.
  return ranked
    .filter((r) => r.decision.score > -4)
    .sort((a, b) => {
      if (teacherGate) {
        const ta = a.decision.teacher_required ? 1 : 0;
        const tb = b.decision.teacher_required ? 1 : 0;
        if (ta !== tb) return tb - ta;
      }
      const tierA = a.decision.tier ?? 99;
      const tierB = b.decision.tier ?? 99;
      if (tierA !== tierB) return tierA - tierB;
      return b.decision.score - a.decision.score;
    });
}
