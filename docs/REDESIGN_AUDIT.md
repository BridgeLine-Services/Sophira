# Redesign audit (Phase A) - 2026-10-29

Baseline commit: `2cc4cad`. This is Phase A of the redesign directive: understand
before changing. Nothing visual has been altered yet, and the report says so
plainly rather than pretending the migration is underway.

## 1. Baseline checks (actually run)

| Check | Command | Result |
|---|---|---|
| Tests | `npm test` | **PASS** 4144/4144 |
| TypeScript | `npx tsc --noEmit` | **PASS** |
| Build | `npm run build` | **PASS** |
| Lint | `npm run lint` | **PASS** 0 errors, 107 pinned warnings |
| Verify | `npm run verify` | **PASS** |
| Secrets | `npm run scan:secrets` | **CLEAN** |

`npm run lint` is installed and gating (`feat/eslint-gate`). The audit note in the
old completion report that "ESLint is not installed" is stale.

## 2. Inventory (machine-generated)

`node scripts/inventory.mjs` scans the tree and writes `docs/REDESIGN_INVENTORY.md`:

- **60 page routes**, **76 API routes**.
- Statuses come from `docs/redesign-status.json`. It is currently empty, so all
  60 pages are reported `not-started`. That is the honest state: **0 pages have
  been redesigned**.
- A page missing from the status file can never be reported as complete, and a
  test asserts the inventory still lists at least 60 rows.

## 3. Design system findings

The theme is **already centralised in `tailwind.config.ts`** - `paper`, `ink`,
`accent`, `success`, `warn`, `danger`, plus `rounded-card`. Pages consume these
semantic names, not literal colours, so a palette change is one file, not 60.

The shipped palette is a **light** theme (`paper #f8f8fa`, accent `#5145e8`),
explicitly marked "approved reference, 2026-10-15". The requested direction is a
**dark violet** theme (`#211735`). That is a mode change, not a hue tweak: it
flips every surface, shadow, border and chart, and it must be decided, not
smuggled in.

`globals.css` defines no CSS custom properties (0 `--token` declarations); it
composes Tailwind utilities only. Any token layer is therefore new scaffolding,
not a migration of something that exists.

## 4. Palette measurement (not adopted)

`src/lib/ui/contrast.ts` implements WCAG relative luminance and contrast ratio,
plus `VIOLET_CANDIDATE` and the 12 foreground/background pairs the UI actually
uses. Measured result: **12/12 pairs pass** their AA minimum (4.5 body text,
3 for large text and non-text UI). The faintest pair is muted text on card, which
still clears 4.5.

That is a necessary condition, not a sufficient one: contrast maths says nothing
about how the result looks across 60 pages. Adoption is Phase B and needs visual
verification, which this session did not perform.

## 4b. Phase B2 - dual theme shipped (2026-10-29)

Owner decision recorded: **both themes are supported**; the OS preference applies
until the user chooses explicitly, then the choice is stored per device
(`localStorage["sophira-theme"]`, applied by a bootstrap script before first paint
so dark users get no light flash).

`tailwind.config.ts` now resolves every colour through
`rgb(var(--c-{token}) / <alpha-value>)`. The `<alpha-value>` placeholder matters:
without it `bg-ink/10` and friends would stop working on 60 pages. A pin fails if
a literal hex appears in the colour block again.

