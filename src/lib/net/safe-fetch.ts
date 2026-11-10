/**
 * SSRF-SAFE OUTBOUND FETCH (2026-11-09).
 *
 * WHY THIS EXISTS
 * ---------------
 * `fetchAndVerify` used to call the global `fetch` after a string-level policy
 * check (`evaluateSourceRequest`). That check inspects the URL's hostname, so:
 *
 *   - a public hostname that RESOLVES to 127.0.0.1 or 169.254.169.254 passed;
 *   - a resolver that answers differently on the second lookup (DNS rebinding)
 *     passed, because the address the socket used was never the one checked;
 *   - alternate numeric spellings (http://2130706433/, http://0177.0.0.1/)
 *     and IPv4-mapped IPv6 (::ffff:127.0.0.1) were treated as ordinary text;
 *   - a static analyser has no way to know the string check constrains the
 *     socket, so the request stayed an unproven SSRF sink.
 *
 * THE FIX
 * -------
 * Validation and connection are the same decision:
 *
 *   1. Parse the URL with the WHATWG URL parser (no regex guessing).
 *   2. Reject non-http(s) schemes, embedded credentials, and any port other
 *      than the scheme's default (80/443) or the configured allow-list.
 *   3. Resolve the hostname ourselves. If ANY answer is non-public, the
 *      request is refused — a split-horizon answer is not a coin flip.
 *   4. Classify every address as public/not, covering IPv4, IPv6, IPv4-mapped
 *      IPv6, and the alternate numeric spellings a parser will happily accept.
 *   5. Open the socket to THE VALIDATED ADDRESS (the `lookup` hook returns the
 *      pinned IP), while the Host header and TLS SNI/verification still use the
 *      real hostname. Certificate validation is therefore unchanged, and a
 *      rebinding resolver cannot redirect the connection it already answered.
 *   6. Re-validate and re-pin EVERY redirect hop. A hop may not weaken the
 *      original policy, and http → https or https → http is recorded.
 *
 * Nothing here executes page content, and no result is ever synthesised: a
 * refused request produces an explicit refusal code and plain-English reason.
 */

import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export type AddressFamily = 4 | 6;

export interface ResolvedHost {
  address: string;
  family: AddressFamily;
}

/** Injected for deterministic tests: no socket, no resolver, no network. */
export interface SafeFetchDeps {
  /** Must return every address the hostname resolves to. */
  resolve?: (hostname: string) => Promise<ResolvedHost[]>;
  /** Must perform one request to exactly the address given. */
  request?: (req: PinnedRequest) => Promise<PinnedResponse>;
}

export interface PinnedRequest {
  url: URL;
  /** The address the socket must connect to (already validated). */
  address: ResolvedHost;
  method: "GET";
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
}

export interface PinnedResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: string;
}

export type RefusalCode =
  | "bad-url"
  | "scheme"
  | "credentials"
  | "port"
  | "host-missing"
  | "hostname-blocked"
  | "resolve-failed"
  | "address-private"
  | "too-many-redirects"
  | "bad-redirect"
  | "redirect-downgrade"
  | "too-large"
  | "timeout"
  | "network";

export interface Refusal {
  allowed: false;
  code: RefusalCode;
  reason: string;
}

export interface Allowed {
  allowed: true;
  url: URL;
  addresses: ResolvedHost[];
  /** The address the caller must connect to. */
  pinned: ResolvedHost;
}

export type DestinationDecision = Allowed | Refusal;

/** Ports that are allowed in addition to each scheme's own default. */
const EXTRA_ALLOWED_PORTS = new Set<number>([8080, 8443]);

const MAX_REDIRECTS = 6;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 250_000;

function refuse(code: RefusalCode, reason: string): Refusal {
  return { allowed: false, code, reason };
}

/* ------------------------------------------------------------------ */
/* Address classification                                             */
/* ------------------------------------------------------------------ */

