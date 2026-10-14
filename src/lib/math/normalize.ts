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

  // ---- Natural-language integral instructions (2026-10-14) ----
  // OCR frequently emits words instead of (or alongside) the integral glyph,
  // sometimes BOTH ("Integral of INTEGRAL ..."). Recognize the spoken forms
  // and converge them onto the SAME canonical INTEGRAL token the glyph maps
  // to - one representation for Scan AND Type input.
  const spoken = text.replace(/\s+/g, " ").trim();
  let spoken2 = spoken.replace(/\bintegrate\b|\bintegral\b/gi, "INTEGRAL");
  // merge duplicated instruction runs: "INTEGRAL of INTEGRAL of X" -> "INTEGRAL X"
  spoken2 = spoken2.replace(/(?:\bINTEGRAL\b\s*(?:of\s*)?)+/gi, "INTEGRAL ");
  // "INTEGRAL X with respect to v" / "INTEGRAL X dv" -> canonical form
  spoken2 = spoken2.replace(/INTEGRAL\s+(.+?)\s+with\s+respect\s+to\s+([a-zA-Z])\s*$/i, (_m2: string, f: string, v: string) => `INTEGRAL ${f} d${v}`);
  spoken2 = spoken2.replace(/INTEGRAL\s+(.+?)\s+d([a-zA-Z])\s*$/i, (_m2: string, f: string, v: string) => `INTEGRAL ${f} d${v}`);
  if (spoken2 !== spoken) text = spoken2;
  // INTEGRAL with a missing differential ("INTEGRAL sin(x)e^x", common in
  // OCR): if the integrand has exactly ONE free variable, that variable is
  // unambiguous - append d<var>. If it has none or several, leave it and
  // let the solver request clarification honestly.
  const intNoDiff = text.match(/^\s*INTEGRAL\s+(.+?)\s*$/i);
  if (intNoDiff && !/\sd[a-zA-Z]\s*$/i.test(text)) {
    const integrand = intNoDiff[1];
    const stripped = integrand.toLowerCase()
      .replace(/sin|cos|tan|log|ln|exp|sqrt|abs|pi|e/g, "");
    const vars = Array.from(new Set(stripped.match(/[a-z]/g) ?? []));
    if (vars.length === 1) text = `INTEGRAL ${integrand} d${vars[0]}`;
  }
  // OCR often capitalizes function names ("Sin(x)") - mathjs is case-sensitive.
  text = text.replace(/\b(Sin|Cos|Tan|Log|Ln|Exp|Sqrt|Abs)\s*\(/g, (mm: string, fn: string) => fn.toLowerCase() + "(");

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
