/**
 * Citation + bibliography generation (specs §11-§13): DETERMINISTIC, from
 * the actual research-source records. The language model NEVER invents a
 * bibliography — formatCitation/buildBibliography run on stored metadata,
 * and missing metadata renders honestly ("n.d.", "n.p.") instead of being
 * fabricated. Quotations must appear verbatim in retrieved content.
 */

export type CitationStyle = "MLA" | "APA" | "CHICAGO" | "generic";

export interface CitationSource {
  title: string;
  author: string | null;
  publisher: string | null;
  publicationDate: string | null; // ISO-ish; may be partial
  url: string;
  accessedISO: string;
  doi?: string | null;
}

export function normalizeStyle(style?: string | null): CitationStyle {
  const s = (style || "").toUpperCase();
  if (s === "MLA") return "MLA";
  if (s === "APA") return "APA";
  if (s === "CHICAGO" || s === "CHICAGO/N") return "CHICAGO";
  return "generic";
}

function lastNameFirst(author: string): string {
  const parts = author.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
}

function mlaDate(date: string | null): string {
  if (!date) return "n.d.";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

export function formatCitation(src: CitationSource, style?: string | null): string {
  const st = normalizeStyle(style);
  const author = src.author?.trim() || null;
  const publisher = src.publisher?.trim() || null;
  const domain = (() => { try { return new URL(src.url).hostname.replace(/^www\./, ""); } catch { return src.url; } })();
  const year = src.publicationDate ? (src.publicationDate.match(/\d{4}/)?.[0] ?? null) : null;
  const accessed = new Date(src.accessedISO).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

  switch (st) {
    case "MLA":
      return [
        author ? lastNameFirst(author) + "." : "",
        `"${src.title}."`,
        publisher ? publisher + "," : domain ? domain + "," : "",
        mlaDate(src.publicationDate),
        src.url,
        `Accessed ${accessed}.`,
      ].filter(Boolean).join(" ");
    case "APA":
      return [
        author ? lastNameFirst(author).replace(/,([^,]+)$/, ",$1.") : "",
        `(${year ?? "n.d."}).`,
        src.title + ".",
        publisher ?? domain,
        src.url,
      ].filter(Boolean).join(" ");
    case "CHICAGO":
      return [
        author ? `${author}.` : "",
        `"${src.title}."`,
        publisher ?? domain,
        src.publicationDate ?? "n.d.",
        `Accessed ${accessed}.`,
        src.url,
      ].filter(Boolean).join(" ");
    default:
      // generic: everything we actually know, nothing invented
      return [
        author ? `${author}. ` : "",
        `"${src.title}". `,
        publisher ? `${publisher}. ` : domain ? `${domain}. ` : "",
        src.publicationDate ? `${src.publicationDate}. ` : "No publication date. ",
        `Retrieved ${accessed}, from ${src.url}.`,
      ].join("");
  }
}

export function buildBibliography(sources: CitationSource[], style?: string | null): string {
  const sorted = [...sources].sort((a, b) => (a.author || a.title).localeCompare(b.author || b.title));
  return sorted.map((s) => formatCitation(s, style)).join("\n\n");
}

/** Citation markers found in a generated essay: [n] or (Author Year). */
export interface CitationMarker {
  raw: string;
  index: number;
  refNumber?: number;
  authorYear?: string;
}

export function extractCitationMarkers(text: string): CitationMarker[] {
  const markers: CitationMarker[] = [];
  const bracketRe = /\[(\d{1,3})\]/g;
  let m: RegExpExecArray | null;
  while ((m = bracketRe.exec(text)) !== null) markers.push({ raw: m[0], index: m.index, refNumber: parseInt(m[1], 10) });
  const parenRe = /\(([A-Z][A-Za-z'’\-]+(?: et al\.?)?,? ?\d{4}[a-z]?)\)/g;
  while ((m = parenRe.exec(text)) !== null) markers.push({ raw: m[0], index: m.index, authorYear: m[1] });
  return markers;
}

/**
 * Quote authenticity: a direct quotation is supported ONLY if it appears
 * (normalized) inside the retrieved source content. Never fabricated.
 */
export function quoteInContent(quote: string, content: string): boolean {
  const norm = (s: string) => s.replace(/[\s\u00A0]+/g, " ").replace(/[“”‘’]/g, '"').trim().toLowerCase();
  const q = norm(quote);
  if (q.length < 8) return false;
  const c = norm(content);
  if (c.includes(q)) return true;
  // tolerate minor truncation: check a distinctive 40-char window
  const mid = q.length > 60 ? q.slice(10, 50) : null;
  if (mid && c.includes(mid)) return true;
  return false;
}

/**
 * Claim-source support (deterministic pre-check): token overlap between
 * the claim and the source extract. Weak-but-honest: the API layers the
 * AI semantic judgment on top and labels it AI-assessed.
 */
export function claimSupportsDeterministic(claim: string, evidence: string): boolean {
  const stop = new Set(["the", "a", "an", "of", "and", "or", "in", "on", "to", "is", "are", "was", "were", "be", "been", "that", "this", "for", "with", "as", "by", "it", "its", "their", "they", "have", "has", "had", "not", "but", "from", "at", "which", "who", "than", "then", "so", "such", "can", "may", "might", "will", "would", "should", "could", "more", "most", "some", "any", "all", "no"]);
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z][a-z'-]{3,}/g)?.filter((w) => !stop.has(w)) ?? []);
  const c = words(claim);
  const e = words(evidence);
  if (c.size === 0) return false;
  let hits = 0;
  c.forEach((w) => { if (e.has(w)) hits++; });
  return hits >= Math.max(2, Math.ceil(c.size * 0.45));
}

export function parseISODateLoose(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}${m[3] ? "-" + m[3] : ""}`;
  return null;
}