/** Parses an IPv4 address in any spelling the URL parser accepts. */
export function parseIPv4(input: string): [number, number, number, number] | null {
  const text = input.trim().replace(/\.$/, "");
  if (!text) return null;

  const parts = text.split(".");
  // A single number (e.g. http://2130706433/) is a 32-bit address.
  if (parts.length === 1) {
    if (!/^(?:0[xX][0-9a-fA-F]+|\d+)$/.test(parts[0])) return null;
    const n = parts[0].toLowerCase().startsWith("0x") ? parseInt(parts[0], 16) : Number(parts[0]);
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  if (parts.length > 4) return null;

  const octets: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    let value: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) value = parseInt(part, 16);
    else if (/^0[0-7]+$/.test(part)) value = parseInt(part, 8); // legacy octal
    else if (/^\d+$/.test(part)) value = Number(part);
    else return null;

    // Only the LAST part may use the "rest of the address" form (a.b.c.d short).
    if (i === parts.length - 1 && parts.length < 4) {
      const remainingBytes = 4 - i;
      if (value < 0 || value >= 2 ** (8 * remainingBytes)) return null;
      for (let k = remainingBytes - 1; k >= 0; k--) octets.push((value >>> (8 * k)) & 255);
      break;
    }
    if (value < 0 || value > 255) return null;
    octets.push(value);
  }
  if (octets.length !== 4) return null;
  if (input.trim().split(".").length === 4 && input.includes(" ")) return null; // whitespace tricks
  return [octets[0], octets[1], octets[2], octets[3]];
}

