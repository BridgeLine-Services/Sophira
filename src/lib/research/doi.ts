/**
 * DOI RESOLUTION AND METADATA VALIDATION (directive 2026-11-15, Part 6 items 1-5).
 *
 * Part 6 asks the citation gate to add: DOI resolution and metadata validation,
 * venue verification, author metadata verification, peer-review status where
 * verifiable, and retraction/correction checks. None of that existed: a DOI was
 * treated as a string that made a source "peer reviewed".
 *
 * That assumption is wrong in two directions. Many DOIs are preprints (bioRxiv,
 * medRxiv, SSRN, arXiv, Research Square) that are registered but never reviewed;
 * and a registered DOI can be retracted after publication. Both cases silently
 * passed the old check.
 *
 * WHAT THIS MODULE DOES NOT DO
 *  - It never decides that a work IS peer reviewed from a DOI prefix alone. Only the
 *    registration type plus a venue that is not a preprint server supports "reviewed",
 *    and anything else is reported as unconfirmed.
 *  - It never calls a retraction "clean" because nothing was found. `clean` requires a
 *    successful resolution whose record was actually inspected; a failed lookup is
 *    `unknown`, which is a different state.
 *  - It never invents metadata. Every field is either in the record or absent.
 *
 * The network call is injected (`DoiResolver`), so the parsing and the judgement are
 * tested offline and the live call has one place to add timeouts and caching.
 */

import type { PeerReviewStatus, PublicationState } from "./source-intelligence";

/* ------------------------------------------------------------------ */
/* DOI syntax                                                          */
/* ------------------------------------------------------------------ */

/** DOIs are 10.<registrant>/<suffix>; the suffix may contain almost any printable character. */
const DOI_PATTERN = /\b(10\.\d{4,9}\/[^\s"'<>]*[^\s"'<>.,;:)\]])/;

export function normalizeDoi(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  // Accept a resolver address as well as a bare DOI.
  value = value.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  value = value.replace(/^doi:\s*/i, "");
  value = value.replace(/[.,;:)\]]+$/, "");
  const match = DOI_PATTERN.exec(value);
  if (!match) return null;
  return match[1].toLowerCase();
}

export function isDoi(raw: string | null | undefined): boolean {
  return normalizeDoi(raw) !== null;
}

/** Pulls a DOI out of free text (an abstract, a page footer, a reference line). */
export function doiFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = DOI_PATTERN.exec(text);
  return match ? normalizeDoi(match[1]) : null;
}

/** Pulls a DOI out of any address, including a doi.org resolver link. */
export function doiFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return doiFromText(url);
}

/** Does this DOI belong to a preprint server? Registration is not review. */
const PREPRINT_REGISTRANTS: { prefix: string; server: string }[] = [
  { prefix: "10.1101", server: "bioRxiv or medRxiv" },
  { prefix: "10.48550", server: "arXiv" },
  { prefix: "10.2139", server: "SSRN" },
  { prefix: "10.31234", server: "PsyArXiv" },
  { prefix: "10.20944", server: "Preprints.org" },
  { prefix: "10.21203", server: "Research Square" },
];

