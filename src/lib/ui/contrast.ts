/**
 * WCAG contrast maths for the redesign palette (2026-10-29).
 *
 * The target design is a dark violet theme (background #211735) replacing an
 * approved light theme (#f8f8fa). Rather than trust eyeballed values, every
 * foreground/background pair the UI actually uses is checked here, and any
 * proposed palette must pass before it is wired into tailwind.config.ts.
 *
 * Pure: no DOM, no browser, no dependency. Testable in the node harness.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse #rgb or #rrggbb. Returns null rather than guessing on bad input. */
export function parseHex(hex: string): Rgb | null {
  const value = (hex ?? "").trim().replace(/^#/, "");
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return null;
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

/** WCAG 2.1 contrast ratio, 1..21. Returns 0 for unparseable input. */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 0;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

export interface ContrastPair {
  name: string;
  foreground: string;
  background: string;
  /** 4.5 for body text, 3 for large text and non-text UI (WCAG AA). */
  min: number;
}

export interface ContrastFailure {
  name: string;
  ratio: number;
  min: number;
}

/** Every pair that fails its minimum. Empty array means the palette is clear. */
export function checkPairs(pairs: ContrastPair[]): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  for (const p of pairs) {
    const ratio = contrastRatio(p.foreground, p.background);
    if (ratio < p.min) failures.push({ name: p.name, ratio, min: p.min });
  }
  return failures;
}

/**
 * The violet direction from the design reference, with the pairs the UI needs.
 * Kept here (not in the config) so it can be validated before adoption.
 */
export const VIOLET_CANDIDATE = {
  background: "#211735",
  sidebar: "#251C40",
  topbar: "#30204D",
  card: "#382254",
  cardElevated: "#442962",
  border: "#5A4177",
  accent: "#7865FF",
  blue: "#35A9E8",
  magenta: "#D94DB8",
  success: "#20BB86",
  warning: "#F1B82D",
  danger: "#F15A5A",
  text: "#F7F3FF",
  textSoft: "#C0B5D6",
  textMuted: "#A99CBD",
} as const;

export function violetCandidatePairs(): ContrastPair[] {
  const c = VIOLET_CANDIDATE;
  return [
    { name: "body text on background", foreground: c.text, background: c.background, min: 4.5 },
    { name: "body text on card", foreground: c.text, background: c.card, min: 4.5 },
    { name: "body text on elevated card", foreground: c.text, background: c.cardElevated, min: 4.5 },
    { name: "secondary text on background", foreground: c.textSoft, background: c.background, min: 4.5 },
    { name: "secondary text on card", foreground: c.textSoft, background: c.card, min: 4.5 },
    { name: "muted text on card", foreground: c.textMuted, background: c.card, min: 4.5 },
    { name: "accent on background", foreground: c.accent, background: c.background, min: 3 },
    { name: "accent on card", foreground: c.accent, background: c.card, min: 3 },
    { name: "sidebar label on sidebar", foreground: c.textSoft, background: c.sidebar, min: 4.5 },
    { name: "danger on card", foreground: c.danger, background: c.card, min: 3 },
    { name: "success on card", foreground: c.success, background: c.card, min: 3 },
    { name: "warning on card", foreground: c.warning, background: c.card, min: 3 },
  ];
}
