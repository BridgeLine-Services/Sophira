# Notebook workspace — source-grounded academic notebook (2026-10-06)

A first-class research notebook per topic. It BUILDS ON the existing
research engine (`src/lib/research/`), the research database tables
(0012-0014), the citation system, the claim/evidence system, and the
source-authority system — nothing was replaced.

## Structure

Notebook → Sources | Notes | Questions | Evidence | Research |
Study Materials | Artifacts. UI: `/notebooks`, workspace tabs per section.
API: `/api/notebooks/*`. Migration: `0022_notebooks.sql`.

## Sources

Supported: PDF (page metadata), DOCX (section/paragraph metadata),
TXT, web URL (fetched + verified), uploaded image (needs OCR upstream;
stored honestly non-citable without it), teacher instructions,
assignment instructions, user notes, research source.

Every source stores: source_id (S1, S2, …), owner user_id, title,
source_type, original_url, canonical_url, content_hash (sha256),
uploaded_at, retrieved_at, extracted_text, page/section metadata,
processing_status, verification_status.

**Ownership/privacy (stricter than the rest of the app):** every source is
owned by exactly one user. RLS grants ONLY `user_id = auth.uid()` — there is
no admin read policy on `notebook_sources`, so every other user, admins
included, is blocked from reading source content.

## Grounded chat

Chat is grounded ONLY in the notebook's included sources (pinned first)
unless the user EXPLICITLY enables web research for that question — and
even then web findings must already be verified sources. Every answer
statement is labeled by the deterministic engine:

- **SOURCE-SUPPORTED** — an exact passage was located verbatim
  (char offsets recorded); claimed support that cannot be located is
  DOWNGRADED to NOT VERIFIED, never faked.
- **INFERENCE** — derived from cited sources, not stated verbatim.
- **NOT VERIFIED** — no source supports it; shown, never hidden.

Inline citations open the exact source location: page number for PDFs,
URL + retrieved timestamp for web pages, section/paragraph for DOCX.

## Source controls

include / exclude / pin / verify / remove + **"Why this source?"**
(authority, relevance, date, source type, why selected, assignment
requirement satisfied — from the stored ranking decision, never invented).

## Research this topic

Analyze question → determine required source types → search web →
rank candidates (assignment-aware, existing ranker) → retrieve →
verify URLs → store the ACTUAL source content (hashed) → show candidates
→ user approves → approved sources added.

Never invents a source; never cites an unretrieved URL; never uses a
dead URL; never treats a search snippet as verified content. The
conversion gate refuses any candidate without real retrieved content.

## Artifacts

Study Guide, Quiz, Flashcards, Outline, Briefing, Evidence Table,
Research Plan, Essay Plan, Bibliography — generated deterministically
from stored sources; every artifact retains per-section source
provenance; the bibliography reuses the existing deterministic
MLA/APA/Chicago formatter.

## Tests

`tests/notebook.ts` — RLS strictness, per-type storage fields, grounding
labels/downgrades/opt-in web, locators, pipeline refusals, why-source,
artifact provenance. Suite: see TEST_REPORT §57.