function expandIPv6(input: string): number[] | null {
  let text = input.trim().replace(/^\[|\]$/g, "");
  if (text.includes("%")) text = text.split("%")[0]; // zone id: ignore for classification
  const halves = text.split("::");
  if (halves.length > 2) return null;

  const toGroups = (segment: string): number[] | null => {
    if (!segment) return [];
    const groups: number[] = [];
    for (const piece of segment.split(":")) {
      if (piece.includes(".")) {
        const v4 = parseIPv4(piece);
        if (!v4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
      groups.push(parseInt(piece, 16));
    }
    return groups;
  };

  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array(missing).fill(0), ...tail];
}

/**
 * True only for addresses that are globally routable unicast.
 *
 * Deliberately conservative: reserved, documentation, benchmark, multicast,
 * link-local, carrier-grade NAT, and cloud metadata ranges all read as
 * non-public, because refusing a rare legitimate host is the safe failure.
 */
export function isPublicAddress(raw: string): boolean {
  const text = raw.trim().replace(/^\[|\]$/g, "");
  if (!text) return false;

  // IPv4 (any spelling) — checked first so "127.1" and "0x7f.0.0.1" cannot slip
  // through as hostnames.
  const dotted = /^[0-9a-fA-FxX.:]+$/.test(text);
  if (dotted && !text.includes(":")) {
    const v4 = parseIPv4(text);
    if (!v4) return false;
    const [a, b, c] = v4;
    if (a === 0) return false; // "this network"
    if (a === 10) return false;
    if (a === 127) return false; // loopback
    if (a === 169 && b === 254) return false; // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF / TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a >= 224) return false; // multicast, reserved, broadcast
    return true;
  }

  if (text.includes(":")) {
    const groups = expandIPv6(text);
    if (!groups) return false;
    const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: classify the IPv4 part.
    const firstFiveZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
    if (firstFiveZero && (g5 === 0xffff || g5 === 0)) {
      const mapped = `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`;
      // ::ffff:127.0.0.1 and ::127.0.0.1 are the loopback in disguise.
      return isPublicAddress(mapped);
    }
    // NAT64 well-known prefix 64:ff9b::/96 embeds IPv4 too.
    if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
      return isPublicAddress(`${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`);
    }
    if (groups.every((g) => g === 0)) return false; // ::
    if (groups.slice(0, 7).every((g) => g === 0) && g7 === 1) return false; // ::1
    if ((g0 & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
    if ((g0 & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
    if ((g0 & 0xff00) === 0xff00) return false; // multicast ff00::/8
    if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
    if (g0 === 0x2001 && g1 === 0x0000) return false; // Teredo / special
    return true;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* URL + hostname validation                                          */
/* ------------------------------------------------------------------ */

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".lan", ".home.arpa", ".localhost", ".invalid", ".test"];
const METADATA_HOSTNAMES = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/**
 * Decides whether a URL may be requested, and which address the socket must
 * use. Pure apart from the injected resolver, so every branch is testable.
 */
export async function evaluateDestination(
  rawUrl: string,
  deps: SafeFetchDeps = {},
  opts: { allowPorts?: number[] } = {},
): Promise<DestinationDecision> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return refuse("bad-url", "That is not a valid web address.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return refuse("scheme", `Only http and https addresses can be requested, not ${url.protocol.replace(":", "")}.`);
  }
  if (url.username || url.password) {
    return refuse("credentials", "Addresses with a username or password embedded are not requested.");
  }

  const defaultPort = url.protocol === "https:" ? 443 : 80;
  const allowedPorts = new Set<number>([80, 443, ...EXTRA_ALLOWED_PORTS, ...(opts.allowPorts ?? [])]);
  const port = url.port ? Number(url.port) : defaultPort;
  if (!Number.isInteger(port) || !allowedPorts.has(port)) {
    return refuse("port", `Port ${url.port || port} is not on the allowed list (80, 443, 8080, 8443).`);
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) return refuse("host-missing", "The address has no hostname.");
  if (METADATA_HOSTNAMES.has(hostname)) {
    return refuse("hostname-blocked", "Cloud metadata endpoints are never requested.");
  }
  if (BLOCKED_HOST_SUFFIXES.some((s) => hostname === s.replace(/^\./, "") || hostname.endsWith(s))) {
    return refuse("hostname-blocked", "Private network names are never requested.");
  }

  // A literal address needs no resolver: classify it directly.
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      return refuse("address-private", `${hostname} is a private, loopback, link-local or reserved address.`);
    }
    return { allowed: true, url, addresses: [{ address: hostname, family: isIP(hostname) === 6 ? 6 : 4 }], pinned: { address: hostname, family: isIP(hostname) === 6 ? 6 : 4 } };
  }
  // Alternate numeric spellings are addresses, not hostnames.
  if (/^[0-9a-fA-FxX.]+$/.test(hostname) && parseIPv4(hostname)) {
    return refuse("address-private", `${hostname} is a numeric address, not a public hostname.`);
  }

  let addresses: ResolvedHost[];
  try {
    addresses = deps.resolve ? await deps.resolve(hostname) : await defaultResolve(hostname);
  } catch (err) {
    return refuse("resolve-failed", `That hostname could not be looked up (${err instanceof Error ? err.message : "unknown error"}).`);
  }
  if (addresses.length === 0) {
    return refuse("resolve-failed", "That hostname did not resolve to any address.");
  }

  // ANY non-public answer blocks the request: a split-horizon resolver must not
  // be able to win a race with the check.
  const offending = addresses.find((a) => !isPublicAddress(a.address));
  if (offending) {
    return refuse("address-private", `${hostname} resolves to ${offending.address}, which is private, loopback, link-local or reserved.`);
  }

  return { allowed: true, url, addresses, pinned: addresses[0] };
}

async function defaultResolve(hostname: string): Promise<ResolvedHost[]> {
  const results = await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses as { address: string; family: number }[]);
    });
  });
  return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
}

/* ------------------------------------------------------------------ */
/* The connection, pinned to the validated address                     */
/* ------------------------------------------------------------------ */

/**
 * One HTTP(S) request whose socket can only reach `address`.
 *
 * `hostname` stays in the Host header and in TLS SNI/servername, so certificate
 * validation still verifies the real host. The `lookup` hook is what pins the
 * connection: it ignores whatever the OS resolver would say and returns the
 * address that was validated.
 */
