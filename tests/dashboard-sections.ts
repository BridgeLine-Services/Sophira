/**
 * DASHBOARD SECTIONS AND NAVIGATION FOCUS (2026-11-12).
 *
 * Two defects the owner reported, pinned so neither can come back silently:
 *
 * 1. NAVIGATION. The active row in the sidebar showed a box that read as a purple outline. The
 *    app paints no purple on navigation (the only purple is the dashboard identity and the unused
 *    brand token), so the box was a focus indicator: the global `:focus-visible` rule forced
 *    `border-radius: .125rem` on EVERY focused element and drew the ring as a box-shadow parked
 *    2px outside it, which detached it from the rounded row and left it behind after a click.
 *    These tests assert one focus mechanism, no radius override, an inset nav ring, and that
 *    focus indicators are never globally disabled.
 *
 * 2. SECTIONS. Each major dashboard block must be its own container with its own heading, and a
 *    container must not be drawn when it has nothing to show (an empty purple card).
 */
import { readFileSync } from "fs";

type Assert = (cond: boolean, msg: string) => void;

export function runDashboardSectionTests(assert: Assert, section: (name: string) => void) {
  const css = readFileSync("src/app/globals.css", "utf8");
  const page = readFileSync("src/app/dashboard/page.tsx", "utf8");
  const owner = readFileSync("src/components/app/OwnerDashboard.tsx", "utf8");
  const button = readFileSync("src/components/ui/Button.tsx", "utf8");
  const input = readFileSync("src/components/ui/Input.tsx", "utf8");

  section("navigation focus: one indicator, never a detached box");

  // The old global rule: forced a 2px radius and a box-shadow ring offset onto paper.
  assert(!/:focus-visible\s*\{[^}]*border-radius\s*:\s*\.125rem/.test(css),
    "the global focus rule no longer forces border-radius:.125rem onto every focused element");
  assert(!/rounded-sm;\s*\}/.test(css.split("/* KEYBOARD FOCUS")[1]?.split("}")[0] ?? ""),
    "the global focus rule does not reshape focused elements");
  assert(css.includes("outline: 2px solid rgb(var(--c-accent));"),
    "keyboard focus is drawn as an explicit accent outline, not a ring a browser can recolour");
  assert(css.includes(".nav-item:focus-visible") && css.includes(".nav-subitem:focus-visible"),
    "navigation rows carry their own focus indicator");
  assert(/\.nav-item:focus-visible,[\s\S]{0,220}outline-offset: -2px/.test(css),
    "the navigation ring is inset, so it cannot look like a box around the active row");
  assert(/\.nav-item:focus:not\(:focus-visible\)/.test(css),
    "a pointer click leaves no ring behind, while keyboard focus keeps its indicator");

  // Focus must never be globally disabled: every `outline: none` is scoped to pointer focus.
  const outlineNone = css.match(/outline:\s*none/g) ?? [];
  const scoped = css.match(/:focus:not\(:focus-visible\)[^{]*\{[^}]*outline:\s*none/g) ?? [];
  assert(outlineNone.length === scoped.length,
    `no focus indicator is switched off outside pointer-only focus (${outlineNone.length} vs ${scoped.length})`);

  // The active row must be a deliberate selection: fill, accent ink and a bar. Not a border.
  assert(/\.nav-item-active\s*\{[^}]*bg-accent-soft[^}]*\}/.test(css.replace(/\n\s*/g, " ")),
    "the active navigation row is filled with the accent-soft surface");
  assert(/inset 3px 0 0 rgb\(var\(--c-accent\)\)/.test(css),
    "the active navigation row keeps its accent bar");
  assert(!/nav-item-active[^}]*border\s*:\s*(1|2)px/.test(css),
    "the active navigation row is not outlined with a border");

  section("focus: buttons and inputs use the same single mechanism");

  assert(!button.includes("focus-visible:ring-accent"),
    "buttons no longer draw a second, ring-based indicator on top of the outline");
  assert(!input.includes("focus:ring-accent/"),
    "text inputs no longer draw a second, ring-based indicator on top of the outline");
  assert(!input.includes("focus:outline-none"),
    "text inputs keep a visible focus indicator");

  section("dashboard sections are independent containers");

  assert(css.includes(".dash-page > * + * { margin-top: 14px; }"),
    "dashboard blocks own the space above them, so no panel touches the next one");

  // Courses and teachers are unrelated lists: one container each.
  assert(page.includes('aria-labelledby="dashboard-courses-heading"')
    && page.includes('id="dashboard-courses-heading"'),
    "the courses list has its own container and heading");
  assert(page.includes('aria-labelledby="dashboard-teachers-heading"')
    && page.includes('id="dashboard-teachers-heading"'),
    "the teachers list has its own container and heading");
  assert(!/dashboard-courses-heading[\s\S]{0,4000}dashboard-teachers-heading[\s\S]{0,60}xl:grid-cols-2/
      .test(page.slice(0, page.indexOf("dashboard-teachers-heading")) + page.slice(page.indexOf("dashboard-teachers-heading"))),
    "courses and teachers are no longer nested inside one two-column card");

  // Every panel heading uses the one panel-heading vocabulary.
  assert(!page.includes('className="mb-3 meta-strong"'),
    "dashboard panel headings use the shared panel-title style, not a one-off class");
  assert(!page.includes("text-base font-semibold text-ink\">My "),
    "the courses/teachers headings use the shared panel-title style");

  // A panel with nothing inside it must not be drawn at all.
  const emptyGuards = [
    ["pendingProposals", "dashboard-proposals-heading"],
    ["activePatterns", "dashboard-patterns-heading"],
    ["recentFeedback", "dashboard-feedback-heading"],
  ] as const;
  for (const [name, heading] of emptyGuards) {
    const at = page.indexOf(heading);
    assert(at > -1, `${heading} exists`);
    const before = page.slice(Math.max(0, at - 400), at);
    assert(before.includes(`${name}`), `${heading} is only rendered when ${name} has something to show`);
  }

  section("owner dashboard: each major section has its own container");

  const ownerSections = owner.match(/<section aria-labelledby="owner-dashboard-[^"]+"[^>]*>/g) ?? [];
  assert(ownerSections.length >= 2, "the owner dashboard has at least two named sections");
  assert(ownerSections.every((s) => s.includes('className="panel') || s.includes("className={'panel")),
    "each owner dashboard section is drawn as its own panel, so the sections read as separate");
  assert(!owner.includes("focus-visible:rounded-2xl"),
    "the radius workaround for the old focus rule is gone from the owner dashboard");
  assert(owner.includes('id="owner-dashboard-numbers"') && owner.includes('id="owner-dashboard-manage"'),
    "both owner dashboard sections keep their accessible names");

  section("the purple frame around dashboard content is gone");

  // The purple gradient filled the whole dashboard CONTAINER, so a 14-26px purple band sat on all
  // four sides of every white panel: the "purple outline" around Overview and Your workspace.
  const dashPage = css.split(".dash-page {")[1]?.split("}")[0] ?? "";
  assert(!dashPage.includes("background: var(--hero-bg)"),
    "the dashboard container no longer fills itself with the purple gradient");
  assert(!dashPage.includes("box-shadow"),
    "the dashboard container no longer paints a frame shadow around the content");
  assert(!dashPage.includes("padding:"),
    "the dashboard container adds no purple padding band around the panels");
  const dashHero = css.split(".dash-hero {")[1]?.split("}")[0] ?? "";
  assert(dashHero.includes("background: var(--hero-bg)"),
    "the purple gradient belongs to the hero band only");
  const roleHero = css.split(".dash-page > .dash-stack > .dash-hero {")[1]?.split("}")[0] ?? "";
  assert(roleHero.includes("background: var(--hero-bg)"),
    "the role dashboards keep the same purple hero band");

  // White text must never sit on the page canvas: only the hero band carries white ink.
  const eyebrow = css.split(".dash-eyebrow {")[1]?.split("}")[0] ?? "";
  assert(eyebrow.includes("rgb(var(--c-ink-soft))"),
    "the eyebrow uses readable theme ink outside the hero");
  assert(css.includes(".dash-hero .dash-eyebrow { color: rgba(255, 255, 255, 0.62); }"),
    "the eyebrow stays light on the purple hero");
  const heroSub = css.split("\n.dash-hero-sub {")[1]?.split("}")[0] ?? "";
  assert(heroSub.includes("rgb(var(--c-ink-soft))"),
    "the workspace subtitle uses readable theme ink outside the hero");

  // The member home keeps the purple band around exactly its opening block.
  assert(page.includes('<header className="dash-hero">'),
    "the member home draws its opening block as the purple hero band");

  section("no literal colours in the dashboard cards");

  assert(!page.includes("rgba(81,69,232"), "the purple glow literal is replaced by a theme shadow token");
  assert(/grid gap-3 xl:grid-cols-2/.test(page),
    "courses and teachers sit side by side on a wide screen while staying separate containers");
}
