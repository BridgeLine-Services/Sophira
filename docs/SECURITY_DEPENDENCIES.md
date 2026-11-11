# Dependency security status

This file records the remediation state of every reported dependency advisory, including
the one that **cannot** be fixed yet. It is kept honest by `tests/dependency-versions.ts`:
if a vulnerable range returns to `package-lock.json`, or if this document loses the glib
record, the test suite fails.

Last reviewed: **2026-11-09** at `master` `770755b` (npm tree: 456 packages after `npm ci`, 0 audit findings).
Upstream Rust status re-verified: **2026-11-09**.

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

## 3. glib (Rust, `src-tauri/Cargo.lock`) - **UNRESOLVED / BLOCKED UPSTREAM**

Status: **not fixed, not claimed fixed, not dismissed, not suppressed.** This section is the record
of why, and of exactly what would have to change before it can be fixed.

### The advisory

| | |
|---|---|
| Identifier | **RUSTSEC-2024-0429** / **GHSA-wrw7-89jp-8q8g** ("Unsoundness in `Iterator` and `DoubleEndedIterator` implementations for `glib::VariantStrIter`") |
| Affected versions | **`>=0.15.0, <0.20.0`** |
| Patched version | **`0.20.0`** |
| RustSec class | `informational = "unsound"` (undefined behaviour; the demonstrated failure is a `NULL`-dereference crash) |
| Nature of the defect | `VariantStrIter::impl_get` passed a `*mut` out-argument as `&`; newer rustc optimisations disregard the write, so the C string pointer stays `NULL` |

### The exact version pinned today

`src-tauri/Cargo.lock` at `master 770755b` pins **`glib 0.18.5`**, with **`glib-sys 0.18.1`** and
**`glib-macros 0.18.5`**.

### The exact dependency chain that brings it into the Linux desktop build

Read directly from `src-tauri/Cargo.lock` (not inferred):

```
tauri 2.12.0
├── gtk 0.18.2 ──────────────► glib 0.18.5  (also glib-sys)
│   ├── gdk 0.18.2 ──────────► gio 0.18.4, pango 0.18.3, glib 0.18.5
│   ├── gio 0.18.4 ──────────► glib 0.18.5
│   ├── pango 0.18.3 ────────► glib 0.18.5
│   ├── atk 0.18.2 ──────────► glib 0.18.5
│   └── gtk-sys 0.18.2 ──────► glib-sys 0.18.1
├── webkit2gtk 2.0.2 ────────► glib 0.18.5, glib-sys, gtk 0.18.2, gdk 0.18.2, gio 0.18.4
└── tauri-runtime-wry 2.12.0
    └── wry 0.57.0 ──────────► gtk 0.18.2, webkit2gtk 2.0.2
```

Every path into glib goes through the gtk-rs **0.18** generation, which the whole Tauri 2.x line
pins. There is no second, independent path.

### Upstream status (verified 2026-11-09, not assumed)

| Question | Answer |
|---|---|
| Is there a published glib 0.18.6 with the fix? | **No.** `https://crates.io/api/v1/crates/glib/0.18.6` returns **404**. |
| What did the 0.18 backport do? | gtk-rs PR **#1991** ("glib: fix UB in `VariantStrIter::impl_get`") — **closed 2026-06-24, not merged**. |
| And the release request? | gtk-rs issue **#2010** ("Release glib 0.18.6 with the `VariantStrIter` soundness fix") — **closed 2026-07-31** with no 0.18.6 release. |
| Does the fix exist at all? | Yes, only in the **0.20+** line. Current published glib is **0.22.10** (2026-09-19). The 0.18 line stops at 0.18.5. |
| Tauri's position | tauri issue **#12564** ("Reach Out to `gtk-rs` for Potential `glib` Upgrade") — **closed 2026-07-03**. |
| Does current stable Tauri avoid it? | **No.** `tauri 2.12.5` (latest stable) still depends on `gtk ^0.18` and `webkit2gtk ^2`; `wry 0.57.2` requires `gtk ^0.18` and `webkit2gtk =2.0.2`; the newest `webkit2gtk` crate is **2.0.2** (2025-12-16). |
| Would the Tauri 3 preview help? | **Not yet.** `tauri 3.0.0-alpha.6` (2026-11-06) **still requires `gtk ^0.18`**. |

**Conclusion:** no compatible, published dependency combination resolves glib to `>=0.20.0`. Forcing
it would place gtk-rs 0.18 and 0.20 in the same binary, which does not compile. Per the remediation
brief, no lockfile edit, `[patch.crates-io]`, direct glib dependency, vendored fork, Tauri major
upgrade, desktop-feature removal, audit ignore rule or alert dismissal was performed.

### Does Sophira call the affected API?

Search across the repository (`VariantStrIter`, `array_iter_str`):

- **`VariantStrIter` — no matches.**
- **`array_iter_str` — no matches.**

The desktop shell contains three Rust files (`src-tauri/build.rs`, `src-tauri/src/lib.rs`,
`src-tauri/src/main.rs`); it opens the hosted Sophira site and does not read GVariant string
iterators. Untrusted member content (documents, mail, web pages, media) is processed in the web
application, never in the native shell.

**This lowers exposure. It does not remove the vulnerable package and it does not close the
alert.** Dependabot will keep reporting it until the dependency graph actually resolves `>=0.20.0`.

### Exposure, and who is affected

