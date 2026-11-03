# Theme and contrast verification

What is measured automatically, and what still needs a person.

## Measured (fails the build if broken)

`scripts/contrast.mjs` reads the real `--c-*` tokens out of `src/app/globals.css` for both
themes and computes WCAG relative-luminance contrast for the 16 text/surface pairs the owner
and member screens actually use: body text, secondary text, sidebar labels, links, card titles,
accent buttons and the success / needs-attention / error states.

`tests/run.ts` executes that script, so a token change that makes a label unreadable fails the
suite rather than reaching a member.

Current state, both themes, 32 pairs: **PASS**. Worst pair is accent text on the accent-soft
surface in dark at 4.20:1 against a 3:1 requirement for that size.

Two defects were found by this audit on 2026-11-03 and fixed:

- Dark accent was 3.35:1 on card surfaces and dark danger 4.16:1: both below AA for text.
  The violet hue is unchanged; the lightness was raised.
- **Two dark palettes existed.** The theme toggle wrote `[data-theme="dark"]` while a
  `prefers-color-scheme` copy served first visits, so the two had drifted and a fix could reach
  only half the users. There is now one palette, and first paint resolves the OS preference in
  `layout.tsx` before the first paint. A test asserts the stylesheet contains exactly two
  `--c-paper` definitions (light and dark) and no media-query copy.

`npm run smoke:runtime` additionally starts the built app and checks 31 facts over HTTP,
including that the served stylesheet carries the theme tokens at all.

## Not measured - still needs a person

Contrast is the one part of a visual review that can be computed. These cannot, and no claim is
made that they have been done:

- Layout at 360px, 768px and 1440px widths, including the new `/owner` card grid.
- Whether the violet surfaces feel right in dark mode (AA is a floor, not a design).
- Focus-ring visibility on the new link tiles, and focus order through them.
- Touch target spacing in the member table on a phone.

The eight routes recorded as `partial` in `docs/redesign-status.json` stay partial until those
are done. They are not marked complete on the strength of the automated checks.
