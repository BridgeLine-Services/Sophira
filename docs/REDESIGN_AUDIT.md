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
