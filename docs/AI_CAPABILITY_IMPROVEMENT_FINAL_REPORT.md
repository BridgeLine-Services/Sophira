# Final status: BLOCKED (honest, see section 12)

Final regression audit (Prompt 7). Every number was produced by the command named.

## 1. Summary
Shipped: boundary policy + fetch enforcement, 26-case eval corpus, gate checks 40-41,
modern PDF fallback, provider-endpoint guard, orchestration decision record.
Deferred by owner: ranking weighting-vs-filtering. Unmeasurable here: live model quality.

## 2. Commits on master
f42ed17 audit · bd4dc9b boundary · 85ae2c1 evals · 1ba24f0 gate 40-41 ·
01dd515 extraction baseline · 356a749 PDF real fixture · 31c3510 synthetic
attempt · 114387c pdfjs fallback · 00e9a72 structure measured · 4f8b9e3 research
baseline · 1f40572 orchestration decision · ec29a7b endpoint safety

## 3. Repositories inspected
Docling, MarkItDown, Promptfoo, OWASP GenAI, pgvector, LangGraph, Ollama,
llama.cpp, Haystack + 4 academic-assistant projects. Licences reviewed; OWASP is
CC BY-SA (cite only). Adopted: none as a framework. Adopted as tools: pdfjs-dist
(runtime fallback), pdf-lib (dev-only fixture writer).

## 4. Verification actually run (all green)
npm test 4082/4082 · tsc clean · next build clean, no warnings ·
npm run verify PASS · scan:secrets CLEAN · release-gate self-test PASS (41 checks) ·
evals 14 deterministic pass / 12 skipped / 0 failed · boundary 9/9 ·
CI + Migrations success on ec29a7b

## 5. Not run, and never reported as passing
- npm run lint: eslint is NOT installed or declared (pre-existing).
- Live model-quality benchmark (no inference endpoint reachable).
- Live RLS/invitation matrices (need a configured project; offline suites only).
- Any physical-device check.

## 6. Security and privacy changes
- Restricted-info and SSRF boundary enforced in verify.ts before fetch and on
  every redirect hop. Fail-closed; a committed fetch spy proves no request.
- Self-hosted AI endpoint validated; metadata/.internal always refused;
  loopback/private in production only with LOCAL_LLM_ALLOW_PRIVATE=true.
- No secret is returned in any diagnostic; secret-scan covers client bundles.

## 7. Boundary results
9 boundary cases pass, incl. one rephrase that FAILED first and was fixed
('no-foreign-releasable annex'). It is a heuristic, not a classifier: it cannot
prove a public-looking page is authorised, and that limit is documented.

## 8. Measured improvements
PDF: modern files went from intermittent failure (2 of 3 attempts) to
deterministic 3/3; real 14-page paper unchanged (82,756 chars, via pdf-parse).
Structure: table 3/3 tokens with row adjacency, columns separate, equations 2/2,
scanned correctly empty.

## 9. Known defects recorded, not silently fixed
Ranking inversion (medium.com above fdrlibrary.org on 'any'), and teacher
requirements filtering instead of demoting (1 source returned where 3 needed).
Both await an owner decision on weighting.

## 10. Rollback
Every change is an independent commit; revert any one without touching data.
No migration was run. LOCAL_LLM_ALLOW_PRIVATE is additive and defaults off.

## 11. Why BLOCKED
The package's own acceptance test requires model-quality evidence and a lint
gate. Neither exists here, so "PASS" would be a false claim.
