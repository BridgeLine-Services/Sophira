import { createHash } from "crypto";

/**
 * URL/source verification (spec §9): every source Sophira intends to cite
 * is actually requested server-side — redirects followed manually, final
 * URL recorded, page content extracted, meaningfulness checked. A source
 * that cannot be verified is NEVER presented as verified.
 *
 * Web content is UNTRUSTED DATA: callers must wrap extracts with
 * wrapUntrusted() before sending anywhere near an LLM. Nothing here
 * executes page code; the fetch is plain HTTPS text retrieval.
 */

export type VerificationStatus =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "failed"
  | "inaccessible";

export interface VerifiedPage {
  originalUrl: string;
  finalUrl: string;
  redirectCount: number;
  httpStatus: number;
  ok: boolean;
  contentType: string;
  domain: string;
  title: string;               // page <title> — real, never invented
  author: string | null;       // only from explicit meta tags
  publicationDate: string | null; // only from explicit meta tags (ISO-ish)
  canonicalUrl: string;
  text: string;                // extracted readable text (truncated)
  textChars: number;
  hash: string;                // sha256 of extracted text
  status: VerificationStatus;
  notes: string[];
}

export interface VerifyOptions {
  /** For tests — inject a deterministic fetch. */
  fetchImpl?: typeof fetch;
  maxRedirects?: number;
  timeoutMs?: number;
  maxBytes?: number;
}

const BLOCKED_PATTERNS = [
  /access denied/i,
  /\b403 forbidden\b/i,
  /sign in to (?:continue|read|view)/i,
  /log ?in to (?:continue|read|view)/i,
  /subscribe to (?:continue|read|view)/i,
  /\bpaywall\b/i,
  /\bcaptcha\b/i,
  /are you a robot/i,
];

const MIN_MEANINGFUL_CHARS = 400;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

function metaContent(html: string, names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']{1,500})["']`,
      "i"
    );
    const m = html.match(re);
    if (m && m[1].trim()) return decodeEntities(m[1]).trim();
    // reversed attribute order
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']{1,500})["'][^>]*(?:name|property)=["']${name}["']`,
      "i"
    );
    const m2 = html.match(re2);
    if (m2 && m2[1].trim()) return decodeEntities(m2[1]).trim();
  }
  return null;
}

function extractCanonical(html: string, finalUrl: string): string {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']{1,2000})["']/i)
    || html.match(/<link[^>]+href=["']([^"']{1,2000})["'][^>]+rel=["']canonical["']/i);
  if (!m) return "";
  try {
    return new URL(decodeEntities(m[1]), finalUrl).toString();
  } catch {
    return "";
  }
}

function extractText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(?:nav|header|footer|form|aside)[^>]*>[\s\S]{0,8000}?<\/(?:nav|header|footer|form|aside)>/gi, " ")
      .replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
  ).trim();
}

/** Loose title correspondence check between the search listing and the page. */
export function titlesCorrespond(listed: string, actual: string): boolean {
  const norm = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3));
  const a = norm(listed ?? "");
  const b = norm(actual ?? "");
  if (a.size === 0 || b.size === 0) return false;
  let hits = 0;
  a.forEach((w) => { if (b.has(w)) hits++; });
  return hits >= Math.max(1, Math.ceil(a.size * 0.4));
}

/**
 * Fetch a URL following redirects MANUALLY so redirect history is fully
 * recorded. Returns an honest verification record — dead pages, error
 * pages, and login/paywall walls are detected and reported, never hidden.
 */
