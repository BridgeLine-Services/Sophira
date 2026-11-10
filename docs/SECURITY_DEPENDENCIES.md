# Dependency security status

This file records the remediation state of every reported dependency advisory, including
the one that **cannot** be fixed yet. It is kept honest by `tests/dependency-versions.ts`:
if a vulnerable range returns to `package-lock.json`, or if this document loses the glib
record, the test suite fails.

Last reviewed: **2026-11-09** at `master` `1813a01` (npm tree: 455 packages, 0 audit findings).

---

## 1. minimatch (npm) — FIXED

**Advisory:** globparts amplification in minimatch. Affected range **>=7.0.0 <11.0.1**.

**Where it was.** Two different copies existed, and they are not the same problem:

| Path | Version | Verdict |
|---|---|---|
| `node_modules/minimatch` (hoisted; used by `@typescript-eslint/typescript-estree@8.72.1` → `^10.2.2` and `glob@13` → `^10.2.2`) | 10.2.6 | **vulnerable, fixed** |
| `node_modules/eslint/node_modules/minimatch`, `@eslint/eslintrc/...`, `@eslint/config-array/...` | 3.1.5 | outside the affected range, **left alone** |

**Remediation.** An npm override, resolved by the package manager (no hand-edited lockfile
entries):

```json
"overrides": { "minimatch@>=10.0.0 <11.0.0": "11.0.1" }
```

Both parents declare `^10.2.2`, so this is a deliberate, recorded override rather than a
version the tree would choose on its own. The 3.x copies are untouched because the advisory
does not cover them; forcing every minimatch to 11 is exactly the "blindly override every
version" mistake the brief warns about.

**Compatibility.** minimatch 11 requires Node 18/20/>=22; CI runs Node 22 and this sandbox runs
Node 20. eslint, `@typescript-eslint/parser`, `@capacitor/cli` and the full test suite were run
against 11.0.1 (see the verification table in the PR).

**Verified:** `npm ls minimatch` shows `11.0.1 overridden` for `typescript-estree` and
`11.0.1 deduped` under `@capacitor/cli → rimraf → glob`. `npm audit` no longer reports it.

---

## 2. glob (npm) — FIXED (found during this remediation, not in the original list)

**Advisory:** GHSA-3g3m-2fjr-6pw4, "AbortSignal cancellation bypass allows post-timeout
filesystem traversal". Affected range **>=9.0.0 <=14.0.1**, patched **14.0.2**.

**Where it was.** `@capacitor/cli@8.4.3` → `rimraf@6.1.3` → `glob@13.0.6`.

**Remediation.** `rimraf@6.1.4` depends on `glob@^14.0.3`, and `@capacitor/cli` accepts
`rimraf@^6.0.1`, so the fix is a within-range bump of the parent, expressed as an override:

```json
"overrides": { "rimraf@>=4.2.0 <=6.1.3": "6.1.4" }
```

Resolution is now `rimraf@6.1.4 → glob@14.0.4`. `npm audit` reports **0 vulnerabilities**.

**Scope note:** this entire chain is `devDependencies` (a native-shell CLI), not shipped to
members. It was fixed anyway because a clean audit is a signal that stops people reading it.

---

## 3. glib (Rust, `src-tauri/Cargo.lock`) — **NOT FIXED. Blocked upstream. This is documented, not resolved.**

**Advisory:** RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g — *unsoundness* in
`glib::VariantStrIter`'s `Iterator`/`DoubleEndedIterator` implementations (a `*mut` out-argument
passed as `&`), which newer rustc optimizations ignore, leading to undefined behaviour and
`NULL`-dereference crashes. Affected **>=0.15.0 <0.20.0**; patched **0.20.0**.
RustSec classifies it `informational = "unsound"`, not a remote code execution issue.

**Current pin:** `glib 0.18.5`.

**Dependency chain (read from `src-tauri/Cargo.lock`):**

```
tauri 2.12.0
├── gtk 0.18.2        → glib 0.18.5
│   └── gdk 0.18.2    → glib
└── webkit2gtk 2.0.2  → glib 0.18.5 (also glib-sys, gobject-sys, soup3, javascriptcore-rs)
    via wry → tauri-runtime-wry 2.12.0
```

**Why it cannot be upgraded in this repository.** glib 0.20.0 exists only in gtk-rs **0.20**.
Getting there means `gtk 0.20` + `gdk 0.20` + a `webkit2gtk` release built on gtk-rs 0.20, and
Tauri 2.x pins gtk-rs **0.18** across `tauri`, `wry` and `tauri-runtime-wry`. There is no
combination of currently released versions that resolves to glib 0.20.0. Forcing
`glib = "0.20"` into the lockfile would produce two incompatible gtk-rs generations in one
binary: it does not compile, and the brief explicitly forbids forcing an incompatible version.

**Exposure.** glib is the Linux GTK layer of the desktop shell. It is not used on Windows
(WebView2) or macOS (WKWebView), so Windows and macOS builds are unaffected. On Linux the
affected APIs are `VariantStrIter` iterator methods; the failure mode is undefined behaviour or
a crash inside GVariant string iteration, not remote code execution or data disclosure.

**Mitigation in place.** No Sophira code calls `VariantStrIter`. The desktop shell renders the
hosted app, and untrusted content (documents, email, web pages) is processed server-side, never
by the native shell. The desktop artifact remains unsigned-optional and is not the primary
delivery path (the web app is).

**Upgrade path.** When Tauri ships a release on gtk-rs 0.20 (tracked upstream in
`tauri`/`wry`), run `cargo update -p glib` in `src-tauri` and confirm `cargo tree -i glib`
resolves to >=0.20.0. Until then this stays an accepted, documented risk.

**What was NOT run here, and why.** `cargo` is not installed in this environment, so
`cargo tree -i glib`, `cargo audit`, and any native Linux/Windows/macOS build could **not** be
run. The chain above was read directly from `Cargo.lock`. The release workflow
(`.github/workflows/release.yml`) is what builds the native artifacts, and it has not been
executed for this change.

---

## Verification actually performed (2026-11-09)

| Check | Result |
|---|---|
| `npm ci` (clean install from lockfile) | 455 packages, completed |
| `npm audit --audit-level=low` | **0 vulnerabilities** |
| `npm ls minimatch` | `11.0.1 overridden`; eslint keeps `3.1.5` |
| `npm ls glob` | `glob@14.0.4` via `rimraf@6.1.4` |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors |
| `npm test` | see PR (full offline suite) |
| `npm run build` | production build succeeded |
| `cargo tree -i glib` | **not run** (cargo absent) |
| `cargo audit` | **not run** (cargo absent) |
| Linux/Windows/macOS native builds | **not run** here; built by the release workflow on `v*` tags |