Linux desktop builds only (GTK/GLib). Windows (WebView2) and macOS (WKWebView) do not use glib, so
those artifacts are unaffected. The demonstrated failure mode is a crash through undefined
behaviour inside GVariant string iteration, not remote code execution and not data disclosure.
The web application, which is the primary delivery path, is entirely unaffected.

### Conditions that must be met before this can be upgraded

Either of:

1. **gtk-rs publishes `glib 0.18.6`** containing the RUSTSEC-2024-0429 backport (currently refused:
   PR #1991 closed, issue #2010 closed), **or**
2. **A Tauri release resolves glib `>=0.20.0`** — that means Tauri (2.x patch/minor, or 3.x once it
   is stable) moving to gtk-rs 0.20+, which also requires a `webkit2gtk` release built on it
   (latest is 2.0.2 on gtk 0.18).

Then, in one reviewed change:

1. `cd src-tauri && cargo update -p glib` (let Cargo regenerate `Cargo.lock`; never hand-edit it);
2. `cargo tree -i glib` shows **`>=0.20.0`**;
3. `cargo tree -d` shows a **single** gtk-rs generation (no gtk 0.18 and 0.20 side by side);
4. `cargo check --locked` passes;
5. `cargo audit` reports **no** RUSTSEC-2024-0429;
6. Linux desktop build passes, and Windows/macOS builds pass because shared Tauri dependencies
   changed;
7. the built desktop application launches and loads the configured Sophira URL;
8. only then is Dependabot #4 dismissed, with the build evidence attached.

### What has NOT been verified here, and why

`cargo` and `rustc` are **not installed** in this environment, so the following were **not run**
and are **not claimed**:

- `cargo tree -i glib`, `cargo tree -d`, `cargo metadata --locked`
- `cargo check --locked`, `cargo audit`
- any native Linux, Windows or macOS desktop build (those are built by
  `.github/workflows/release.yml`, which runs only on `v*` tags and was not triggered)

The chain and version numbers above were read directly from `src-tauri/Cargo.lock`, and the
upstream facts from crates.io and the GitHub API on 2026-11-09.

### Upstream references for the next maintenance pass

- `https://rustsec.org/advisories/RUSTSEC-2024-0429.html`
- `https://github.com/advisories/GHSA-wrw7-89jp-8q8g`
- `https://github.com/gtk-rs/gtk-rs-core/pull/1991` (closed, unmerged)
- `https://github.com/gtk-rs/gtk-rs-core/issues/2010` (closed, no 0.18.6)
- `https://github.com/tauri-apps/tauri/issues/12564` (closed)
- `https://crates.io/crates/glib/versions` (0.20+ line only)

## Verification actually performed (2026-11-09, on `master` after the merge)

| Check | Result |
|---|---|
| `npm ci` (clean install from the lockfile) | 456 packages, completed |
| `npm audit --audit-level=low` | **0 vulnerabilities** |
| `npm ls minimatch` | `11.0.1 overridden` (typescript-estree), `11.0.5` (glob path); eslint keeps its own `3.1.5` |
| `npm ls glob` | `glob@14.0.4` via `rimraf@6.1.4` |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 33 warnings (ceiling 33, tightened 2026-11-11) |
| `npm test` (offline suite) | **5978 / 5978** at `770755b`; **6012 / 6012** with the CodeQL #43 fix applied |
| `npm run build` | production build succeeded |
| `npm run smoke:runtime` (live server, production build) | **SMOKE PASS 100/100**, including fail-closed redirects for every signed-out page and a refusal for every editor write route |
| CodeQL on the merge PR (`Analyze (javascript-typescript)`, `Analyze (actions)`, `Analyze (java-kotlin)`, `Analyze (rust)`) | all four **success** (2026-11-11); **no annotations** - no new alerts in the changed files |
| CodeQL overall check | `neutral`, only because two stale `java-kotlin` / `rust` analysis configurations registered on `master` by older workflow versions are reported missing; those languages are not in `codeql.yml` |
| `cargo tree -i glib` | **not run** (cargo absent from this environment) |
| `cargo audit` | **not run** (cargo absent) |
| Linux / Windows / macOS native builds | **not run** here; built by `.github/workflows/release.yml` on `v*` tags |
| Reading alert states from the API | **blocked**: `/code-scanning/alerts` and `/dependabot/alerts` return 403 for a token without `security_events`. Closure of individual alert numbers therefore has to be read on the repository's Security tab. |

### Why the individual alert numbers are not marked closed here

Dismissing an alert without evidence is exactly what this phase was told not to do, so the
alerts were left alone. The evidence that they are resolved is the scan itself: the files the
alerts pointed at were all changed, and CodeQL reports **no findings** in them. The Security tab
is the authoritative list.

## CodeQL language coverage (2026-11-11)

The analysis matrix previously listed only `javascript-typescript` and `actions`, while the
repository still ships its native shells. Both are now scanned, each with `build-mode: none`
(no Android SDK, no Gradle, no Tauri build required):

| Language | Source | Why |
| --- | --- | --- |
| `java-kotlin` | `android/app/src/**` (3 files) | Capacitor `MainActivity` plus the instrumentation and unit tests |
| `rust` | `src-tauri/src/{main,lib}.rs`, `src-tauri/build.rs` | the Tauri desktop shell and its build script |

Known gap: `ios/App/App/AppDelegate.swift` is still not analysed. CodeQL Swift requires a
macOS runner, which this repository does not use; adding one is a separate, deliberate change
rather than a silent omission.
