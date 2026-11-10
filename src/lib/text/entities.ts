/**
 * HTML ENTITY DECODING — ONE PASS, NO RECURSION (2026-11-09, CodeQL #48).
 *
 * WHY THE OLD CODE WAS WRONG
 * --------------------------
 * Entity decoding was a chain of `.replace()` calls: `&amp;` first, then `&lt;`,
 * then `&gt;`, and finally numeric references. That chain decodes the OUTPUT of
 * its own earlier steps, so:
 *
 *     "&amp;lt;script&amp;gt;"   →   "<script>"     (double-unescaped)
 *
 * Text that a sender deliberately escaped came back as live markup. A second
 * pass could turn `&#38;#60;` into `<`, and the same pattern existed in the
 * research extractor. A static analyser flags this correctly: the function
 * unescapes more than once.
 *
 * THE CONTRACT HERE
 * -----------------
 *   1. ONE pass. The replacement text is never rescanned, so `&amp;lt;` becomes
 *      the literal characters `&lt;` and stops there.
 *   2. Unknown or malformed references (`&bogus;`, `&#;`, `&#x;`, `&`) are left
 *      exactly as written — never dropped, never guessed at.
 *   3. Numeric references are read as Unicode code points, so characters above
 *      U+FFFF (emoji, rare scripts) survive. Surrogates and control characters
 *      are refused rather than emitted as broken text.
 *   4. Output is TEXT. Nothing here produces markup for a browser; callers put
 *      the result into plain strings, and the tag-stripping that precedes this
 *      step runs on the original input, never on decoded output.
 */

/** Named entities that actually appear in academic and email text. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  shy: "",
  mdash: "-",
  ndash: "-",
  minus: "-",
  hellip: "...",
  laquo: '"',
  raquo: '"',
  ldquo: '"',
  rdquo: '"',
  lsquo: "'",
  rsquo: "'",
  sbquo: "'",
  bdquo: '"',
  middot: "*",
  bull: "*",
  dagger: "+",
  Dagger: "++",
  permil: "o/oo",
  prime: "'",
  Prime: '"',
  deg: " degrees",
  plusmn: "+/-",
  times: "x",
  divide: "/",
  le: "<=",
  ge: ">=",
  ne: "!=",
  asymp: "~=",
  infin: "infinity",
  sum: "sum",
  radic: "sqrt",
  int: "integral",
  part: "d",
  nabla: "grad",
  isin: "in",
  notin: "not in",
  rarr: "->",
  larr: "<-",
  harr: "<->",
  uarr: "^",
  darr: "v",
  frac12: "1/2",
  frac14: "1/4",
  frac34: "3/4",
  sup1: "^1",
  sup2: "^2",
  sup3: "^3",
  micro: "u",
  alpha: "alpha",
  beta: "beta",
  gamma: "gamma",
  delta: "delta",
  epsilon: "epsilon",
  theta: "theta",
  lambda: "lambda",
  mu: "mu",
  pi: "pi",
  rho: "rho",
  sigma: "sigma",
  tau: "tau",
  phi: "phi",
  chi: "chi",
  psi: "psi",
  omega: "omega",
  Alpha: "Alpha",
  Beta: "Beta",
  Gamma: "Gamma",
  Delta: "Delta",
  Theta: "Theta",
  Lambda: "Lambda",
  Pi: "Pi",
  Sigma: "Sigma",
  Phi: "Phi",
  Psi: "Psi",
  Omega: "Omega",
  copy: "(c)",
  reg: "(r)",
  trade: "(tm)",
  euro: "EUR",
  pound: "GBP",
  yen: "JPY",
  cent: "c",
  sect: "section",
  para: "para",
  iexcl: "!",
  iquest: "?",
  ordf: "a",
  ordm: "o",
  szlig: "ss",
  aelig: "ae",
  AElig: "AE",
  oslash: "o",
  aring: "a",
  eacute: "e",
  egrave: "e",
  agrave: "a",
  aacute: "a",
  ccedil: "c",
  ntilde: "n",
  uuml: "u",
  ouml: "o",
  auml: "a",
  Eacute: "E",
  Aacute: "A",
  Ouml: "O",
  Uuml: "U",
};

/** Characters that would produce broken or invisible text if emitted raw. */
function isForbiddenCodePoint(cp: number): boolean {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return true;
  if (cp >= 0xd800 && cp <= 0xdfff) return true; // lone surrogate
  if (cp === 0) return true;
  // C0 controls except TAB, LF, CR; and DEL.
  if (cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13) return true;
  if (cp === 0x7f) return true;
  return false;
}

