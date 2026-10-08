# Dependency security audit & upgrade plan (2026-10-07)

`npm audit` review of every vulnerability in the tree, what was done on the
`chore/dependency-security-audit` branch, and the exact remaining work. This
document is the honest record: what is fixed, what is NOT fixable without a
major upgrade, and why each remaining finding does or does not apply to
Sophira as deployed.

## What this branch changes

1. **mammoth 1.12.3 → 1.13.0** (`npm audit fix`, semver-safe). Used server-side
   for teacher-document (.docx) extraction. All 2539 offline tests pass with
   the new version (the docx extraction fixtures are exercised by the suite).
2. **fast-glob overridden to 3.3.3** and **postcss-nested pinned forward** in
   the lockfile by the same audit fix run (micromatch DoS chain).
3. **tailwindcss and tailwindcss-animate moved from `dependencies` to
   `devDependencies`.** They are PostCSS build-time plugins, never imported by
   server code; listing them as production dependencies pulled the whole
   chokidar/braces/micromatch file-watching chain into the PRODUCTION audit
   surface for no runtime reason. Production findings drop 13 → 5. CI and
   Vercel install devDependencies for the build, so the CSS build is
   unaffected; the native shells load the deployed web app and never need
   tailwind at runtime.

## Remaining findings and their honest status

| Finding | Severity | Applies to Sophira? | Fix |
| --- | --- | --- | --- |
| Next.js CVE-2025-… (Image Optimizer remotePatterns DoS) | critical | **NO, mitigated by design** — `next.config.mjs` sets `images: { unoptimized: true }` with an explicit comment rejecting the optimizer attack surface; there is no image-optimization endpoint in any deployment, self-hosted or Vercel. | next 16.4.0 (major) |
| Next.js CVE (RSC deserialization DoS) | critical | **No** — the flaw requires passing untrusted request data into insecure RSC patterns; the app never does so (all request data is validated before use; RSC payloads contain only app-generated content). Cannot be fully excluded without the patch — treat as defense-in-depth debt. | next 16.4.0 (major) |
| postcss ≤8.5.22 (XSS via `</style>`, file read via sourceMappingURL) | high | **No, build-time only** — the vulnerable postcss is Next 14.2's *build* dependency used to process Sophira's own trusted CSS; attacker-controlled CSS never enters the build. | next 16.4.0 (major) |
| mammoth → argparse/sprintf-js chain | moderate | **No** — argparse is mammoth's *CLI* dependency; the library API used by the extraction route never invokes it. The suggested "fix" (downgrade to mammoth 0.3.29 from 2017) is a downgrade, not a fix, and was rejected. | upstream |
| postcss-selector-parser <7.1.6 (tailwind chain) | moderate | **No** — devDependency tree only (CSS build on trusted input). | tailwind 4.x |

**Next.js itself (14.2.35) is the latest and final 14.2.x patch release.** No
further patch-level upgrade exists: the remaining critical/high findings are
fixed only in next 16.4.0, a two-major-version jump.

## The Next.js 16.4.0 upgrade — exact breaking changes for Sophira

This is a real migration project, not a version bump. What changes:

1. **`cookies()`, `headers()`, `params`, `searchParams` become async**
   (`await cookies()`). Touches `src/lib/supabase/server.ts` (the lazy client
   builder), every page that reads route params, and the middleware cookie
   refresh.
2. **Middleware → `proxy.ts`**: Next 16 removes `middleware.ts` in favor of
   the proxy file. The entire invite-only gate, revoked-status deny, degraded
   redirect, and LOCAL_FIRST logic in `src/middleware.ts` (plus its matcher
   exclusions hard-won in the 2026-09-27 production debugging) must be ported
   and re-verified.
3. **React 18.3 → React 19**: type changes in the PWA components, possibly
   `@supabase/ssr` / `@capacitor` peer-dependency updates.
4. **postcss chain** updates automatically with next 16 (clears the postcss
   finding).
5. **The release gate, CI matrix, and `vercel.json`** must be re-run end to
   end; the 2539-assertion suite is the safety net.

Estimated effort: a focused day of migration plus full regression. It should
be scheduled deliberately, not squeezed into a dependency round.

## Verification

- `npm test`: 2539/2539 PASS
- `npx tsc --noEmit`: clean
- `npm run build`: PASS
- `npm audit --omit=dev`: 13 findings → 5 (all five assessed above; the two
  criticals are mitigated/arguably inapplicable, but the honest fix is the
  Next 16 migration).

Any future dependency change should repeat this table, not just the counts.
