import { DOC_TITLES, legalPlaceholdersRemain, loadLegalDoc, type LegalDocName } from "../../lib/legal";
import { ResultBody } from "./ResultBody";

/**
 * Shared renderer for the in-app legal pages. Renders the REAL repository
 * document (never a copy) with an honest banner while owner-fact
 * placeholders remain (docs/legal/LEGAL_CONFIGURATION.md). No fabricated
 * legal identity is ever shown — the placeholders themselves are displayed.
 */
export function LegalDocPage({ doc }: { doc: LegalDocName }) {
  const text = loadLegalDoc(doc);
  const title = DOC_TITLES[doc];

  if (text === null) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-ink">
          This document is not available in the current deployment bundle. It is
          not substituted with placeholder text. The source document lives in
          the Sophira repository
          {doc === "LICENSE" ? " (LICENSE)" : ` (docs/legal/${doc}.md)`} — report
          this so the deployment can be fixed.
        </p>
      </main>
    );
  }

  const hasPlaceholders = legalPlaceholdersRemain(text);

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-bold text-ink">{title}</h1>

      {hasPlaceholders && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-ink">
          <p className="font-semibold">TEMPLATE — PLACEHOLDER NOTICE</p>
          <p className="mt-1">
            This document is a template with unresolved owner-fact placeholders
            (shown in brackets, e.g. [LEGAL ENTITY NAME]). It has not been
            reviewed by an attorney and must not be relied on as legal advice
            until the owner supplies the real values and it is reviewed by a
            qualified attorney. See docs/legal/LEGAL_CONFIGURATION.md.
          </p>
        </div>
      )}

      <div className="result-body mt-6 text-ink">
        <ResultBody content={text} />
      </div>
    </main>
  );
}