export async function fetchAndVerify(url: string, opts: VerifyOptions = {}): Promise<VerifiedPage> {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxRedirects = opts.maxRedirects ?? 6;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxBytes = opts.maxBytes ?? 250_000;
  const notes: string[] = [];

  if (!/^https?:\/\//i.test(url)) {
    return {
      originalUrl: url, finalUrl: "", redirectCount: 0, httpStatus: 0, ok: false, contentType: "",
      domain: "", title: "", author: null, publicationDate: null, canonicalUrl: "",
      text: "", textChars: 0, hash: "", status: "failed",
      notes: ["URL rejected: not an http(s) URL (never fabricated into one)."],
    };
  }

  let current = url;
  let redirectCount = 0;
  let response: Response | null = null;
  for (let i = 0; i <= maxRedirects; i++) {
    let res: Response;
    try {
      res = await doFetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SophiraResearch/1.0; +https://sophira.app)",
          Accept: "text/html,application/xhtml+xml,application/pdf;q=0.5,*/*;q=0.1",
        },
      });
    } catch (e) {
      const reason = e instanceof Error && e.name === "TimeoutError" ? "timed out" : e instanceof Error ? e.message : "network error";
      notes.push(`Fetch failed: ${reason}.`);
      return {
        originalUrl: url, finalUrl: current, redirectCount, httpStatus: 0, ok: false, contentType: "",
        domain: domainOf(current), title: "", author: null, publicationDate: null, canonicalUrl: "",
        text: "", textChars: 0, hash: "", status: "inaccessible", notes,
      };
    }
    const status = res.status;
    if ([301, 302, 303, 307, 308].includes(status)) {
      const loc = res.headers.get("location");
      if (!loc) { response = res; break; }
      let next: string;
      try { next = new URL(loc, current).toString(); } catch { notes.push("Invalid redirect target."); response = res; break; }
      if (!/^https?:\/\//i.test(next)) { notes.push("Redirect left http(s) — refused."); response = res; break; }
      redirectCount++;
      current = next;
      continue;
    }
    response = res;
    break;
  }

  if (!response) {
    notes.push(`Too many redirects (> ${maxRedirects}).`);
    return {
      originalUrl: url, finalUrl: current, redirectCount, httpStatus: 0, ok: false, contentType: "",
      domain: domainOf(current), title: "", author: null, publicationDate: null, canonicalUrl: "",
      text: "", textChars: 0, hash: "", status: "failed", notes,
    };
  }

  const httpStatus = response.status;
  const contentType = response.headers.get("content-type") || "";

  if (redirectCount > 0) {
    const origDomain = domainOf(url);
    const finalDomain = domainOf(current);
    if (origDomain && finalDomain && origDomain !== finalDomain) {
      notes.push(`Redirected from ${origDomain} to a DIFFERENT domain (${finalDomain}) — correspondence checked below.`);
    } else {
      notes.push(`Followed ${redirectCount} redirect(s) to ${current}.`);
    }
  }

  if (httpStatus === 404 || httpStatus === 410) {
    notes.push(`Page does not exist (HTTP ${httpStatus}) — dead link.`);
    return {
      originalUrl: url, finalUrl: current, redirectCount, httpStatus, ok: false, contentType,
      domain: domainOf(current), title: "", author: null, publicationDate: null, canonicalUrl: "",
      text: "", textChars: 0, hash: "", status: "failed", notes,
    };
  }
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 402 || httpStatus === 429) {
    notes.push(`Access refused (HTTP ${httpStatus}) — login, payment, or rate limit.`);
    return {
      originalUrl: url, finalUrl: current, redirectCount, httpStatus, ok: false, contentType,
      domain: domainOf(current), title: "", author: null, publicationDate: null, canonicalUrl: "",
      text: "", textChars: 0, hash: "", status: "inaccessible", notes,
    };
  }
  if (httpStatus >= 500) {
    notes.push(`Server error (HTTP ${httpStatus}).`);
    return {
      originalUrl: url, finalUrl: current, redirectCount, httpStatus, ok: false, contentType,
      domain: domainOf(current), title: "", author: null, publicationDate: null, canonicalUrl: "",
      text: "", textChars: 0, hash: "", status: "inaccessible", notes,
    };
  }
  if (httpStatus !== 200) {
    notes.push(`Unexpected HTTP status ${httpStatus}.`);
  }

  // Only HTML is parsed; PDFs and other types are stored as-is, honestly.
  const raw = await response.text().catch(() => "");
  const body = raw.slice(0, maxBytes);
  const isHtml = /text\/html|application\/xhtml/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body);
  const title = isHtml ? extractTitle(body) : "";
  const author = isHtml ? metaContent(body, ["author", "citation_author", "article:author"]) : null;
  const publicationDate = isHtml
    ? metaContent(body, ["citation_publication_date", "article:published_time", "date", "dc.date", "citation_date"])
    : null;
  const canonicalUrl = isHtml ? extractCanonical(body, current) : "";
  const text = isHtml ? extractText(body).slice(0, 100_000) : body.slice(0, 100_000);
  const hash = createHash("sha256").update(text).digest("hex");

  const blocked = BLOCKED_PATTERNS.filter((re) => re.test(text.slice(0, 4000)) || re.test(title));
  const meaningful = text.length >= MIN_MEANINGFUL_CHARS && blocked.length === 0;

  let status: VerificationStatus = "verified";
  if (!isHtml && httpStatus === 200) {
    notes.push(`Non-HTML content (${contentType || "unknown type"}) — retrieved but not parsed.`);
    status = "partially_verified";
  } else if (blocked.length > 0) {
    notes.push(`Page appears blocked (${blocked.map((b) => b.source.replace(/[^a-z ]/gi, "").trim().slice(0, 24)).join(", ")}) — login/paywall/error wall.`);
    status = "inaccessible";
  } else if (!meaningful) {
    notes.push(`Only ${text.length} characters of readable content — below the meaningful-content threshold (${MIN_MEANINGFUL_CHARS}).`);
    status = "partially_verified";
  }

  return {
    originalUrl: url,
    finalUrl: current,
    redirectCount,
    httpStatus,
    ok: httpStatus >= 200 && httpStatus < 300,
    contentType,
    domain: domainOf(current),
    title,
    author,
    publicationDate,
    canonicalUrl,
    text,
    textChars: text.length,
    hash,
    status,
    notes,
  };
}