const ENTITY_PATTERN = /&(#[0-9]{1,10}|#[xX][0-9a-fA-F]{1,8}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/**
 * Decodes HTML character references in a single pass.
 *
 * The replacement callback's return value is inserted verbatim and never
 * rescanned, which is what makes `&amp;lt;` stay as `&lt;`.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input || input.indexOf("&") === -1) return input ?? "";

  return input.replace(ENTITY_PATTERN, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const digits = isHex ? body.slice(2) : body.slice(1);
      const codePoint = Number.parseInt(digits, isHex ? 16 : 10);
      if (!Number.isFinite(codePoint) || isForbiddenCodePoint(codePoint)) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body];
    return named === undefined ? match : named;
  });
}

/**
 * Removes element blocks that can never be useful text, plus all remaining tags.
 *
 * WHY A SCANNER AND NOT REGULAR EXPRESSIONS
 * -----------------------------------------
 * Tag-stripping regexes are a known bypass class: `</script >`, `</script foo>`,
 * `<script
src=x>` and unterminated blocks all slip past a pattern that looks
 * right (CodeQL js/bad-tag-filter). Rather than chase every variant, this reads
 * the string left to right:
 *
 *   - `<script`, `<style`, `<noscript` open a block that is skipped up to its own
 *     closing tag (any spacing, any attributes), or to the end if never closed;
 *   - `<!--` opens a comment that is skipped to `-->` (or to the end);
 *   - any other `<` that reaches a `>` is a tag and is dropped;
 *   - everything else is copied through as text.
 *
 * Content inside script/style is therefore never seen, and no crafted tag can
 * survive as markup because nothing is emitted as markup at all.
 */
const SKIPPED_BLOCKS = ["script", "style", "noscript", "template"] as const;

function isNameChar(ch: string): boolean {
  return /[a-z0-9:_-]/i.test(ch);
}

/** Index just past `<tag ...>` starting at `lt`, or -1 when there is no `>`. */
function endOfTag(html: string, lt: number): number {
  const gt = html.indexOf(">", lt + 1);
  return gt === -1 ? -1 : gt + 1;
}

/** Index just past the block opened at `lt`, following any closing spelling. */
function endOfBlock(html: string, lt: number, name: string): number {
  const openEnd = endOfTag(html, lt);
  if (openEnd === -1) return html.length;

  let cursor = openEnd;
  while (cursor < html.length) {
    const nextOpen = html.indexOf("</", cursor);
    if (nextOpen === -1) return html.length;
    let i = nextOpen + 2;
    // tolerate whitespace after "</" and match the tag name case-insensitively
    while (i < html.length && /\s/.test(html[i])) i++;
    const candidate = html.slice(i, i + name.length).toLowerCase();
    if (candidate === name) {
      const closeEnd = endOfTag(html, nextOpen);
      return closeEnd === -1 ? html.length : closeEnd;
    }
    cursor = nextOpen + 2;
  }
  return html.length;
}

export function stripTags(html: string): string {
  let out = "";
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);

    // HTML comment
    if (html.startsWith("<!--", lt)) {
      const close = html.indexOf("-->", lt + 4);
      i = close === -1 ? html.length : close + 3;
      out += " ";
      continue;
    }

    // Skip whole element blocks whose content is not text.
    let name = "";
    for (const candidate of SKIPPED_BLOCKS) {
      const slice = html.slice(lt + 1, lt + 1 + candidate.length).toLowerCase();
      const after = html[lt + 1 + candidate.length] ?? ">";
      if (slice === candidate && !isNameChar(after)) {
        name = candidate;
        break;
      }
    }
    if (name) {
      i = endOfBlock(html, lt, name);
      out += " ";
      continue;
    }

    // Any other tag: drop it, keep a newline for block-level boundaries.
    const tagEnd = endOfTag(html, lt);
    if (tagEnd === -1) {
      // A stray "<" with no closing ">" is text, not a tag.
      out += html.slice(lt);
      break;
    }
    const raw = html.slice(lt, tagEnd).toLowerCase();
    const isBreak = /^<\/(?:p|div|li|h[1-6]|tr|section|article|blockquote|pre)\b/.test(raw)
      || /^<br\b/.test(raw)
      || /^<\/?p\b/.test(raw);
    out += isBreak ? "\n" : " ";
    i = tagEnd;
  }
  return out;
}

/**
 * Strips HTML tags from markup, then decodes entities once.
 *
 * Order matters and is deliberate: tags are removed from the ORIGINAL markup, so
 * text that was escaped by the sender (`&lt;script&gt;`) is not turned into a tag
 * after decoding. The result is plain text, never markup.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  return decodeHtmlEntities(stripTags(html));
}
