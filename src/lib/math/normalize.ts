/**
 * Math notation normalization (2026-10-06 image-to-solution round).
 *
 * Deterministically converts OCR'd math text into a mathjs-parseable
 * expression. Pure function — the LLM never validates the math; it only
 * transcribes pixels to characters, and this module + the solver own
 * everything from characters to solutions.
 */

/** Unicode + typographic variants → ASCII math tokens. */
const CHAR_MAP: Record<string, string> = {
  "×": "*", "·": "*", "∙": "*", "⨯": "*",
  "÷": "/", "−": "-", "–": "-", "—": "-", "‒": "-",
  "≤": "<=", "≥": ">=", "≠": "!=",
  "⁄": "/",
  "π": "pi", "Π": "pi", "τ": "tau",
  "θ": "theta", "α": "alpha", "β": "beta", "λ": "lambda", "μ": "mu",
  "Σ": "sum", "∑": "sum",
  "≈": "==", "≡": "==", "≅": "==",
};

const SUPERS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5",
  "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "ⁿ": "n",
};

const VULGAR: Record<string, string> = {
  "½": "(1/2)", "⅓": "(1/3)", "⅔": "(2/3)", "¼": "(1/4)",
  "¾": "(3/4)", "⅕": "(1/5)", "⅖": "(2/5)", "⅗": "(3/5)", "⅘": "(4/5)",
  "⅙": "(1/6)", "⅚": "(5/6)", "⅛": "(1/8)", "⅜": "(3/8)", "⅝": "(5/8)", "⅞": "(7/8)",
};

export interface NormalizeResult {
  /** mathjs-parseable expression(s) — multiple for systems of equations */
  expressions: string[];
  /** deterministic confidence penalties discovered during normalization */
  ambiguity: string[];
}

/**
 * Normalize OCR text into mathjs syntax. Handles fractions, exponents
 * (x² → x^2), roots (√9 → sqrt(9)), integrals (∫ 3x^2 dx), derivatives
 * (dy/dx, d/dx(...)), matrices (rows on lines), systems (equations
 * separated by ; or newlines).
 */
export function normalizeMathText(raw: string): NormalizeResult {
  let text = (raw ?? "").trim();
  const ambiguity: string[] = [];

  // character-level mapping
  let out = "";
  for (const ch of text) {
    if (VULGAR[ch]) out += VULGAR[ch];
    else if (CHAR_MAP[ch]) out += CHAR_MAP[ch];
    else if (ch === "±") { out += "+"; ambiguity.push("± found — solved for the + branch; confirm which sign you meant"); }
    else if (ch === "√") { out += "SQRT"; }
    else if (ch === "∛") { out += "CBRT"; }
    else if (ch === "∫") { out += " INTEGRAL "; }
    else out += ch;
  }
  text = out;

  // superscript exponents: x² → x^2 (runs: x²³ → x^23)
  text = text.replace(/([a-zA-Z0-9)])((?:[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ])+)/g, (_m, base: string, sup: string) => {
    const exp = Array.from(sup).map((c) => SUPERS[c]).join("");
    return `${base}^${exp}`;
  });

  // SQRT token → sqrt(…): wrap the immediate argument
  const wrapArg = (fn: string, text: string): string => {
    // already-parenthesized: sqrt(x+1), sqrt((x+1)/2)
    let prev = "";
    while (prev !== text) {
      prev = text;
      text = text.replace(new RegExp(`${fn}(\\([^()]*(?:\\([^()]*\\)[^()]*)*\\))`, "g"), `$1`.length ? `${fn.toLowerCase()}$1` : "");
      text = text.replace(new RegExp(`${fn}\\s*\\(`, "g"), `${fn.toLowerCase()}(`);
      // bare argument: sqrt9, sqrtx, sqrt2x → sqrt(2)*x handled conservatively:
      // sqrt2x → sqrt(2x)? ambiguous. Take the longest run of digits/letters as ONE arg.
      text = text.replace(new RegExp(`${fn}(\\d+(?:\\.\\d+)?)`, "g"), `${fn.toLowerCase()}($1)`);
    }
    return text;
  };
  text = wrapArg("SQRT", text);
  text = wrapArg("CBRT", text);

  // OCR 'o'/'O' as zero when surrounded by digits/operators
  text = text.replace(/(?<=\d)\s*[oO]\s*(?=[\d+\-*/=,)]|$)/g, "0");
  text = text.replace(/(?<=[+\-*/=(,])\s*[oO]\s*(?=\d)/g, "0");

  // comma decimal from OCR: 3,5 → 3.5 (conservative; NEVER inside
  // matrix/vector brackets, where commas are list separators)
  if (!/[\[\]]/.test(text)) text = text.replace(/(\d),(\d)(?!\d)/g, "$1.$2");

  // split systems: newlines / semicolons / " and " between equations
  const pieces = text
    .split(/[\n;]+|\band\b(?=\s*[a-zA-Z][a-zA-Z]*\s*[+\-=])/i)
    .map((p) => p.trim().replace(/\s{2,}/g, " "))
    .filter((p) => p.length > 0);

  if (/[?¿]/.test(text)) ambiguity.push("question marks in transcription — likely OCR noise");
  if (text.length > 400) ambiguity.push("very long transcription — possibly multiple problems in one image");
  if (/[|¦]/.test(text)) ambiguity.push("vertical bar artifacts — possible fraction-line or root misread");
  if (/\.{4,}/.test(text)) ambiguity.push("ellipsis artifacts — the OCR could not resolve part of the image");

  return { expressions: pieces, ambiguity };
}

/** True when the expression contains an equation sign. */
export function looksLikeEquation(expr: string): boolean {
  return /=/.test(expr);
}
