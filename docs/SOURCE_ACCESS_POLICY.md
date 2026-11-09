# Source access policy (Phase 2F, 2026-11-09)

Plain-English summary of what Sophira will and will not retrieve, and where
that is enforced in code (not in prompts).

## What members can use

Ordinary public sources: academic papers, news, statistics, laws, regulations,
court publications, public government reports and **declassified** releases.
A `.gov` address is treated as a normal academic source, not as suspicious.

## What is always refused

| Situation | Code | Example |
|---|---|---|
| Private / internal network addresses | `prohibited-host` | `127.0.0.1`, `10.x`, `172.16–31.x`, `192.168.x`, `169.254.169.254` (cloud metadata), `*.local`, `*.internal`, IPv6 loopback/ULA/link-local |
| Non-web schemes | `unsupported-scheme` | `file:`, `ftp:` |
| Access-controlled government material | `restricted-source` | URLs containing classified / restricted / confidential / CUI / NOFORN / SIPR / JWICS / need-to-know / clearance markers, or `*.mil` hosts, or login/SSO/portal/intranet prefixes |

Refusals are checked **before any network connection** and again **on every
redirect hop**, so a public-looking link cannot bounce into a blocked place.
A refusal returns a plain-language message plus a lawful alternative, and it
never echoes restricted content.

Requests whose *purpose* is to obtain restricted material or to bypass an
access control are refused in the same way. This runs in code on the AI
tutor, the homework solver and research, before any model call.

## Where it is enforced

- `src/lib/research/policy.ts` — the policy itself (`evaluateSourceRequest`,
  `evaluateInformationRequest`, `isProhibitedHost`).
- `src/lib/research/verify.ts` — gates the first fetch and every redirect.
- `src/app/api/ai/solve`, `src/app/api/tutor`, `src/app/api/research` —
  wording-level screen before the model runs.
- `src/lib/integrations/canvas.ts` — member-supplied Canvas instance URLs get
  the same SSRF gate (https only, no private/metadata hosts).

## Honest limitations

Heuristics cannot *prove* that a public-looking page is authorised material,
and they will not catch a restricted document hosted at an innocuous URL.
Obfuscated markers (for example `C-U-I` with separators, or percent-encoded
text) are not decoded by the matcher. This layer reduces the chance of the
obvious failure; it does not guarantee compliance. Sources are still cited
and verified normally.

Tests: `tests/source-access.ts` (65 assertions, run by `npm test`).
