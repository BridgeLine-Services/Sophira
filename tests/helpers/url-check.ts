/**
 * TEST HELPERS: CHECKING A URL BY PARSING IT (CodeQL url-substring alerts in tests)
 *
 * Several test assertions wanted to say "this output mentions the docs URL" or "this
 * hit is not from the blog host". Written as `text.includes("https://host/…")` or
 * `url.startsWith("http://host")` those are substring checks on URL-shaped strings,
 * which is the same weakness as the production bugs fixed in this phase - just with
 * lower stakes. Parsing costs nothing here, so the assertions now compare real
 * hostnames and paths.
 */

/** Every http(s) URL-shaped substring in `text`, parsed. Unparseable ones are dropped. */
export function urlsIn(text: string): URL[] {
  const found: URL[] = [];
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf("http", index);
    if (start === -1) break;
    // A URL runs until whitespace, a quote, a bracket, or a closing paren.
    let end = start;
    while (end < text.length && !/[\s"'<>)\]},]/.test(text[end])) end++;
    const candidate = text.slice(start, end);
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") found.push(parsed);
    } catch {
      // Not a URL after all (e.g. the literal word "http" in prose).
    }
    index = end > start ? end : start + 4;
  }
  return found;
}

/** True when `text` contains a URL whose hostname is EXACTLY `host`. */
export function hasUrlWithHost(text: string, host: string): boolean {
  return urlsIn(text).some((url) => url.hostname === host);
}

/** True when `text` contains a URL on `host` whose path starts with `pathPrefix`. */
export function hasUrl(text: string, host: string, pathPrefix = "/"): boolean {
  return urlsIn(text).some((url) => url.hostname === host && url.pathname.startsWith(pathPrefix));
}

/** Parses a single URL-shaped string and returns its hostname, or null. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
