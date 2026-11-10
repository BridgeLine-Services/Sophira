/**
 * TEST URL HELPERS (2026-11-09) — CodeQL alerts #25–#47.
 *
 * The flagged lines were assertions of the form `url.includes("nature.com")`.
 * Substring matching on a URL is misleading in two ways: "evil-nature.com" and
 * "nature.com.attacker.example" both contain the expected text, and the check
 * says nothing about which host is actually being visited. In tests the risk is
 * a FALSE PASS (a broken ranking change that still contains the substring), and
 * the same pattern in production code is a real vulnerability class, so it is
 * removed rather than suppressed.
 *
 * `hostIs` parses the URL and compares the hostname exactly, or as a true
 * subdomain (dot-boundary), which is what these assertions meant to say.
 */

export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** True when the URL's hostname is exactly `expected` or a subdomain of it. */
export function hostIs(url: string | null | undefined, expected: string): boolean {
  const host = hostOf(url);
  const target = expected.toLowerCase().replace(/^\./, "");
  if (!host || !target) return false;
  return host === target || host.endsWith(`.${target}`);
}

/** True when the hostname matches any of the given hostnames/subdomains. */
export function hostIn(url: string | null | undefined, expected: readonly string[]): boolean {
  return expected.some((e) => hostIs(url, e));
}

/** True when scheme, host and port match — a stricter comparison. */
export function originIs(url: string | null | undefined, expectedOrigin: string): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}

/** True when the URL uses exactly the given scheme. */
export function schemeIs(url: string | null | undefined, scheme: string): boolean {
  try {
    return new URL(url ?? "").protocol === `${scheme.replace(/:$/, "")}:`;
  } catch {
    return false;
  }
}

/**
 * True when a piece of TEXT (for example a ranked citation like
 * "Nature paper (https://www.nature.com/articles/1)") mentions the host.
 *
 * Used where the value under test is formatted output, not a bare URL. Hosts are
 * matched as whole dot-separated segments, so "nature.com" does not match
 * "evil-nature.com" or "nature.com.attacker.example". No regular expression is
 * built from the hostname (CodeQL #25-#47): the text is split into tokens and the
 * segments are compared as strings.
 */
export function mentionsHost(text: string | null | undefined, expected: string): boolean {
  const value = (text ?? "").toLowerCase();
  const target = expected.toLowerCase().replace(/^\./, "").replace(/\.$/, "");
  if (!value || !target) return false;

  // Any real URL in the text is parsed, which is the strongest check available.
  const urls = value.match(/https?:\/\/[^\s)"'<>,;]+/g) ?? [];
  if (urls.some((u) => hostIs(u, target))) return true;

  // Otherwise compare dot-separated segments of each word-like token.
  const tokens = value.split(/[^a-z0-9.-]+/).filter(Boolean);
  return tokens.some((token) => token === target || token.endsWith(`.${target}`));
}
