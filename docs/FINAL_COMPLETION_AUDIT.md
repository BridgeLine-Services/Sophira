> **SUPERSEDED (2026-10-13):** this document is a historical
> snapshot. The current, authoritative status is **docs/COMPLETION_REPORT.md**
> and the current owner checklist is **docs/WHAT_I_NEED_TO_DO_NEXT.md**.

# Final Completion Audit

Date: 2026-10-11 | Branch: master | Commit: the commit that adds this file
(see git log -1; audited from 03ac117 + this round's changes)
Production: https://sophira.vercel.app (Vercel auto-deploy from master; routes
smoke-checked 2026-10-11: all protected routes correctly redirect
unauthenticated visitors to /login)

| Requirement | Existing implementation | Evidence inspected/executed | Status | Remaining work | Planned test | Owner action |
|---|---|---|---|---|---|---|
| Real .pptx generation | NEW: src/lib/documents/pptx.ts + notebooks export route (format "pptx") + Export PPTX button | Real files generated in the offline suite; parsed by the repository's INDEPENDENT reader (lib/extract/documents.ts parsePptx); 16 assertions in tests/pptx-export.ts; suite 3227/3227 | VERIFIED (offline); deployed UI NOT YET live-tested | Live download test in production browser | tests/pptx-export.ts (runs in CI) | None |
| Microsoft Word direct integration | Not implemented (no OAuth code; local DOCX export exists and is verified) | Inspected: no Graph/OAuth code in src/ | MISSING (code) + BLOCKED (owner app registration + credentials) | Full OAuth code flow (next stage) | Mock + live consent tests when credentials exist | Register Entra app + set MICROSOFT_CLIENT_ID/SECRET (docs/WORD_GOOGLE_DOCS_SETUP.md) |
| Google Docs direct integration | Not implemented | Inspected: no Google OAuth/Docs API code | MISSING (code) + BLOCKED (owner project + credentials) | Full OAuth code flow (next stage) | Mock + live consent tests when credentials exist | Create Google OAuth client + set GOOGLE_CLIENT_ID/SECRET (docs/WORD_GOOGLE_DOCS_SETUP.md) |
| Google ADK patterns | NEW: docs/ADK_ARCHITECTURE_REVIEW.md; patterns adopted inside existing TS architecture (no Python, no new service) | Doc + pptx pipeline discipline + 3227-assertion suite | VERIFIED | None | pptx + full suite | None |
| Owner Online navigation (dedupe) | onlineChip single entry; OWNER_NAV has no /online entry | tests/prod-fixes.ts pins exactly one /online link | VERIFIED | Live owner-session check | suite + browser pass | None |
| Science expand/collapse | AppShell CourseTree independent toggles | suite assertions (aria, keys, isolation) | VERIFIED | Live check | browser pass | None |
| Centralized Typing Calibration | One side-panel entry; no per-course tool cards | course-engine pins (no typingTool in any registry; one /writing/typing entry) | VERIFIED | Live check | browser pass | None |
| IndexedDB offline kv fix | backend.ts put(value, key) | tests/prod-fixes.ts; suite green | VERIFIED (code); live device test NOT RUN | Real-browser offline test | browser pass | None |
| System Health in deployment | GET retrieves the REAL latest health run + gate TOTAL from the pinned issue; POST owner-only dispatch via GITHUB_HEALTH_TOKEN | Behaviorally tested classifyRun/extractGateSummary (tests/system-health-actions.ts); two real dispatched runs succeeded | VERIFIED (logic); live owner view NOT RUN | Authenticated owner browser test | tests + browser pass | Optional: add GITHUB_HEALTH_TOKEN for the one-click start |
| Release gate + health workflow | scripts/release-gate.mjs; .github/workflows/health.yml weekly Mon 06:00 UTC + dispatch; listForRepo notify verified by real runs | Two dispatched runs completed success; pinned issue open with the real TOTAL | VERIFIED (pipeline) | Rerun on the final revision after this push | health.yml dispatch | None |
| Production env vars / DB / AI / search | Manifest + doctor + gate checks | Gate: BLOCKED (Supabase, SOPHIRA_APP_URL, AI, search keys absent) | BLOCKED | Owner configuration | release gate | Set env vars (docs/WHAT_I_NEED_TO_DO_NEXT.md) |
| Live security matrices | Offline suites pass; live drills need test DB | Gate: BLOCKED (SUPABASE_TEST_* not configured) | BLOCKED | Owner one-time setup | gate security checks | Provide test-DB values |
| Legal facts | docs/legal templates with bracketed owner facts | Gate: BLOCKED pending owner input + attorney review | BLOCKED | Owner facts + attorney | gate legal check | Fill docs/legal/LEGAL_CONFIGURATION.md; attorney review |
| Physical device tests | docs/DEVICE_ACCEPTANCE.md checklist | Gate: BLOCKED/NOT RUN (no device) | BLOCKED | Owner device passes | device acceptance | Follow the checklist on phone/tablet |
| Production browser testing (unauthenticated) | curl smoke checks 2026-10-11; Browserbase run this round | docs/PRODUCTION_BROWSER_TEST_REPORT.md | See report | Authenticated owner pass (needs owner session) | Browserbase + report | Provide an owner test session when asked |

Honest overall status: code-side work in this round is PowerPoint generation
(verified offline), ADK pattern adoption, and integration preparation. Word
and Google Docs direct integration CODE IS NOT YET IMPLEMENTED and is the
next stage; their owner-side prerequisites are documented. The release gate
remains honestly BLOCKED on owner-side items only.