function pinnedRequest(req: PinnedRequest): Promise<PinnedResponse> {
  const { url, address, headers, timeoutMs, maxBytes } = req;
  const isHttps = url.protocol === "https:";
  const send = isHttps ? httpsRequest : httpRequest;

  return new Promise<PinnedResponse>((resolve, reject) => {
    const request = send(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: req.method,
        headers,
        servername: isHttps ? url.hostname.replace(/^\[|\]$/g, "") : undefined,
        // THE PIN: the socket may only connect to the validated address.
        lookup: (_hostname, _options, callback) => {
          callback(null, address.address, address.family);
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            res.destroy();
            reject(Object.assign(new Error("too-large"), { code: "too-large" }));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: { get: (name: string) => (res.headers[name.toLowerCase()] as string | undefined) ?? null },
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    request.on("timeout", () => {
      request.destroy(Object.assign(new Error("timeout"), { code: "timeout" }));
    });
    request.on("error", reject);
    request.end();
  });
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  finalUrl: string;
  redirectCount: number;
  /** Every hop's destination decision, for honest reporting. */
  notes: string[];
  refusal?: Refusal;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  deps?: SafeFetchDeps;
  headers?: Record<string, string>;
}

/**
 * Fetches a URL with SSRF protection at every hop.
 *
 * A refusal is a normal result (never a thrown error): callers report it with
 * the member's own language rather than retrying or guessing.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const deps = opts.deps ?? {};
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const notes: string[] = [];
  const doRequest = deps.request ?? pinnedRequest;

  const refused = (refusal: Refusal, finalUrl: string, redirectCount: number): SafeFetchResult => ({
    ok: false,
    status: 0,
    headers: { get: () => null },
    text: async () => "",
    finalUrl,
    redirectCount,
    notes,
    refusal,
  });

  let current = rawUrl;
  let redirectCount = 0;
  let previousProtocol = "";

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const decision = await evaluateDestination(current, deps);
    if (!decision.allowed) {
      notes.push(`Refused (${decision.code}): ${decision.reason}`);
      return refused(decision, current, redirectCount);
    }

    if (previousProtocol && previousProtocol !== decision.url.protocol) {
      if (previousProtocol === "https:" && decision.url.protocol === "http:") {
        const downgrade = refuse("redirect-downgrade", "A redirect tried to drop from a secure (https) connection to an insecure (http) one, so it was refused.");
        notes.push(`Refused (${downgrade.code}): ${downgrade.reason}`);
        return refused(downgrade, current, redirectCount);
      }
      notes.push(`Redirect changed scheme from ${previousProtocol} to ${decision.url.protocol}; the new destination was validated on its own.`);
    }

    let response: PinnedResponse;
    try {
      response = await doRequest({
        url: decision.url,
        address: decision.pinned,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SophiraResearch/1.0; +https://sophira.app)",
          Accept: "text/html,application/xhtml+xml,application/pdf;q=0.5,*/*;q=0.1",
          Host: decision.url.host,
          ...(opts.headers ?? {}),
        },
        timeoutMs,
        maxBytes,
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      const refusal: Refusal =
        code === "too-large"
          ? refuse("too-large", `The page is larger than the ${Math.round(maxBytes / 1000)} kB limit.`)
          : code === "timeout" || (err instanceof Error && err.name === "TimeoutError")
            ? refuse("timeout", "The site did not answer in time.")
            : refuse("network", `The site could not be reached (${err instanceof Error ? err.message : "network error"}).`);
      notes.push(`Fetch failed (${refusal.code}): ${refusal.reason}`);
      return refused(refusal, current, redirectCount);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        return {
          ok: response.status < 400,
          status: response.status,
          headers: response.headers,
          text: async () => response.body,
          finalUrl: current,
          redirectCount,
          notes,
        };
      }
      let next: string;
      try {
        next = new URL(location, decision.url).toString();
      } catch {
        const bad = refuse("bad-redirect", "A redirect pointed at an address that could not be parsed.");
        notes.push(`Refused (${bad.code}): ${bad.reason}`);
        return refused(bad, current, redirectCount);
      }
      // The next hop goes through the SAME validation: no inherited permission.
      notes.push(`Redirect ${redirectCount + 1}: ${decision.url.host} → ${new URL(next).host}`);
      previousProtocol = decision.url.protocol;
      current = next;
      redirectCount++;
      continue;
    }

    return {
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      headers: response.headers,
      text: async () => response.body,
      finalUrl: decision.url.toString(),
      redirectCount,
      notes,
    };
  }

  const tooMany = refuse("too-many-redirects", `More than ${maxRedirects} redirects were followed.`);
  notes.push(`Refused (${tooMany.code}): ${tooMany.reason}`);
  return refused(tooMany, current, redirectCount);
}