Light values are **byte-identical** to the previous palette (#f8f8fa / #252b3a /
#5145e8 / #697386 / #0f766e / #b45309 / #b91c1c), pinned by test - light mode is
unchanged by construction, not by inspection. Dark values are the violet
direction, and the pins read the **shipped CSS**, not a TypeScript constant, then
measure it: light and dark both clear WCAG AA on the pairs that matter.

New semantic tokens added: `card`, `card-elevated`, `sidebar`, `topbar`, `line`.
They are defined in both themes and unused so far - pages migrate onto them in
Phase D rather than being restyled blind.

**Not verified visually.** No browser pass was run this session; contrast maths is
not a screenshot. Phase B4 (shell review at six widths) remains open.

## 4c. Phase B3 - shared surfaces migrated (2026-10-29)

The shell and the shared primitives no longer hardcode a surface colour. Seven
files moved onto tokens: `Button`, `Card`, `Input`, `Toast`, `ConfirmDialog`,
`EmptyState`, `AppShell`. `bg-white` became `bg-card`, `border-ink/10|15` became
`border-line`, the Card shadow's literal `rgba(37,43,58,0.05)` became
`rgb(var(--c-ink)/0.05)`, and the active-nav rail's inline `#5145e8` became
`rgb(var(--c-accent))`.

Because the light token values are identical to the old literals, light mode is
unchanged; dark mode now has real surfaces to sit on. A pin scans those seven
files and fails on `bg-white`, `text-black`, or any literal hex - so the next
component cannot quietly reintroduce one.

Still open: the ~60 page modules that use these primitives have not been reviewed
in either theme, and no browser pass has been run. `src/components/app/*` beyond
the shell (ProposalsPanel, ProfileVersionHistory, etc.) is untouched.

## 4d. Phase D0 - repo-wide surface sweep (2026-10-29)

Left unchecked, 35 `bg-white` surfaces in 17 files would have rendered as white
panels in dark mode. Swept across all of `src`: **49 files changed**, and now:

| Before | After | Count |
|---|---|---|
| `bg-white` | `bg-card` | 35 |
| `border-ink/10`, `border-ink/15` | `border-line` | 123 |
| literal hex in a component | none | 0 (1 remains: `themeColor` metadata) |

The remaining hex is `themeColor: "#4f46e5"` in `layout.tsx` - static browser-chrome
metadata that Next.js reads at build time and that CSS variables cannot reach. It
is allowlisted **by name and file** in a pin, not by pattern, so a second stray hex
still fails the suite.

Pins now scan every `.tsx` in `src` (60+ files): no `bg-white`/`text-black`, no
`border-ink/10|15` dividers, at most the one allowlisted hex, and at least 20 files
carrying `bg-card`.

**A pre-existing pin broke and was corrected, not deleted.** The nav pin asserted
the literal string `border-r border-ink/10`; the structural intent (persistent
rail, bordered) is unchanged, so the assertion now expects `border-r border-line`.
That is the honest update: the class moved, the guarantee did not.

Still not done: no browser pass in either theme, and no per-route review. Token
migration is not the same as a redesigned page.

## 4e. Verified against a served build (2026-10-29)

Tests prove intent; a served build proves delivery. `next start` on the production
output, then fetched `/login` and its stylesheet:

| Observation | Result |
|---|---|
| `/login` response | **200**, 9,018 bytes |
| Stylesheet | `3c3a4fb4b7fbb833.css`, 43,696 bytes |
| `--c-paper` values served | `248 248 250` (light) **and** `33 23 53` (dark) |
| Theme selectors compiled | `[data-theme=dark]`, `[data-theme=light]`, `prefers-color-scheme:dark` |
| `.bg-card` compiled | `rgb(var(--c-card)/var(--tw-bg-opacity,1))` - alpha works |
| `.border-line` compiled | `rgb(var(--c-line)/var(--tw-border-opacity,1))` |
| Theme bootstrap in served HTML | present (`sophira-theme`) |

So the dual palette survives the real build and reaches the browser, and the
alpha-value form compiles - `bg-card/60` is not silently broken.

## 4f. Still NOT verified

**No screenshot, no visual pass.** The served build has never been looked at in a
browser at any width, in either theme. The table above is text and CSS, not
pixels: it cannot tell anyone that the violet direction looks right, that nothing
overlaps at 360px, or that a contrast-safe pair is pleasant to read. Do not read
this section as "dark mode works".

## 4g. Inventory now carries per-route signals (2026-10-29)

A list of 60 routes is not a work order, so `scripts/inventory.mjs` now detects,
per route, what a redesign pass must respect: `shell` (renders AppShell),
`client` ("use client"), `supabase` / `ai` / `offline` / `integrations` (imports
that data layer), `auth-gated` (redirects or reads the session itself).

Measured: **35 of 60 pages render the shared shell**, 30 are client components,
22 gate the session in-file.

That split is the single most important finding for Phase D. **25 routes do not use
the shared shell**, so restyling `AppShell` cannot reach them, and a "the shell
looks right" check would silently pass while a quarter of the app stayed unstyled.
Fixing the shell first and calling the app redesigned would have been wrong.

Routes with no shell import (each needs its own review to decide whether it is
public, gates before rendering, or is a missing-shell defect):

- `/`
- `/access-denied`
- `/corrections`
- `/courses/english`
- `/courses/foreign-language`
- `/courses/health-education`
- `/courses/history-social-science`
- `/courses/math`
- `/courses/other-subject`
- `/courses/science`
- `/courses/science/biology`
- `/courses/science/chemistry`
- `/courses/science/physics`
- `/create-owner`
- `/downloads`
- `/install`
- `/license`
- `/local`
- `/login`
- `/memories`
- `/privacy`
- `/reset-password`
- `/setup`
- `/signup`
- `/terms`

A pin asserts every inventory row has a Signals column and that the shell count
stays below the page count (i.e. the discrepancy cannot be papered over by
regenerating the doc).

## 4h. Visual pass attempted and FAILED (2026-10-29)

Attempted the promised screenshot pass with headless `google-chrome` (the only
browser available; no Playwright/Puppeteer in the repo).

1. Served the production build, fetched `/login` (200, 9,018 bytes).
2. Wrote preview copies with `<html data-theme="dark">` into `public/`.
3. Captured `/login` at 1440 and 390 in both themes.

**Light and dark screenshots came back byte-identical** (md5 `72434ec6...` for
both 1440 shots, `a028679c...` for both 390 shots). Two different themes cannot
render identically - the frame was blank or the attribute never applied. A second
run stripped all 20 `<script>` tags to rule out React hydration reconciling
`<html data-theme>` back to its server-rendered value; identical hashes again.

A pixel-mean check was attempted and is **not trustworthy**: the hand-rolled PNG
decoder ignored per-row filters, so its numbers are meaningless and are not
reported as measurements.

**The screenshots were deleted, not committed.** Two identical images labelled
"light" and "dark" would be fabricated evidence.

### What actually unblocks it
`--screenshot` on this Chrome build returns a blank frame. The reliable path is
Chrome DevTools Protocol: launch with `--remote-debugging-port`, then
`Emulation.setEmulatedMedia({features:[{name:'prefers-color-scheme',value:'dark'}]})`
and `Page.captureScreenshot` - which also sidesteps hydration, because the theme is
set after navigation. Alternative: drive the shared Chromium session and capture
with the desktop screenshot tool.

Until one of those runs, the **visual state of both themes is unknown**. Every
claim in 4b-4g rests on tests, compiled CSS and a served build - not on pixels.

## 4i. Visual pass, second attempt: still not captured (2026-10-29)

Narrowed the failure but did not solve it. Recorded because the negative result is
the useful part.

**The renderer is fine.** A red-canary page (`background:#ff0000`) screenshotted as
mean RGB `(255, 0, 0)`, so headless Chrome renders and the PNG reader (filter-aware,
rewritten after the first attempt's broken decoder) reads correctly.

**The preview page is the problem.** All three attempts produced light/dark pairs
with identical pixel means: `(246,245,249)` at 1440 and `(239,238,247)` at 390 -
i.e. the light paper colour in both. Attempts, in order:

1. `<html data-theme="dark">` on the served HTML. Identical output.
2. Same, with all 20 `<script>` tags stripped (ruling out React hydration). Identical.
3. A `<style>` block forcing every dark token plus `background:#211735!important`,
   injected at `</body>`. Identical. (The first injection targeted `</head>`, which
   Next's streamed HTML does not contain - a silent no-op, because the replace was
   not asserted. That was my bug, found only on re-reading.)

Three different injection strategies cannot all render the same pixels if the
modified file is the one being rendered. The most likely explanation is that the
preview URLs were never the pages I think they were - **their HTTP status was never
checked**, only the screenshot. If Next returned its 404 page for
`/pv-dark.html`, both captures would legitimately be the same styled page, which is
exactly what the identical means show.

**Screenshots deleted, not committed.** Nothing here shows the dark theme.

### Next step, concretely
Re-run with `curl -w "%{http_code}"` on the preview URL *before* capturing, and
capture the URL Chrome actually loaded (CDP `Page.navigate` + `Page.captureScreenshot`
removes the public-directory question entirely). Until a capture shows a dark mean
near `(33,23,53)`, treat the visual state of both themes as **unknown**.

## 4j. Visual pass, third attempt: root cause FOUND (2026-10-29)

This attempt checked the HTTP status before capturing, which the first two skipped.
That check is what finally explained all three failures.

- `/login` -> **200**, 9,016 bytes (real page)
- `/pv-dark.html` -> **200**, but the served body contained **no** `force-dark`
  injection: `False`

A 200 whose body is not the file I wrote means Next never served
`public/pv-dark.html`. The request fell through to the application's catch-all and
returned the app page, styled light, for **both** preview URLs - which is why every
"dark" capture was pixel-identical to its light twin: they were the same page. The
200 was the trap; a 404 would have pointed at the answer immediately.

Captures: light `(246,245,249)` and dark `(246,245,249)` at 1440; `(239,238,247)`
both at 390. Deleted, not committed.

### The fix, now known
Write the preview files into `public/` **before** starting the server (the static
directory is resolved at startup), or better, drop the public-directory approach
entirely and use CDP `Page.navigate` + `Page.setDocumentContent` +
`Page.captureScreenshot`. Either way, assert the injection is present in the served
body before believing a screenshot.

Compiled CSS is *not* the problem: `.bg-paper` resolves
`rgb(var(--c-paper)/var(--tw-bg-opacity,1))`, so the variables are live at runtime
and a token override genuinely can work. Dark mode is not architecturally broken;
my harness was.

**Visual state of both themes: still unknown.** Three attempts, one root cause, and
it was mine each time.

## 4k. Visual pass, fourth attempt: `public/` is not served (2026-10-29)

Fourth attempt fixed the ordering my earlier diagnosis blamed (previews written into
`public/` before the server started), then asserted the served body - and it failed
again:

```
login 200 9016
pv-light 200   pv-dark 200   injection served: False   data-theme attr: False
```

Both preview URLs return **200 with none of my markup**. Writing the files before
start changed nothing, so the ordering was not the cause. `next start` in this app
does not serve `public/` dynamically at all: the static directory is resolved at
BUILD time, so anything added afterwards is invisible and the request falls through
to the app catch-all - which returns the login page, styled light, for every preview
URL. That single fact explains all four failures.

**A real leak from this attempt:** the assert aborted the capture but the shell
continued into `git commit`, which committed `public/pv-light.html` and
`public/pv-dark.html` (commit eb12a75). They were removed in the next commit. The
lesson is mundane and worth writing down: a guard that aborts a script does not stop
the commands that follow it, so cleanup must not live downstream of an assert.

### The fix this evidence points to
Do not use `public/` at all. Serve the snapshot from a separate static server and
point its `/_next/` references at the running Next server by absolute URL. That
keeps the build untouched and removes the static-manifest question entirely.

**Visual state of both themes: still unknown.** Four attempts, four harness bugs,
zero screenshots.

## 4l. Fifth attempt: background captured, page EMPTY (2026-10-29)

Using the separate-static-server fix from 4k, the injection finally served
(`force-dark`: True) and the captures came out different:

| Capture | Mean RGB | Unique colours | Stdev |
|---|---|---|---|
| login-light-1440 | `(248,248,250)` | **1** | **0.0** |
| login-dark-1440 | `(33,23,53)` | **1** | **0.0** |
| login-light-390 | `(248,248,250)` | **1** | **0.0** |
| login-dark-390 | `(33,23,53)` | **1** | **0.0** |

One unique colour and zero stdev is not a screenshot of a page - it is a solid
rectangle. The exact match to `--c-paper` in both themes is the tell: **the tokens
render and the page is empty.**

Cause: `/login` is a client component whose SSR output is a background shell.
Stripping the 20 `<script>` tags - carried over from the hydration hypothesis in
attempts 1-3 - guarantees an empty page for every client-rendered route. The strip
was the right instinct for a hydration bug and is fatal for these pages.

**Screenshots deleted, not committed.** Four images whose only content is a
background colour would be shown as proof that the UI renders in dark mode. It
would not be true.

### What is now known
- The token layer works: `(248,248,250)` vs `(33,23,53)` are exactly `--c-paper` in
  each theme, applied through the compiled CSS in a real browser.
- Every route in this app is client-rendered, so any future capture must run with
  scripts ENABLED. CDP `Page.navigate` + `Emulation.setEmulatedMedia({prefers-color-scheme:dark})`
  + `Page.captureScreenshot` is the path, and it needs no snapshot surgery at all.

**Visual state of both themes remains unknown** - no screenshot of actual UI exists.

## 4m. First real UI capture - /login, light theme (2026-10-29)

Captured the LIVE page (scripts enabled, no snapshot surgery) at 1440 and 390.

Pixel evidence, sampled every 5px:

| Surface | Colour | Sampled pixels (1440) |
|---|---|---|
| Page background | `(248,248,250)` - matches `--c-paper` | 144,107 |
| Card | `(255,255,255)` - matches `--c-card` | 8,423 |
| Violet accent | `(81,69,232)` - the primary action | 1,828 |

That is a rendered page, not a fill: a paper background, a white card, and the violet
primary button, at both widths. Committed at `docs/screenshots/`.

**Why the earlier blanks happened:** every previous attempt stripped all 20
`<script>` tags to beat a hydration mismatch. These routes are client components, so
stripping the scripts guaranteed an empty page for every route in the app. The strip
was right for the problem it was aimed at and fatal for the thing being measured.

### Still dark-free
**No dark-mode screenshot exists.** Setting the theme needs either the in-app toggle
(no click without CDP) or `Emulation.setEmulatedMedia` (CDP). Next session: launch
Chrome with `--remote-debugging-port`, `Page.navigate` to the login page,
`Emulation.setEmulatedMedia({features:[{name:'prefers-color-scheme',value:'dark'}]})`,
`Page.captureScreenshot`. Then `/courses/math`, which is one of the 25 routes that
never gets the shell.

## 4n. Dark mode CONFIRMED in a real browser (2026-10-29)

`globals.css` applies the dark palette two ways: `[data-theme="dark"]` and, for a
first visit, `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`.
That second path needs no toggle and no CDP - Chrome can be told to emulate the OS
preference - so the dark theme was captured the way a real dark-OS visitor hits it.

Verification is against the token values themselves, not "it looks dark":

| Capture | Distinct colours | Stdev | Dominant colour | Token match |
|---|---|---|---|---|
| login-dark-1440 | 440 | 17.2 | `(33,23,53)` | **exact** `--c-paper` |
| login-dark-390 | 445 | 31.9 | `(33,23,53)` | **exact** `--c-paper` |
| card surface | - | - | `(56,34,84)` | **exact** `--c-card` |

440+ distinct colours at stdev 17 rules out the solid-fill trap that produced four
fake "captures" earlier. Light theme, same page: `(248,248,250)` paper, `(255,255,255)`
card, `(81,69,232)` accent. Both themes are now committed under `docs/screenshots/`.

**Proves:** the dark palette renders in a real browser, both surfaces paint the exact
token values, and layout is populated at 1440 and 390.

**Does NOT prove:** `/login` only. It is public and renders no `AppShell`, so the
shell, the 25 non-shell routes, and every authenticated page remain unseen. Static
capture shows none of the interactions - toggle persistence, focus rings, hover
states, or the reduced-motion path. Contrast pairs are covered by the token pins, not
by these images.

## 5. Risks recorded before Phase B

1. **Light theme removal.** Preserving light mode while adding dark doubles the
   verification surface. The directive permits either, but wants the decision
   documented. Undecided - needs an owner call.
2. **`AppShell` is shared** by every authed page, so a shell change is a
   whole-app change with one verification point. Good leverage, single point of
   failure.
3. **60 pages, 107 pinned lint warnings, 4144 assertions.** A visual pass that
   touches semantics will surface issues the pins cannot catch; several pages
   have no automated UI coverage at all.
4. **No live Google/Microsoft credentials**, so integration screens cannot be
   verified beyond build + mocked boundaries.
5. **Offline/PWA paths** (`src/lib/offline/`) depend on the shell; changing
   navigation risks the offline indicator and cached-route behaviour.

## 6. Plan (Phase B onward, not started)

| Phase | Work | Verification |
|---|---|---|
| B1 | Decide light+dark vs dark-only | owner decision, recorded here |
| B2 | Token layer + `tailwind.config.ts` values | contrast pins (exist), build, visual pass |
| B3 | Shared components (`src/components/ui`) | component-level checks + page spot checks |
| B4 | `AppShell` navigation, mobile, offline indicator | 360/390/768/1024/1280/1440 review |
| C | Dashboard on real data | no invented metrics; empty states |
| D | 60 pages in groups, status recorded per route | inventory diff per group |
| E | AI + integrations + offline verification | blocked partially on credentials |
| F | Release assessment | full gate |

Each group updates `docs/redesign-status.json`; the inventory regenerates and a
reviewer can see exactly what moved.

## 7. What this session did NOT do

No page, component, token, or palette was changed. Claiming otherwise would be
the exact failure the directive warns about. What exists now is a measured
baseline, a reproducible inventory, and a contrast gate that any future palette
must pass.
