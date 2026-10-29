/**
 * SOURCE AND INFORMATION BOUNDARY (2026-10-29, Prompt 2 Step 4).
 *
 * Server-side policy for WHAT Sophira may fetch and for how it answers
 * requests aimed at restricted material. Prompt text is not enforcement:
 * every function here is called by real code paths before any network
 * request is made.
 *
 * Design rules (deliberate, see docs/AI_CAPABILITY_IMPROVEMENT_AUDIT.md):
 *   1. A ".gov" suffix is NOT evidence of restriction and NOT evidence of
 *      quality. Public government publications are ordinary academic sources.
 *   2. Restriction is inferred from access-control signals (login gates,
 *      clearance markers, classified/restricted designators, .mil hosts),
 *      never from a domain suffix alone.
 *   3. When metadata is insufficient to tell public from restricted, the
 *      answer is "not allowed here" plus a permitted alternative - fail
 *      closed, never guess.
 *   4. SSRF protection is part of the same gate: loopback, private ranges,
 *      link-local and cloud metadata endpoints are never fetched, including
 *      after redirects.
 *
 * Limitation (documented, not hidden): this is a deterministic heuristic
 * layer. It cannot prove that a public-looking page is authorised material,
 * and it will not catch a restricted document hosted at an innocuous URL.
 * It reduces the chance of the obvious failure; it does not guarantee
 * compliance. Retrieval still requires the source to be cited and checked.
 */

export type SourceCategory =
  | "public-academic"
  | "restricted-signalled"
  | "internal-network"
  | "unsupported-scheme";

export interface SourceDecision {
  allowed: boolean;
  category: SourceCategory;
  /** Stable machine code for tests and diagnostics. */
  code: string;
  /** Plain-language explanation safe to show a student. */
  reason: string;
  /** Suggested lawful academic alternative when blocked. */
  alternative?: string;
}

const RESTRICTED_HOST_SUFFIXES = [".mil"];
const RESTRICTED_MARKERS = [
  "classified",
  "restricted",
  "confidential",
  "secret",
  "sensitive-but-unclassified",
  "cui",
  "no-foreign",
  "noforn",
  "sipr",
  "jwics",
  "clearance-required",
  "need-to-know",
];
const SSRF_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "0.0.0.0",
  "[::]",
  "::1",
  "[::1]",
]);

/** Loopback, private, link-local, and cloud-metadata destinations. */
export function isProhibitedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (SSRF_HOSTS.has(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return true;
  // IPv4 literal ranges (incl. alternate encodings resolved by the URL parser)
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }
  // IPv6: loopback, unique-local (fc00::/7), link-local (fe80::/10)
  if (h.includes(":")) {
    if (h === "::" || h === "::1") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true;
  }
  return false;
}

function hasRestrictedSignal(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (RESTRICTED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  const haystack = `${host}${url.pathname}${url.search}`.toLowerCase();
  return RESTRICTED_MARKERS.some((m) => haystack.includes(m));
}

/**
 * Decide whether Sophira may fetch this URL as an academic source.
 * Called before the first request AND after every redirect hop.
 */
export function evaluateSourceRequest(rawUrl: string): SourceDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      allowed: false,
      category: "unsupported-scheme",
      code: "invalid-url",
      reason: "That address is not a valid web link, so Sophira did not open it.",
      alternative: "Paste the full https:// address of a source you are allowed to use.",
    };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      allowed: false,
      category: "unsupported-scheme",
      code: "unsupported-scheme",
      reason: "Sophira only reads ordinary web pages over http(s).",
      alternative: "Use a public web page, or upload the document you are allowed to use.",
    };
  }
  if (isProhibitedHost(url.hostname)) {
    return {
      allowed: false,
      category: "internal-network",
      code: "prohibited-host",
      reason: "That address points at a private or internal network location, which Sophira never contacts.",
      alternative: "Use a public source, or upload the document you already have.",
    };
  }
  if (hasRestrictedSignal(url)) {
    return {
      allowed: false,
      category: "restricted-signalled",
      code: "restricted-source",
      reason:
        "That source looks like restricted or access-controlled government material. Sophira does not retrieve, request, or work around access controls for classified, controlled, or otherwise unauthorised material, and it will not try to get around a login or permission you do not have.",
      alternative:
        "Use a public government publication, an official summary, a declassified release, or an academic source on the same topic.",
    };
  }
  return {
    allowed: true,
    category: "public-academic",
    code: "allowed",
    reason: "Public web source; retrieval proceeds under the normal citation and verification rules.",
  };
}

export interface RequestDecision {
  blocked: boolean;
  code: string;
  message: string;
  alternative?: string;
}

/**
 * Detect a request whose PURPOSE is to obtain restricted material or to
 * bypass access control. Wording-based and deliberately conservative: it
 * only fires on explicit restricted-material intent, so ordinary questions
 * about public government policy are untouched.
 */
export function evaluateInformationRequest(text: string): RequestDecision {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return { blocked: false, code: "empty", message: "" };

  const bypassIntent =
    /\b(bypass|get around|circumvent|break into|get past)\b[^.?!]{0,40}\b(clearance|access control|login|password|permission|classification)\b/.test(t) ||
    /\b(leak|exfiltrate|dump)\b[^.?!]{0,30}\b(classified|restricted|secret)\b/.test(t);
  const restrictedIntent =
    /\b(classified|top secret|secret|restricted|confidential|controlled unclassified|cui|noforn|sipr|jwics)\b[^.?!]{0,40}\b(document|documents|report|reports|file|files|database|material|briefing|cable|cables)\b/.test(t) ||
    /\b(document|documents|report|file|database|material)\b[^.?!]{0,25}\b(classified|top secret|restricted|confidential)\b/.test(t);

  if (bypassIntent) {
    return {
      blocked: true,
      code: "bypass-attempt",
      message:
        "I can't help with getting around an access control or clearance, and I won't try to obtain restricted or classified material. That's outside what Sophira does.",
      alternative:
        "If your assignment allows it, I can work from public government publications, official summaries, declassified releases, or peer-reviewed sources on the same topic.",
    };
  }
  if (restrictedIntent) {
    return {
      blocked: true,
      code: "restricted-request",
      message:
        "Sophira is an academic assistant and doesn't retrieve classified, restricted, or access-controlled government information. I can't request it, look for it, or work around the permissions around it.",
      alternative:
        "I can help with publicly available government material, official reports and statistics, or academic literature about the same subject - which is usually what an assignment actually needs.",
    };
  }
  return { blocked: false, code: "allowed", message: "" };
}
