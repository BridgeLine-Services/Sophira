# Sophira — Test Report

Date: 2026-09-24 (upgrade round 2) · Next 14.2.35, strict TypeScript · `npm test` + `npm run build`

## 1. Automated tests — ✅ 91 / 91 PASSED (`npm test`, fully offline)

| Area | Assertions | Result |
|---|---|---|
| Teacher isolation (Teacher A's rules never enter Teacher B's context) | 6 | ✅ |
| Course isolation (course rules only when selected) | 3 | ✅ |
| Writing-profile conditionality (math never loads it; writing does) | 4 | ✅ |
| Source conflicts (dates, archiving resolves, same-date not flagged) | 5 | ✅ |
| Prompt-injection defense incl. NEW patterns (profile change, exfiltration, teacher-rule override, privacy probe) | 8 | ✅ |
| Subject routing (9 workflows, machine-verifiable flags honest) | 12 | ✅ |
| **NEW** Typed math verification: 6 kinds — evaluate, symbolic simplify, symbolic derivative, equation identity at sample points, matrix det/product, statistics; wrong claims fail; malformed input fails honestly; kinds deduplicated | 19 | ✅ |
| **NEW** Fine-grained math topic routing (15 workflows) | 13 | ✅ |
| **NEW** Method compliance: valid normalization; claimed-compliant-with-failed-check demoted to partial (honesty guard); malformed → "NOT checked", never a fabricated pass | 6 | ✅ |
| Scope inheritance wording (global → course → teacher overrides) | 3 | ✅ |
| **NEW** DOCX structure extraction (headings, question numbering, tables) + CSV | 4 | ✅ |
| **NEW** XLSX round-trip (built in memory with the app's own library, parsed back: sheets, cells, honest notes) | 3 | ✅ |
| **NEW** PPTX round-trip (minimal deck built with JSZip: slide title, body, speaker notes) | 3 | ✅ |
| **NEW** Edge-case regressions (unclosed regex fixed → suite green) | 2 | ✅ |

## 2. Build verification

| Check | Result |
|---|---|
| `tsc --noEmit` strict full-project typecheck | ✅ 0 errors |
| `npm run build` — 30 routes | ✅ |
| PWA assets resolvable | ✅ build-time |

## 3. What is implemented vs. verified — honest status legend

- **Implemented**: code exists, typechecks, builds.
- **Unit/integration tested**: runs in `npm test` (offline).
- **Live tested**: executed against a real deployed backend — **not yet done**.
- **Not verifiable here**: needs real devices (PWA) or external credentials.

## 4. Live acceptance scenarios — BLOCKED on deploy credentials

The sandbox has no Supabase project, no AI key, and no physical devices.
Per `docs/ACCEPTANCE_TESTS.md` (10 sections, ready to run):

| Scenario group | Status |
|---|---|
| Auth, courses, teachers, assignments, writing conditionality | 🔶 Implemented + logic unit-tested; live run pending |
| Method compliance + independent verification end-to-end | 🔶 Engine unit-tested (all 6 kinds); live model-output flow needs AI key |
| Feedback → proposal → approval → versioning → rollback | 🔶 Pure parts unit-tested; live flow needs backend |
| Cross-student isolation | ✅ RLS reviewed + app-layer isolation unit-tested; live DB probe pending |
| PPTX/XLSX/CSV/handwriting uploads | ✅ Parsers round-trip tested offline; live upload flow pending |
| PWA on Android/iPhone/iPad/desktop at 360/390/430px+ | 🔶 Architecture in place; real-device testing NOT performed |

## Known limitations (honest)

- `machine_checks` verify identities the model derives from its own steps —
  genuine independent recomputation, not a proof the method or setup was right.
  Method compliance is a separate, clearly-labeled AI self-check.
- Proof-based math cannot be machine-verified; the workflow says so.
- XLSX formulas read as computed values; embedded charts read as data only.
- `.ppt`/`.xls` legacy binaries unsupported (honest error offered; .pptx/.xlsx fine).
- PPTX/DOCX images and diagrams are counted and named, not read.
- No live testing of any kind has occurred in this build environment.
