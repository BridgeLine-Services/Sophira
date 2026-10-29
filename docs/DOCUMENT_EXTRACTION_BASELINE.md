# Document extraction baseline (measured 2026-10-29)

Prompt 3 requires measuring the current parsers before considering Docling or
MarkItDown. This is that measurement. **No parser was changed and no dependency
was added.**

Reproduce with:

```bash
npx tsc -p tests/tsconfig.json --outDir tests-dist   # compile the suite
node scripts/doc-bench.mjs
```

Documents are synthesised in memory (`scripts/doc-bench.mjs`) — no fixtures on
disk, no student data, no network.

## Results — Sophira's current parsers

| Format | chars | key tokens preserved | notes |
|---|---|---|---|
| DOCX (heading + 2 paragraphs) | 89 | **3/3** | heading order preserved (`order=true`) |
| PPTX (title + body) | 50 | **2/2** | `sections=0` — no slide locator returned for this fixture |
| XLSX (2 sheets, numbers) | 136 | **4/4** | both sheet names preserved |
| CSV (quoted comma + newline) | 50 | **2/2** | quoted field kept intact |
| PDF (text, scanned, tables, columns, equations) | — | **BLOCKED** | no PDF writer in the repo |

## What this does and does not prove

- **Proven:** for DOCX, XLSX, CSV and PPTX text, the current parsers preserve
  the content and order this corpus tests. Nothing here justifies replacing
  them.
- **Not proven:** PDF fidelity (text PDFs, scanned PDFs, tables, multi-column
  reading order, equations) — the single most important format for academic
  work is **unmeasured** because synthesising a PDF needs a writer dependency
  that this phase forbids. Any Docling/MarkItDown comparison is therefore
  incomplete until a PDF corpus exists.
- **Open question:** `sections=0` on PPTX. It may be an artefact of the
  synthetic package (no `presentation.xml`), or it may mean slide-level
  citation locators are absent. Unresolved, and it matters for citations that
  point at a slide.

## Decision

**No adoption.** Docling and MarkItDown remain candidates that cannot be
judged without a PDF corpus. Per Prompt 3 Step 5, adding a Python runtime or a
processing service is an architecture decision requiring approval, not an
improvement to be assumed.

## Next measurement step (not done)

Add a PDF writer as a **dev-only** dependency (e.g. `pdf-lib`) to synthesise
text, table and multi-column PDFs, then re-run this harness against all three
parsers. Only after that can a swap be justified or rejected on evidence.

## PDF: measured (partially)

`pdf-parse` (bundled pdf.js v1.10.100) extracts a **real 14-page academic paper**
completely: 82,400 characters, 2/2 key tokens, sane reading order (title, then
authors, then body). The PDF text path therefore **works** and needs no
replacement for plain text PDFs.

Still UNMEASURED, and honestly so:

- **Scanned PDFs** (no text layer) - the important failure mode for students.
  The route must report low confidence rather than "extracted".
- **Tables, multi-column layouts, equations** - structure loss is unmeasured.

Why: a dependency-free synthetic PDF writer was attempted (raw objects + xref)
and was **rejected by the bundled pdf.js v1.10.100** with `bad XRef entry`, even
with byte-exact offsets and 20-byte CRLF xref entries. Options, in order of
preference:

1. Add a **dev-only** PDF writer (e.g. `pdf-lib`) to `devDependencies`, used only
   by the benchmark, then re-run this table. Production bundle unaffected.
2. Keep using third-party fixtures (as here) and accept that scanned/table cases
   stay unmeasured.

Until one of those is approved, **no parser replacement is justified**: the one
format with real evidence already works, and the formats that might benefit have
no measurement at all.

## UPDATE (same day): the synthetic PDF attempt found a REAL defect

With `pdf-lib` approved as a **dev-only** writer, synthetic cases were run
through the production parser (`pdf-parse` -> bundled **pdf.js v1.10.100**).
The corpus could not be measured, because the parser is unstable on
modern-library PDFs:

- Compressed object streams: `Unknown compression method in flate stream`.
- Uncompressed output: `bad XRef entry` for most cases.
- **Non-deterministic**: the SAME byte-identical file failed twice and then
  parsed correctly on the third attempt in one process (verified by hand).

This is not a benchmark artefact. It is a defect in Sophira's production PDF
path: a student PDF produced by a modern library can fail outright, and can
*intermittently* succeed. A retry-shaped workaround would hide it.

### Consequence for Prompt 3

The measured position is now:

| Case | Evidence |
|---|---|
| Plain-text PDF (real 14-page paper) | works: 82,400 chars, 2/2 tokens |
| pdf-lib text / table / columns | intermittent failure (`bad XRef entry`) |
| Scanned PDF, tables, columns, equations | still UNMEASURED |

So: **no parser has been adopted**, and none should be on this evidence. But
"keep the current parser" is no longer defensible either - the current parser
demonstrably rejects valid modern PDFs.

### Recommended next step (needs approval)

1. Replace `pdf-parse@1.1.1` (pdf.js v1.10.100, ~2016) with a current
   `pdfjs-dist`, keeping the same `{ text }` contract and the same
   `serverExternalPackages` entry, then re-run this benchmark.
2. Only if that still loses structure (tables, columns) evaluate Docling as a
   **separate service** - not inline in the Next.js runtime.
3. Keep `pdf-lib` (devDependency) as the fixture generator for the regression
   test that pins the modern-PDF case.

`pdf-lib` is a devDependency only: it is never imported by application code and
never enters the production bundle.
