/**
 * Notebook workspace — source ingestion (2026-10-06).
 *
 * Converts every supported source type into the common NotebookSource
 * shape: extracted text + page metadata (PDF) or section metadata (DOCX)
 * where available, a content hash, and honest processing statuses.
 * Reuses the existing extract pipeline (mammoth, pdf-parse) and the
 * research engine's fetchAndVerify for web URLs.
 */

import { createHash } from "crypto";
import type { NotebookSource, NotebookSourceType, ProcessingStatus, VerificationStatus } from "./types";

export interface IngestResult {
  title: string;
  sourceType: NotebookSourceType;
  originalUrl: string;
  canonicalUrl: string;
  contentHash: string;
  retrievedAt: string | null;
  extractedText: string;
  pageMetadata: NotebookSource["pageMetadata"];
  sectionMetadata: NotebookSource["sectionMetadata"];
  processingStatus: ProcessingStatus;
  verificationStatus: VerificationStatus;
  notes: string[];
}

export function hashContent(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** TXT / pasted teacher instructions / assignment instructions / user notes. */
export function ingestText(title: string, text: string, sourceType: NotebookSourceType): IngestResult {
  const extracted = text.trim();
  return {
    title,
    sourceType,
    originalUrl: "",
    canonicalUrl: "",
    contentHash: hashContent(extracted),
    retrievedAt: null,
    extractedText: extracted,
    pageMetadata: [],
    sectionMetadata: [],
    processingStatus: extracted ? "ready" : "empty",
    verificationStatus: "unverified",
    notes: extracted ? [] : ["no text content provided — stored honestly as empty"],
  };
}

/** PDF: page metadata from pdf-parse's per-page text. */
export interface PdfPages {
  text: string;
  numpages: number;
  pages?: string[];
}

export function ingestPdf(title: string, pdf: PdfPages): IngestResult {
  const pages = pdf.pages && pdf.pages.length > 0 ? pdf.pages : [];
  const pageMetadata: NotebookSource["pageMetadata"] = [];
  let full = "";
  if (pages.length > 0) {
    pages.forEach((p, i) => {
      const start = full.length;
      full += (i > 0 ? "\n\n" : "") + p.trim();
      pageMetadata.push({ page: i + 1, charsStart: start, charsEnd: full.length, label: `p.${i + 1}` });
    });
  } else {
    full = (pdf.text ?? "").trim();
  }
  return {
    title,
    sourceType: "pdf",
    originalUrl: "",
    canonicalUrl: "",
    contentHash: hashContent(full),
    retrievedAt: null,
    extractedText: full,
    pageMetadata,
    sectionMetadata: [],
    processingStatus: full ? "ready" : "empty",
    verificationStatus: "unverified",
    notes: pages.length > 0 ? [`${pages.length} page(s) extracted with per-page locators`] : ["page-level metadata unavailable — citations fall back to char offsets"],
  };
}

/** DOCX: section/paragraph metadata where the structure exposes it. */
export function ingestDocx(title: string, text: string): IngestResult {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const sectionMetadata: NotebookSource["sectionMetadata"] = [];
  let full = "";
  blocks.forEach((b, i) => {
    const start = full.length;
    full += (i > 0 ? "\n\n" : "") + b;
    const headingMatch = b.match(/^(#{1,4}\s+.+|[A-Z][A-Za-z0-9 ,'&()\-]{2,60}:|[A-Z][a-z]{2,20})$/);
    sectionMetadata.push({
      section: headingMatch ? headingMatch[1].replace(/^#+\s*/, "").replace(/:$/, "") : "body",
      paragraph: i + 1,
      charsStart: start,
      charsEnd: full.length,
    });
  });
  return {
    title,
    sourceType: "docx",
    originalUrl: "",
    canonicalUrl: "",
    contentHash: hashContent(text),
    retrievedAt: null,
    extractedText: text.trim(),
    pageMetadata: [],
    sectionMetadata,
    processingStatus: text.trim() ? "ready" : "empty",
    verificationStatus: "unverified",
    notes: sectionMetadata.length > 0 ? [`${sectionMetadata.length} block(s) with section/paragraph locators`] : [],
  };
}

/** Uploaded image: extracted text requires OCR upstream; stored honestly when absent. */
export function ingestImage(title: string, ocrText: string | null): IngestResult {
  const extracted = (ocrText ?? "").trim();
  return {
    title,
    sourceType: "image",
    originalUrl: "",
    canonicalUrl: "",
    contentHash: hashContent(extracted),
    retrievedAt: null,
    extractedText: extracted,
    pageMetadata: [],
    sectionMetadata: [],
    processingStatus: extracted ? "ready" : "empty",
    verificationStatus: extracted ? "unverified" : "failed",
    notes: extracted ? ["OCR text stored"] : ["no OCR text available — image stored without readable content; it cannot be cited"],
  };
}

export interface WebIngest {
  title: string;
  canonicalUrl: string;
  finalUrl: string;
  contentHash: string;
  retrievedAt: string;
  extractedText: string;
  verificationStatus: VerificationStatus;
  notes: string[];
}

/** Web URL: MUST come from a real fetchAndVerify — never a raw snippet. */
export function ingestWeb(page: WebIngest): IngestResult {
  return {
    title: page.title,
    sourceType: "web_url",
    originalUrl: page.finalUrl,
    canonicalUrl: page.canonicalUrl,
    contentHash: page.contentHash,
    retrievedAt: page.retrievedAt,
    extractedText: page.extractedText,
    pageMetadata: [],
    sectionMetadata: [],
    processingStatus: page.extractedText ? "ready" : "empty",
    verificationStatus: page.verificationStatus,
    notes: page.notes,
  };
}