export function preprintServerFor(doi: string | null): string | null {
  if (!doi) return null;
  const normalized = normalizeDoi(doi);
  if (!normalized) return null;
  for (const p of PREPRINT_REGISTRANTS) {
    if (normalized.startsWith(`${p.prefix}/`)) return p.server;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The record                                                         */
/* ------------------------------------------------------------------ */

export type DoiWorkType = "journal-article" | "posted-content" | "proceedings-article" | "book-chapter" | "book" | "dissertation" | "report" | "dataset" | "other";

export interface DoiAuthor {
  family: string | null;
  given: string | null;
  /** True when the record names an organisation rather than a person. */
  organisation: boolean;
}

export type DoiUpdateType = "retraction" | "correction" | "expression_of_concern" | "new_version" | "other";

export interface DoiUpdate {
  type: DoiUpdateType;
  doi: string | null;
  date: string | null;
  label: string | null;
}

export interface DoiRecord {
  doi: string;
  title: string;
  /** Year only: a full date is often absent and must not be invented. */
  year: number | null;
  publishedDate: string | null;
  authors: DoiAuthor[];
  venue: string | null;
  publisher: string | null;
  workType: DoiWorkType;
  /** The record's own URL, so a citation can point at the registration. */
  url: string | null;
  licence: string | null;
  updates: DoiUpdate[];
  /** True when the record declares a relation such as "is-retracted-by". */
  relatesRetraction: boolean;
  abstract: string | null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function parseDateParts(v: unknown): { iso: string | null; year: number | null } {
  const obj = v as { "date-parts"?: unknown } | null;
  const parts = asArray(obj?.["date-parts"])[0];
  if (!Array.isArray(parts) || parts.length === 0) return { iso: null, year: null };
  const year = typeof parts[0] === "number" ? parts[0] : null;
  const month = typeof parts[1] === "number" ? parts[1] : null;
  const day = typeof parts[2] === "number" ? parts[2] : null;
  if (year === null) return { iso: null, year: null };
  if (month === null) return { iso: `${year}`, year };
  if (day === null) return { iso: `${year}-${String(month).padStart(2, "0")}`, year };
  return { iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, year };
}

const UPDATE_TYPES: Record<string, DoiUpdateType> = {
  retraction: "retraction",
  correction: "correction",
  erratum: "correction",
  "expression_of_concern": "expression_of_concern",
  "new_version": "new_version",
};

/**
 * Parses a Crossref `work` message. Crossref is used because it is the DOI
 * registration agency's own metadata and needs no key - no vendor is contacted and the
 * registration record is the authority for the DOI itself.
 */
export function parseCrossrefWork(json: unknown): DoiRecord | null {
  const message = (json as { message?: unknown })?.message ?? json;
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;

  const doi = normalizeDoi(asString(m.DOI) ?? asString(m.doi));
  if (!doi) return null;

  const title = asString(asArray(m.title)[0]) ?? "(title not supplied by the record)";

  const published = parseDateParts(m["published-print"] ?? m["published-online"] ?? m.published ?? m.issued);
  const created = parseDateParts(m.created);

  const authors: DoiAuthor[] = asArray(m.author).map((a) => {
    const author = a as Record<string, unknown>;
    const family = asString(author.family);
    const given = asString(author.given);
    const org = asString(author.name);
    return {
      family: family ?? org,
      given,
      organisation: Boolean(org && !family),
    };
  });

  const workTypeRaw = (asString(m.type) ?? "other").toLowerCase();
  const workType: DoiWorkType = (
    ["journal-article", "posted-content", "proceedings-article", "book-chapter", "book", "dissertation", "report", "dataset"] as DoiWorkType[]
  ).includes(workTypeRaw as DoiWorkType)
    ? (workTypeRaw as DoiWorkType)
    : "other";

  const updates: DoiUpdate[] = asArray(m["update-to"]).map((u) => {
    const update = u as Record<string, unknown>;
    const typeRaw = (asString(update.type) ?? "other").toLowerCase();
    const date = parseDateParts(update.updated ?? update.created).iso;
    return {
      type: UPDATE_TYPES[typeRaw] ?? "other",
      doi: normalizeDoi(asString(update.DOI)),
      date,
      label: asString(update.label),
    };
  });

  const relations = (m.relation ?? {}) as Record<string, unknown>;
  const relatesRetraction = Object.keys(relations).some((key) => /retract/i.test(key));

  const licence = asArray(m.license)
    .map((l) => asString((l as Record<string, unknown>)["URL"]))
    .filter((l): l is string => Boolean(l))[0] ?? null;

  return {
    doi,
    title,
    year: published.year ?? created.year,
    publishedDate: published.iso ?? created.iso,
    authors,
    venue: asString(asArray(m["container-title"])[0]) ?? null,
    publisher: asString(m.publisher),
    workType,
    url: asString(m.URL) ?? `https://doi.org/${doi}`,
    licence,
    updates,
    relatesRetraction,
    abstract: asString(m.abstract),
  };
}

/* ------------------------------------------------------------------ */
/* Judgement                                                          */
/* ------------------------------------------------------------------ */

export interface DoiAssessment {
  doi: string;
  peerReview: PeerReviewStatus;
  publicationState: PublicationState;
  /** Plain-English sentences for a student. */
  notes: string[];
  /** What still cannot be established. */
  uncertainty: string;
  /** May this be cited as reviewed research? */
  citableAsReviewed: boolean;
  /** May this be used at all? */
  usable: boolean;
  record: DoiRecord | null;
}

/**
 * Turns a registration record into the two things a citation actually needs: was this
 * reviewed, and is it still standing.
 */
export function assessDoiRecord(record: DoiRecord | null, doi: string): DoiAssessment {
  const notes: string[] = [];
  const uncertaintyParts: string[] = [];

  if (!record) {
    return {
      doi,
      peerReview: "unknown",
      publicationState: "unknown",
      notes: ["The DOI did not resolve to a registration record, so nothing about this work is confirmed."],
      uncertainty: "A DOI that does not resolve is not evidence of anything, and it must not be cited as verified.",
      citableAsReviewed: false,
      usable: false,
      record: null,
    };
  }

  const server = preprintServerFor(record.doi);
  let peerReview: PeerReviewStatus;

  if (server) {
    peerReview = "preprint";
    notes.push(
      `This DOI belongs to a preprint server (${server}): the work is publicly available but has not been reviewed by other specialists.`,
    );
  } else if (record.workType === "posted-content") {
    peerReview = "preprint";
    notes.push("The registration says this is posted content rather than a published article, so it is a preprint.");
  } else if (record.workType === "dataset") {
    peerReview = "not_research";
    notes.push("This DOI identifies a dataset, not an article.");
  } else if (record.workType === "journal-article" || record.workType === "proceedings-article") {
    peerReview = "research_unconfirmed";
    notes.push(
      "The registration says this is a journal article, but registration does not record whether the journal reviews its articles, so review status stays unconfirmed.",
    );
    uncertaintyParts.push("Peer review is not recorded in the DOI registration, so it cannot be confirmed from this source alone.");
  } else {
    peerReview = "unknown";
    uncertaintyParts.push("The registration does not say what kind of work this is.");
  }

  let publicationState: PublicationState = "clean";
  const retraction = record.updates.find((u) => u.type === "retraction");
  const concern = record.updates.find((u) => u.type === "expression_of_concern");
  const correction = record.updates.find((u) => u.type === "correction");

  if (retraction || record.relatesRetraction) {
    publicationState = "retracted";
    notes.push(
      `The registration records a retraction${retraction?.date ? ` dated ${retraction.date}` : ""}. The findings must not be used.`,
    );
  } else if (concern) {
    publicationState = "expression_of_concern";
    notes.push("The publisher has recorded a concern about this work.");
  } else if (correction) {
    publicationState = "corrected";
    notes.push(`The work has a published correction${correction.date ? ` dated ${correction.date}` : ""}. Cite the corrected version.`);
  } else {
    notes.push("The registration record carries no retraction, correction or concern, and it was resolved successfully.");
  }

  if (record.authors.length === 0) {
    uncertaintyParts.push("The record names no authors, so an author-format citation cannot be completed from it.");
  }
  if (!record.venue) {
    uncertaintyParts.push("The record names no publication venue, so the venue cannot be verified from it.");
  }

  const usable = publicationState !== "retracted";

  return {
    doi: record.doi,
    peerReview,
    publicationState,
    notes,
    uncertainty: uncertaintyParts.length ? uncertaintyParts.join(" ") : "Nothing further is uncertain about this registration.",
    citableAsReviewed: peerReview === "research_unconfirmed" && Boolean(record.venue) && usable,
    usable,
    record,
  };
}

/* ------------------------------------------------------------------ */
/* Resolution (injected, so the judgement is testable offline)         */
/* ------------------------------------------------------------------ */

export interface DoiResolver {
  /** Returns the Crossref-shaped JSON, or null when the DOI is not registered. */
  fetchWork(doi: string): Promise<unknown | null>;
}

export type DoiResolutionState = "resolved" | "not_registered" | "invalid" | "unavailable";

export interface DoiResolution {
  state: DoiResolutionState;
  assessment: DoiAssessment | null;
  /** Plain language for the student; never a vendor name or a status code. */
  message: string;
}

export const DOI_MESSAGES = {
  invalid: "That does not look like a publication identifier, so Sophira did not look it up.",
  notRegistered:
    "That publication identifier is not registered, so the citation cannot be confirmed. Check it against the article itself.",
  unavailable:
    "Sophira could not reach the registration service just now, so this citation is unconfirmed rather than verified. Nothing was invented.",
} as const;

/**
 * Resolves one DOI and judges it. A failure of the resolution service is reported as
 * `unavailable` and NEVER as "not registered" or "verified" - the three are different.
 */
export async function resolveDoi(rawDoi: string, resolver: DoiResolver): Promise<DoiResolution> {
  const doi = normalizeDoi(rawDoi);
  if (!doi) {
    return { state: "invalid", assessment: null, message: DOI_MESSAGES.invalid };
  }
  let json: unknown | null;
  try {
    json = await resolver.fetchWork(doi);
  } catch {
    return { state: "unavailable", assessment: null, message: DOI_MESSAGES.unavailable };
  }
  if (json === null || json === undefined) {
    return { state: "not_registered", assessment: null, message: DOI_MESSAGES.notRegistered };
  }
  const record = parseCrossrefWork(json);
  if (!record) {
    return { state: "not_registered", assessment: null, message: DOI_MESSAGES.notRegistered };
  }
  return { state: "resolved", assessment: assessDoiRecord(record, record.doi), message: "" };
}

/** Live resolver. Crossref is the DOI registration agency's own metadata and needs no key. */
export const crossrefResolver: DoiResolver = {
  async fetchWork(doi: string) {
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Sophira/1.0 (academic citation check)" },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Crossref responded ${res.status}`);
    return (await res.json()) as unknown;
  },
};
