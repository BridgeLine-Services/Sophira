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
