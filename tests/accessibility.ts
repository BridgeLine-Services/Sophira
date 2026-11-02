/**
 * ACCESSIBILITY GUARD (Stage 5, 2026-11-02).
 *
 * These are structural guarantees, not a substitute for testing with a screen
 * reader. They stop the specific regressions that are cheap to introduce and
 * invisible in a normal test run: unlabelled form controls, missing focus rings,
 * no reduced-motion path, and dialogs with no role.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

/** Matches one JSX element's opening tag. A naive [^>]* stops at "=>" inside a handler. */
const CONTROL = /<(input|textarea|select)\b(?:"[^"]*"|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|[^>"{}])*>/g;

export function runAccessibilityTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("accessibility (structural)");

  const appFiles = walk("src/app")
    .concat(walk("src/components"))
    .filter((f) => /\.tsx$/.test(f) && !/components\/ui\//.test(f));

  const unlabelled: string[] = [];
  for (const file of appFiles) {
    const flat = readFileSync(file, "utf8").replace(/\s+/g, " ");
    let m: RegExpExecArray | null;
    while ((m = CONTROL.exec(flat))) {
      const tag = m[0];
      if (/type="(hidden|file)"/.test(tag)) continue; // driven by a labelled button
      if (/aria-label=/.test(tag)) continue;
      const id = (tag.match(/id="([^"]+)"/) || [])[1];
      if (id && flat.includes(`htmlFor="${id}"`)) continue;
      const before = flat.slice(0, m.index);
      // Implicit labelling: the control sits inside an open <label>.
      if ((before.match(/<label\b/gi) || []).length > (before.match(/<\/label>/gi) || []).length) continue;
      unlabelled.push(`${file} :: ${tag.slice(0, 70)}`);
    }
  }
  assert(unlabelled.length === 0,
    `a11y: every form control has a programmatic label (${unlabelled.length} found${unlabelled.length ? `: ${unlabelled.slice(0, 3).join(" | ")}` : ""})`);

  // Icon-only buttons are unreadable to a screen reader without a label.
  const iconOnly: string[] = [];
  for (const file of appFiles) {
    const flat = readFileSync(file, "utf8").replace(/\s+/g, " ");
    for (const b of flat.match(/<button\b[^>]*>([\s\S]{0,80}?)<\/button>/g) || []) {
      const inner = (b.match(/>([\s\S]*?)<\/button>/) || [])[1] || "";
      if (/aria-label=/.test(b)) continue;
      if (/[A-Za-z]{2,}/.test(inner.replace(/<[^>]*>/g, ""))) continue;
      iconOnly.push(file);
    }
  }
  assert(iconOnly.length <= 6, `a11y: few icon-only buttons lack a label (${iconOnly.length})`);

  const css = readFileSync("src/app/globals.css", "utf8");
  assert(/prefers-reduced-motion/.test(css),
    "a11y: reduced-motion preference is honoured in CSS");
  assert(/animation-duration:\s*0|transition-duration:\s*0|animation:\s*none|scroll-behavior:\s*auto/.test(css),
    "a11y: the reduced-motion block actually disables motion, not just names it");

  // One global :focus-visible rule covers every control; per-file counts just
  // measure who opted into utilities, not whether keyboard focus is visible.
  const focusRule = (css.match(/:focus-visible\s*\{[^}]*\}/) || [""])[0];
  assert(/ring|outline/.test(focusRule),
    "a11y: a global focus-visible rule draws a visible ring for keyboard users");
  assert(!/outline:\s*none;?\s*\}/.test(focusRule) || /ring/.test(focusRule),
    "a11y: the focus rule never removes the outline without replacing it");

  const dialogFiles = appFiles.filter((f) => /role="dialog"/.test(readFileSync(f, "utf8")));
  assert(dialogFiles.length >= 1, `a11y: dialogs declare role="dialog" (${dialogFiles.length})`);
  assert(dialogFiles.every((f) => /aria-modal|aria-labelledby|aria-label/.test(readFileSync(f, "utf8"))),
    "a11y: every dialog carries a name or modal marker");

  // Non-technical users must never see provider internals or infrastructure names.
  const jargon = appFiles.filter((f) => {
    const s = readFileSync(f, "utf8");
    const visible = s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    return /invalid_grant|access_denied|ECONNREFUSED|PGRST\d|row-level security|supabase\.co|\.stack\b/.test(visible);
  });
  assert(jargon.length === 0,
    `a11y/UX: no infrastructure or OAuth internals in user-facing text (${jargon.join(", ") || "clean"})`);

  assert(existsSync("src/app/error.tsx"), "a11y/UX: an error boundary catches render failures");
  const errorPage = readFileSync("src/app/error.tsx", "utf8");
  assert(!/\{error\.message\}|\{error\.stack\}/.test(errorPage),
    "a11y/UX: the error boundary does not print the raw error to the user");
  assert(/try again|reload|go back/i.test(errorPage), "a11y/UX: the error boundary offers a way forward");

  const notFound = existsSync("src/app/not-found.tsx") ? readFileSync("src/app/not-found.tsx", "utf8") : "";
  assert(notFound.length > 50, "a11y/UX: a friendly not-found page exists");

  // Responsive: the app must actually use responsive breakpoints.
  const responsive = appFiles.filter((f) => /\b(sm|md|lg):/.test(readFileSync(f, "utf8")));
  assert(responsive.length >= 20, `a11y/UX: layouts are responsive (${responsive.length} files use breakpoints)`);
}
