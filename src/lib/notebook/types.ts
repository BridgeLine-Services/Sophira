/**
 * Notebook workspace — shared types (2026-10-06).
 *
 * A notebook is a PRIVATE, ACADEMIC, SOURCE-GROUNDED research workspace.
 * It builds on the existing research engine (src/lib/research/*) and the
 * citation/claim/authority systems; it never replaces them.
 */

export type NotebookSourceType =
  | "pdf"
  | "docx"
  | "txt"
  | "web_url"
  | "image"
  | "teacher_instructions"
  | "assignment_instructions"
  | "user_notes"
  | "research_source";

export const SOURCE_TYPES: { value: NotebookSourceType; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "DOCX" },
  { value: "txt", label: "TXT" },
  { value: "web_url", label: "Web URL" },
  { value: "image", label: "Uploaded image" },
  { value: "teacher_instructions", label: "Teacher instructions" },
  { value: "assignment_instructions", label: "Assignment instructions" },
  { value: "user_notes", label: "User notes" },
  { value: "research_source", label: "Research source" },
];

export type ProcessingStatus = "pending" | "processing" | "ready" | "failed" | "empty";
export type VerificationStatus = "unverified" | "verified" | "partially_verified" | "failed" | "inaccessible";

/** Every answer statement is labeled exactly one of these. */
export type AnswerLabel = "SOURCE-SUPPORTED" | "INFERENCE" | "NOT VERIFIED";

/** Where in the source the cited passage lives — opens the exact location. */
export interface SourceLocator {
  /** page number (PDF where available) */
  page?: number;
  /** URL + retrieved timestamp (web pages) */
  url?: string;
  retrievedAt?: string;
  /** section + paragraph (DOCX where available) */
  section?: string;
  paragraph?: number;
  /** char offsets into the source's extracted_text (always available) */
  charsStart?: number;
  charsEnd?: number;
}

export interface NotebookSource {
  id: string;
  sourceId: string; // stable citation label: S1, S2, ...
  title: string;
  sourceType: NotebookSourceType;
  originalUrl: string;
  canonicalUrl: string;
  contentHash: string;
  uploadedAt: string;
  retrievedAt: string | null;
  extractedText: string;
  pageMetadata: { page: number; charsStart: number; charsEnd: number; label?: string }[];
  sectionMetadata: { section: string; paragraph: number; charsStart: number; charsEnd: number }[];
  processingStatus: ProcessingStatus;
  verificationStatus: VerificationStatus;
  included: boolean;
  pinned: boolean;
  authority: Record<string, unknown>;
  whySelected: {
    authority?: string;
    relevance?: string;
    date?: string | null;
    sourceType?: string;
    why?: string;
    requirementSatisfied?: string | null;
  };
}

export interface InlineCitation {
  marker: string; // e.g. "[S2 p.3]"
  sourceId: string;
  sourceLabel: string;
  label: AnswerLabel;
  locator: SourceLocator;
  quote?: string; // exact supporting passage (SOURCE-SUPPORTED only)
}

export interface GroundedStatement {
  text: string;
  label: AnswerLabel;
  citations: InlineCitation[];
  reason: string;
}

export interface GroundedAnswer {
  question: string;
  statements: GroundedStatement[];
  notes: string[];
  usedSources: string[]; // sourceLabels actually cited
  groundedIn: "notebook sources" | "notebook sources + web research";
  /** when web research was requested but a rule refused it, the honest reason */
  refusedWeb?: string;
}

export type ArtifactType =
  | "study_guide"
  | "quiz"
  | "flashcards"
  | "outline"
  | "briefing"
  | "evidence_table"
  | "research_plan"
  | "essay_plan"
  | "bibliography";

export const ARTIFACT_TYPES: { value: ArtifactType; label: string }[] = [
  { value: "study_guide", label: "Study Guide" },
  { value: "quiz", label: "Quiz" },
  { value: "flashcards", label: "Flashcards" },
  { value: "outline", label: "Outline" },
  { value: "briefing", label: "Briefing" },
  { value: "evidence_table", label: "Evidence Table" },
  { value: "research_plan", label: "Research Plan" },
  { value: "essay_plan", label: "Essay Plan" },
  { value: "bibliography", label: "Bibliography" },
];

export interface ArtifactSection {
  heading: string;
  items: string[];
  /** source labels this section draws from — provenance retained */
  sources: string[];
  citations: string[]; // formatted inline citation markers
}

export interface GeneratedArtifact {
  type: ArtifactType;
  title: string;
  sections: ArtifactSection[];
  /** per-source provenance summary — never empty for sourced artifacts */
  provenance: { sourceLabel: string; title: string; locator: string }[];
  honestNote: string;
}

/** "Research this topic" pipeline result. */
export interface ResearchCandidate {
  url: string;
  title: string;
  domain: string;
  published: string | null;
  retrieved: boolean; // URL actually fetched + verified
  deadUrl: boolean;
  contentChars: number;
  contentHash: string;
  extractedText: string;
  verificationStatus: VerificationStatus;
  authority: Record<string, unknown>;
  whySelected: NotebookSource["whySelected"];
  snippetOnly: boolean; // true when only a search snippet exists (NEVER stored as source content)
}
