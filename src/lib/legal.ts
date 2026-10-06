import { readFileSync } from "fs";
import path from "path";

/**
 * Legal document loader (legal-infrastructure round): the in-app legal
 * pages render the ACTUAL repository documents — LICENSE, docs/legal/
 * TERMS_OF_SERVICE.md and docs/legal/PRIVACY_POLICY.md — as their single
 * source of truth. Nothing is duplicated, paraphrased, or invented here.
 *
 * If a document cannot be read (e.g. the file is not present in the
 * deployment bundle), the pages fail HONESTLY with an unavailable notice —
 * they never substitute placeholder or fabricated legal text.
 */

export type LegalDocName = "LICENSE" | "TERMS_OF_SERVICE" | "PRIVACY_POLICY";

const DOC_PATHS: Record<LegalDocName, string> = {
  LICENSE: "LICENSE",
  TERMS_OF_SERVICE: "docs/legal/TERMS_OF_SERVICE.md",
  PRIVACY_POLICY: "docs/legal/PRIVACY_POLICY.md",
};

export const DOC_TITLES: Record<LegalDocName, string> = {
  LICENSE: "Software License",
  TERMS_OF_SERVICE: "Terms of Service",
  PRIVACY_POLICY: "Privacy Policy",
};

/**
 * True while the documents are still owner-fact templates (any of the
 * catalogued placeholders from docs/legal/LEGAL_CONFIGURATION.md remain).
 * The in-app pages show an honest TEMPLATE banner while this is true.
 */
export function legalPlaceholdersRemain(text: string): boolean {
  return /\[(?:LEGAL ENTITY NAME|COPYRIGHT HOLDER LEGAL NAME|ADDRESS|CONTACT EMAIL|LEGAL CONTACT[^[\]]*|EFFECTIVE DATE(?: YEAR)?|JURISDICTION|MAXIMUM LIABILITY[^[\]]*|DISPUTE RESOLUTION[^[\]]*|APPLICABLE RULES|RETENTION PERIOD)\]/.test(
    text
  );
}

/** Read the real document, or null when the file is unavailable. */
export function loadLegalDoc(name: LegalDocName): string | null {
  try {
    const rel = DOC_PATHS[name];
    // Standalone Next server (node .next/standalone) keeps the repo root at
    // process.cwd(); serverless bundles rely on outputFileTracingIncludes.
    for (const base of [process.cwd(), path.join(process.cwd(), "..")]) {
      try {
        const full = path.join(base, rel);
        const text = readFileSync(full, "utf8");
        if (text.trim().length > 0) return text;
      } catch {
        // try next base
      }
    }
    return null;
  } catch {
    return null;
  }
}
