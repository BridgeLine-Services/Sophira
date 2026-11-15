/**
 * PROVIDER-KEY OPTIMISATION (directive 2026-11-15).
 *
 * The directive asks for four things that are easy to claim and hard to prove:
 *  1. scans read locally, with no new key,
 *  2. recordings transcribed locally, with no new key, and never fabricated,
 *  3. a model pass over a student's file that reuses the EXISTING provider,
 *  4. every capability reporting an honest state instead of "connected".
 *
 * So these tests assert the unglamorous half: a text PDF never touches the scan reader,
 * a page the reader did not return stays blank, a quotation the model invented is removed,
 * an unsupported recording is refused before anything is uploaded, and "available" without
 * a probe is never reported as working.
 */
import { createServer, type Server } from "http";
import {
  audioFormatSupport,
  MAX_AUDIO_BYTES,
  normalizeTranscription,
  transcribeMedia,
} from "../src/lib/media/transcribe";
import {
  describePdfOcr,
  extractPdfWithOcr,
  mergeOcrIntoPages,
  normalizePdfOcrPayload,
  pagesWithoutText,
  type PdfOcrAttempt,
} from "../src/lib/extract/pdf-ocr";
import { pdfProvenance, readUploadedFile } from "../src/lib/extract/read";
import {
  analyzeDocument,
  buildDocumentAnalysisMessages,
  findQuotePage,
  MAX_ANALYSIS_CHARS,
  normalizeDocumentAnalysis,
} from "../src/lib/extract/analysis";
import {
  capabilityOwnerState,
  capabilityStates,
  documentAnalysisCapability,
  fileCapabilities,
  inProcessMediaCapability,
  isUsable,
  stateLabel,
  summarizeCapabilities,
} from "../src/lib/capabilities/file-capabilities";
import { intakeDocument } from "../src/lib/research/document-intake";
import type { DocumentExtraction } from "../src/lib/research/documents";
import { deflateSync } from "zlib";

type Assert = (condition: boolean, message: string) => void;

const SECRET = "never-leak-this-token";

function startServer(handler: (path: string, body: string) => { status: number; json: unknown }): Promise<{ server: Server; url: string; hits: () => number }> {
  let hits = 0;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      hits++;
      const path = (req.url || "").split("?")[0];
      if (req.method === "GET" && path === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", pdf: true }));
        return;
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const out = handler(path, body);
        res.writeHead(out.status, { "content-type": "application/json" });
        res.end(JSON.stringify(out.json));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, hits: () => hits });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** A real PDF whose one page carries a real text layer. */
function buildTextPdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const compressed = deflateSync(Buffer.from(content, "latin1"));
  const head = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\n2 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, "latin1");
  const tail = Buffer.from(`\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`, "latin1");
  return Buffer.concat([head, compressed, tail]);
}

const BLANK_PDF_EXTRACT = {
  text: "",
  via: "pdfjs" as const,
  primaryError: null,
  pages: [
    { page: 1, text: "Photosynthesis converts light energy into chemical energy stored in glucose." },
    { page: 2, text: "   " },
  ],
};

function attemptFrom(pages: PdfOcrAttempt["pages"], overrides: Partial<PdfOcrAttempt> = {}): PdfOcrAttempt {
  return {
    attempted: true,
    supported: true,
    engine: "tesseract-selfhost",
    pages,
    requested: pages.map((p) => p.page),
    unread: [],
    skipped: [],
    notes: ["read from the scan"],
    ...overrides,
  };
}

export async function runProviderKeyOptimizationTests(assert: Assert, section: (name: string) => void) {
  /* ------------------------------------------------------------------ */
  section("provider-key optimisation: reading scans with the owner's own reader");

  assert(JSON.stringify(pagesWithoutText(BLANK_PDF_EXTRACT.pages)) === "[2]",
    "pdf ocr: only the page without a text layer is chosen for reading");
  assert(pagesWithoutText(null).length === 0 && pagesWithoutText([]).length === 0,
    "pdf ocr: no page map means no guessed page numbers, so nothing is read");
  assert(pagesWithoutText([{ page: 1, text: "Title" }]).length === 1,
    "pdf ocr: a title page with almost no text is treated as needing a read");

  const normalized = normalizePdfOcrPayload(
    {
      pages: [
        { page: 2, text: "Heat flows from hotter to cooler bodies.", mean_confidence: 96 },
        { page: 2, text: "duplicate page is ignored", mean_confidence: 99 },
        { page: 7, text: "a page nobody asked for", mean_confidence: 90 },
        { page: 3, text: "   ", mean_confidence: 99 },
      ],
    },
    [2, 3]
  );
  assert(normalized.pages.length === 1 && normalized.pages[0].page === 2,
    "pdf ocr: a page that was not requested is refused, and duplicates keep the first");
  assert(normalized.pages[0].confidence === "high" && normalized.pages[0].meanConfidence === 0.96,
    "pdf ocr: a 0..100 confidence is normalised to 0..1 and banded high");
  assert(JSON.stringify(normalized.unread) === "[3]",
    "pdf ocr: a page returned with no words is reported unread, not filled in");
  assert(normalized.rejected === 2, "pdf ocr: unrequested or duplicate pages are counted as rejected");

  const poorScan = normalizePdfOcrPayload({ pages: [{ page: 1, text: "Faint unreadable scrawl.", mean_confidence: 41 }] }, [1]);
  assert(poorScan.pages[0].confidence === "low",
    "pdf ocr: a poor-quality scan is banded low, so the reader is warned before quoting it");
  assert(poorScan.pages[0].meanConfidence === 0.41,
    "pdf ocr: the measured confidence is reported as well as the band");

  const noConfidence = normalizePdfOcrPayload({ pages: [{ page: 1, text: "Some words here." }] }, [1]);
  assert(noConfidence.pages[0].confidence === "low" && noConfidence.pages[0].meanConfidence === null,
    "pdf ocr: a page with no reported confidence is 'low', never 'high'");

  const merged = mergeOcrIntoPages(
    [
      { page: 1, text: "Text that was already in the file." },
      { page: 2, text: "" },
      { page: 3, text: "  " },
    ],
    attemptFrom([
      { page: 1, text: "A different reading that must not replace the file's own text", confidence: "high", meanConfidence: 0.95 },
      { page: 2, text: "Read from page two.", confidence: "medium", meanConfidence: 0.7 },
    ])
  );
  assert(merged.pages[0].text === "Text that was already in the file.",
    "pdf ocr merge: a page that already had text keeps its own text, so OCR never overwrites extraction");
  assert(merged.pages[1].text === "Read from page two." && merged.ocrPages.includes(2),
    "pdf ocr merge: a blank page is filled from the reading and keeps its page number");
  assert(JSON.stringify(merged.stillUnread) === "[3]" && merged.pages[2].text === "",
    "pdf ocr merge: a page the reader did not return is left blank and reported");
  assert(merged.confidence === "medium", "pdf ocr merge: the weakest page decides the document's confidence");
  assert(merged.pages.map((p) => p.page).join(",") === "1,2,3", "pdf ocr merge: page order is preserved");

  // A text PDF must never call the reader at all.
  let ocrCalls = 0;
  const textPdfRead = await extractPdfWithOcr(buildTextPdf("A normal document with a real text layer and enough words to read."), {
    extract: async () => ({
      text: "A normal document with a real text layer and enough words to read.",
      via: "pdf-parse",
      primaryError: null,
      pages: null,
    }),
    post: async () => {
      ocrCalls++;
      return { ok: true as const, json: { pages: [] } };
    },
  });
  assert(textPdfRead.ocr === null && ocrCalls === 0,
    "pdf ocr: an ordinary text PDF makes no scan-reading call, so nothing that already works is slowed down");

  const scannedRead = await extractPdfWithOcr(buildTextPdf("scan"), {
    extract: async () => BLANK_PDF_EXTRACT,
    post: async (_kind, path) => {
      assert(path === "/ocr/pdf", "pdf ocr: the existing reader's PDF route is used, not a new service");
      return {
        ok: true as const,
        json: { pages: [{ page: 2, text: "Glucose is stored as starch in plants.", mean_confidence: 0.91 }] },
      };
    },
  });
  assert(scannedRead.ocr?.applied === true && scannedRead.ocr?.pagesRead.join(",") === "2",
    "pdf ocr: a scanned page is filled from the reading and the page number is kept");
  assert(scannedRead.text.includes("Photosynthesis") && scannedRead.text.includes("Glucose is stored"),
    "pdf ocr: the file's own text and the read text are both present, in page order");
  assert(describePdfOcr(scannedRead)?.includes("Read 1 scanned page") === true,
    "pdf ocr: the student is told what was read, in words");

  const outdatedReader = await extractPdfWithOcr(buildTextPdf("scan"), {
    extract: async () => BLANK_PDF_EXTRACT,
    post: async () => ({ ok: false as const, reason: "status-404" }),
  });
  assert(outdatedReader.ocr?.applied === false && outdatedReader.ocr?.supported === false,
    "pdf ocr: a reader without the PDF route is reported as unsupported, not as an empty document");
  assert(outdatedReader.text === BLANK_PDF_EXTRACT.text,
    "pdf ocr: a failed reading never degrades text the parser already produced");
  assert((describePdfOcr(outdatedReader) || "").toLowerCase().includes("cannot read pdf pages"),
    "pdf ocr: the unsupported case says plainly that PDF pages cannot be read yet");

  const provenance = pdfProvenance(scannedRead);
  assert((provenance as { ocr?: { pagesRead: number[] } }).ocr?.pagesRead.join(",") === "2",
    "pdf ocr: provenance carries which pages came from the scan, additively");

  /* ------------------------------------------------------------------ */
  section("provider-key optimisation: recordings are transcribed locally or refused honestly");

  assert(audioFormatSupport("lecture.mp3").supported && audioFormatSupport("lecture.mp3").format === "mp3",
    "transcription: an MP3 is accepted");
  assert(audioFormatSupport("LECTURE.M4A").supported, "transcription: extension matching ignores case");
  const wma = audioFormatSupport("old-recording.wma");
  assert(!wma.supported && (wma.reason || "").includes("WMA"),
    "transcription: a format the engine cannot decode is refused with the format named");
  const unknown = audioFormatSupport("voice-note.xyz");
  assert(unknown.supported && unknown.unknown,
    "transcription: an unknown container is still tried, so a real recording is never blocked by a list");
  assert(audioFormatSupport("clip", "audio/mpeg").format === "mpeg",
    "transcription: a file with no extension is identified from its type instead");

  const parsedEngine = normalizeTranscription({
    text: "",
    duration: 30,
    language: "en",
    model: "whisper-small",
    segments: [
      { start: 0, end: 10, text: "Certain words.", avg_logprob: -0.1, no_speech_prob: 0.01 },
      { start: 10, end: 20, text: "Shaky words.", avg_logprob: -0.9, no_speech_prob: 0.05 },
      { start: 20, end: 30, text: "Maybe music.", avg_logprob: -0.2, no_speech_prob: 0.8 },
    ],
  });
  assert(parsedEngine.engineConfidence === "low" && parsedEngine.uncertainSegments === 2,
    "transcription: engine-reported certainty is used, and the weakest segment decides");
  const silentEngine = normalizeTranscription({
    duration: 10,
    segments: [{ start: 0, end: 10, text: "Words without a confidence." }],
  });
  assert(silentEngine.engineConfidence === null && silentEngine.uncertainSegments === 0,
    "transcription: when the engine reports no certainty, none is invented");

  const unconfigured = await transcribeMedia(Buffer.from("x"), "talk.mp3", "audio/mpeg", { env: {} });
  assert(!unconfigured.ok && /not configured|does not claim/i.test(unconfigured.notes),
    "transcription: with no local service, Sophira says it cannot transcribe rather than inventing text");

  const asr = await startServer((path) => {
    assert(path === "/v1/audio/transcriptions", "transcription: the Whisper-compatible route is used");
    return {
      status: 200,
      json: {
        text: "",
        duration: 20,
        language: "en",
        model: "small",
        segments: [
          { start: 0, end: 4, text: "First line of the lecture.", avg_logprob: -0.12, no_speech_prob: 0.01 },
          { start: 4, end: 8, text: "Second line of the lecture.", avg_logprob: -0.15, no_speech_prob: 0.02 },
        ],
      },
    };
  });
  try {
    const live = await transcribeMedia(Buffer.from("fake-audio"), "talk.mp3", "audio/mpeg", {
      env: { SOPHIRA_ASR_URL: asr.url, SOPHIRA_ASR_TOKEN: SECRET },
      timeoutMs: 5000,
    });
    assert(live.ok && live.segments.length === 2, "transcription: a local server's segments are accepted");
    assert(live.engineConfidence === "high" && live.format === "mp3",
      "transcription: the engine's certainty and the format actually read are reported");
    assert(JSON.stringify(live).indexOf(SECRET) === -1,
      "transcription: the service token never appears in the result");
  } finally {
    await closeServer(asr.server);
  }

  let refusedHits = 0;
  const asrRefuse = await startServer(() => {
    refusedHits++;
    return { status: 200, json: { segments: [] } };
  });
  try {
    const refused = await transcribeMedia(Buffer.from("fake"), "old.wma", "audio/x-ms-wma", {
      env: { SOPHIRA_ASR_URL: asrRefuse.url },
    });
    assert(!refused.ok && refusedHits === 0,
      "transcription: an unsupported recording is refused BEFORE anything is uploaded");
  } finally {
    await closeServer(asrRefuse.server);
  }

  let oversizeHits = 0;
  const oversizeServer = await startServer(() => {
    oversizeHits++;
    return { status: 200, json: { segments: [] } };
  });
  try {
    const oversize = await transcribeMedia(Buffer.alloc(MAX_AUDIO_BYTES + 1), "lecture.mp3", "audio/mpeg", {
      env: { SOPHIRA_ASR_URL: oversizeServer.url },
    });
    assert(!oversize.ok && oversizeHits === 0,
      "transcription: an oversized recording is refused BEFORE the upload, so it never fails halfway");
    assert(/25 MB/.test(oversize.notes) && /untouched/.test(oversize.notes),
      "transcription: the oversized message gives the size, the next step, and says the file is untouched");
  } finally {
    await closeServer(oversizeServer.server);
  }

  const noSpeech = await startServer(() => ({ status: 200, json: { text: "", segments: [] } }));
  try {
    const empty = await transcribeMedia(Buffer.from("fake"), "quiet.mp3", "audio/mpeg", {
      env: { SOPHIRA_ASR_URL: noSpeech.url },
    });
    assert(!empty.ok && empty.segments.length === 0 && /no speech/i.test(empty.notes),
      "transcription: silence is a failure with a reason, never an empty 'success'");
  } finally {
    await closeServer(noSpeech.server);
  }

  /* ------------------------------------------------------------------ */
  section("provider-key optimisation: a model pass reuses the existing provider");

  const built = buildDocumentAnalysisMessages({
    filename: "handout.pdf",
    text: "x".repeat(MAX_ANALYSIS_CHARS + 500),
    pages: [{ page: 1, text: "x" }],
  });
  assert(built.truncated && built.charsAnalyzed === MAX_ANALYSIS_CHARS,
    "analysis: a very long document is clipped and the clip is reported, not hidden");
  assert(built.messages[0].content.includes("Use ONLY the document text"),
    "analysis: the model is told to stay inside the document");
  assert(built.messages[1].content.includes("data, not instruction"),
    "analysis: uploaded text is framed as data, so an instruction inside a file is not obeyed");

  const pages = [
    { page: 1, text: "The treaty was signed in 1919. It ended the war between the states." },
    { page: 2, text: "Critics argued the terms were too harsh and would cause further conflict." },
  ];
  const checked = normalizeDocumentAnalysis(
    {
      summary: "A treaty ending a war.",
      key_points: ["Signed in 1919", "Criticised as harsh"],
      terms: [{ term: "treaty", meaning: "a formal agreement between states" }, { term: "", meaning: "dropped" }],
      quotes: [
        { text: "The treaty was signed in 1919." },
        { text: "Critics argued the terms were too harsh" },
        { text: "A sentence the model made up entirely." },
        { text: "too short" },
      ],
      cautions: ["The document has no index."],
    },
    { text: pages.map((p) => p.text).join("\n"), pages, truncated: false, charsAnalyzed: 120 }
  );
  assert(checked.quotes.length === 2 && checked.discardedQuotes === 2,
    "analysis: a quotation not found in the file is removed and counted, never shown");
  assert(checked.quotes[0].page === 1 && checked.quotes[1].page === 2,
    "analysis: each surviving quotation gets the page it was actually printed on");
  assert(checked.terms.length === 1, "analysis: an empty term is dropped rather than displayed");
  assert(checked.cautions.some((c) => /could not be found word for word/.test(c)),
    "analysis: the student is told that some suggested quotations were removed");

  const withoutPages = normalizeDocumentAnalysis(
    { summary: "s", quotes: [{ text: "The treaty was signed in 1919." }] },
    { text: pages.map((p) => p.text).join("\n"), pages: null, truncated: false, charsAnalyzed: 120 }
  );
  assert(withoutPages.quotes[0].page === null && withoutPages.cautions.some((c) => /Page numbers are not available/.test(c)),
    "analysis: with no page map the quotation has no page and the student is told why");
  assert(findQuotePage("The treaty was signed in 1919.", pages) === 1,
    "analysis: page lookup is whitespace-insensitive but exact about the words");

  let chatCalls = 0;
  const notConfigured = await analyzeDocument(
    { filename: "f.pdf", text: "Some text in the file." },
    { configured: () => false, chat: async () => { chatCalls++; return { text: "{}", provider: "gemini", model: "m" }; } }
  );
  assert(!notConfigured.ok && notConfigured.reason === "ai_not_configured" && chatCalls === 0,
    "analysis: with no provider, nothing is called and the reason is stated");
  assert(notConfigured.message.includes("not configured"),
    "analysis: the unavailable message is the shared, student-facing one");

  const failed = await analyzeDocument(
    { filename: "f.pdf", text: "Some text in the file." },
    { configured: () => true, chat: async () => { throw new Error("upstream 500"); } }
  );
  assert(!failed.ok && failed.reason === "ai_failed",
    "analysis: a provider failure is reported as a failure, not as an empty document");

  const garbage = await analyzeDocument(
    { filename: "f.pdf", text: "Some text in the file." },
    { configured: () => true, chat: async () => ({ text: "not json at all", provider: "gemini", model: "m" }) }
  );
  assert(!garbage.ok && garbage.reason === "bad_output",
    "analysis: an unusable reply shows nothing rather than a half-invented summary");

  const good = await analyzeDocument(
    { filename: "f.pdf", text: pages.map((p) => p.text).join("\n"), pages },
    {
      configured: () => true,
      chat: async () => ({
        text: JSON.stringify({
          summary: "A treaty.",
          key_points: ["1919"],
          quotes: [{ text: "The treaty was signed in 1919." }, { text: "Never in the file, this line." }],
        }),
        provider: "selfhost",
        model: "llama3.1:8b",
      }),
    }
  );
  assert(good.ok && good.where === "local" && good.quotes.length === 1 && good.discardedQuotes === 1,
    "analysis: a locally answered pass is reported as local, and invented quotations still removed");

  const noText = await analyzeDocument(
    { filename: "blank.pdf", text: "   " },
    { configured: () => true, chat: async () => { chatCalls++; return { text: "{}", provider: "gemini", model: "m" }; } }
  );
  assert(!noText.ok && noText.reason === "no_text" && chatCalls === 0,
    "analysis: an empty file is never sent to a model");

  /* ------------------------------------------------------------------ */
  section("provider-key optimisation: seven honest capability states");

  const bare = fileCapabilities({});
  const byId = (id: string) => bare.find((c) => c.id === id)!;
  assert(byId("document_text").state === "local" && isUsable(byId("document_text")),
    "capabilities: reading typed text is local and needs nothing");
  assert(byId("image_ocr").state === "requires_installation" && byId("scanned_pdf_ocr").state === "requires_installation",
    "capabilities: with no reader installed, both scan paths say 'needs setup', not 'connected'");
  assert(byId("transcription").state === "requires_installation",
    "capabilities: with no transcriber installed, transcription says 'needs setup'");
  assert(byId("in_process_media_workers").state === "unsupported_by_hosting",
    "capabilities: the serverless limit is stated as a permanent one, not a missing setting");

  const keyMissing = documentAnalysisCapability({ AI_PROVIDER: "gemini" });
  assert(keyMissing.state === "requires_api_key" && keyMissing.code === "analysis_key_missing",
    "capabilities: a chosen hosted provider with no key is 'needs a key'");
  const nothingChosen = documentAnalysisCapability({ AI_PROVIDER: "auto" });
  assert(nothingChosen.state === "requires_provider_configuration",
    "capabilities: nothing configured at all is 'needs configuration', distinct from a missing key");
  const localModel = documentAnalysisCapability({ AI_PROVIDER: "auto", LOCAL_LLM_BASE_URL: "https://models.example.net" });
  assert(localModel.state === "local" && !localModel.verified,
    "capabilities: a self-hosted model is local, and is not claimed verified before it answers");

  const configuredUnprobed = fileCapabilities({ SOPHIRA_OCR_URL: "https://reader.example.net", SOPHIRA_OCR_TOKEN: SECRET });
    assert(configuredUnprobed.find((c) => c.id === "image_ocr")!.state === "available",
    "capabilities: a configured reader is 'available'");
  assert(configuredUnprobed.find((c) => c.id === "image_ocr")!.verified === false,
    "capabilities: ...but unverified, because nobody has pinged it in this report");
  assert(!isUsable(configuredUnprobed.find((c) => c.id === "image_ocr")!),
    "capabilities: an unverified service is not treated as usable");

  const verified = fileCapabilities(
    { SOPHIRA_OCR_URL: "https://reader.example.net", SOPHIRA_ASR_URL: "https://whisper.example.net" },
    { ocr: { healthy: true, pdf: true }, asr: { healthy: true } }
  );
  assert(verified.find((c) => c.id === "scanned_pdf_ocr")!.verified,
    "capabilities: a reader that answered its health check and offers PDF pages is verified");
  assert(verified.find((c) => c.id === "transcription")!.verified,
    "capabilities: a transcriber that answered is verified");

  const oldReader = fileCapabilities({ SOPHIRA_OCR_URL: "https://reader.example.net" }, { ocr: { healthy: true, pdf: false } });
  assert(oldReader.find((c) => c.id === "scanned_pdf_ocr")!.state === "requires_installation",
    "capabilities: a reader without PDF support puts only the PDF path at 'needs setup'");
  assert(oldReader.find((c) => c.id === "image_ocr")!.state === "available",
    "capabilities: ...while pictures of text still work");

  const silentReader = fileCapabilities({ SOPHIRA_OCR_URL: "https://reader.example.net" }, { ocr: { healthy: true, pdf: null } });
  assert(silentReader.find((c) => c.id === "scanned_pdf_ocr")!.code === "ocr_pdf_unconfirmed",
    "capabilities: a reader that does not say whether it reads PDFs is reported as unconfirmed");

  const down = fileCapabilities({ SOPHIRA_OCR_URL: "https://reader.example.net" }, { ocr: { healthy: false } });
  assert(down.find((c) => c.id === "image_ocr")!.state === "temporarily_unavailable",
    "capabilities: a configured reader that does not answer is 'temporarily unavailable'");

  const rejected = fileCapabilities({ SOPHIRA_OCR_URL: "http://reader.example.net" });
  assert(rejected.find((c) => c.id === "image_ocr")!.state === "requires_provider_configuration",
    "capabilities: an unsafe address is 'needs configuration', not 'available'");

  const summary = summarizeCapabilities(bare);
  assert(summary.usable.includes("document_text") && summary.blocked.includes("scanned_pdf_ocr"),
    "capabilities: the summary separates what works now from what needs the owner");

  const states = capabilityStates(bare);
  assert(Object.keys(states).length === 6 && states.image_ocr.state === "requires_installation",
    "capabilities: the public projection is states and codes only");

  const allText = JSON.stringify(bare);
  assert(!allText.includes("reader.example.net") && !allText.includes(SECRET) && !allText.includes("://"),
    "capabilities: no address, token or protocol ever appears in a capability report");
  assert(capabilityOwnerState("local") === "working" && capabilityOwnerState("available") === "available",
    "capabilities: what works locally reads 'working', a configured service reads 'available'");
  assert(capabilityOwnerState("requires_installation") === "not-configured"
    && capabilityOwnerState("requires_provider_configuration") === "not-configured"
    && capabilityOwnerState("requires_api_key") === "not-configured",
    "capabilities: every 'your move, owner' state uses the one existing owner word, not a new one");
  assert(capabilityOwnerState("temporarily_unavailable") === "problems"
    && capabilityOwnerState("unsupported_by_hosting") === "not-implemented",
    "capabilities: a silent service reads 'problems' and a hosting limit reads 'not-implemented'");
  const ownerStates = ["local", "available", "requires_installation", "requires_provider_configuration", "requires_api_key", "temporarily_unavailable", "unsupported_by_hosting"] as const;
  assert(ownerStates.every((st) => typeof capabilityOwnerState(st) === "string"),
    "capabilities: every one of the seven states maps into the owner vocabulary (no blanks)");

  assert(stateLabel("temporarily_unavailable") === "Temporarily unavailable" && stateLabel("local").length > 0,
    "capabilities: every state has a plain-English label for the owner screen");
  assert(inProcessMediaCapability().ownerDetail.toLowerCase().includes("serverless"),
    "capabilities: the serverless limit explains itself to the owner");

  /* ------------------------------------------------------------------ */
  section("provider-key optimisation: research intake reads a scan only when it worked");

  const scanBase: DocumentExtraction = {
    kind: "pdf",
    filename: "handout.pdf",
    status: "needs_ocr",
    text: "",
    charCount: 0,
    pageCount: 1,
    metadata: { title: null, author: null, pageCount: 1 },
    notes: ["This PDF is a scan or a set of images, so it holds no text Sophira can quote."],
    quotable: false,
  };

  const readScan = await intakeDocument(Buffer.from("fake-pdf"), {
    filename: "handout.pdf",
    env: {},
    classify: () => scanBase,
    readPdf: async () => ({
      text: "There are no more customers.",
      via: "pdfjs",
      primaryError: null,
      pages: [{ page: 1, text: "There are no more customers." }],
      ocr: { applied: true, supported: true, engine: "tesseract-selfhost", pagesRead: [1], stillUnread: [], skipped: [], confidence: "medium", notes: ["Read 1 scanned page from the scan."] },
    }),
  });
  assert(readScan.extraction.status === "extracted" && readScan.extraction.quotable,
    "research intake: a scan that was actually read becomes a quotable source");
  assert(readScan.scan?.applied === true && readScan.scan?.confidence === "medium",
    "research intake: the reading is reported with its confidence");
  assert(readScan.extraction.notes.join(" ").includes("no outside service"),
    "research intake: the note says the words came from the installation's own reader");
  assert(readScan.extraction.notes.join(" ").includes("check names, numbers and symbols"),
    "research intake: a machine reading of a page image is flagged for the reader to check");

  const failedScan = await intakeDocument(Buffer.from("fake-pdf"), {
    filename: "handout.pdf",
    env: {},
    classify: () => scanBase,
    readPdf: async () => ({
      text: "",
      via: "pdfjs",
      primaryError: null,
      pages: [{ page: 1, text: "" }],
      ocr: { applied: false, supported: false, engine: "none", pagesRead: [], stillUnread: [1], skipped: [], confidence: "failed", notes: [] },
    }),
  });
  assert(failedScan.extraction.status === "needs_ocr" && failedScan.extraction.quotable === false,
    "research intake: a scan that could not be read stays unread, and never becomes a fake source");
  assert(failedScan.scan?.applied === false && failedScan.scan?.capabilityState === "requires_installation",
    "research intake: the failure names the capability state instead of blaming the student");

  /* ------------------------------------------------------------------ */
  section("provider-key optimisation: reading a file end to end");

  let readPdfHits = 0;
  const textFile = await readUploadedFile(Buffer.from("%PDF-fake"), {
    mime: "application/pdf",
    name: "handout.pdf",
    extractPdf: async () => ({
      text: "A lecture handout with plenty of ordinary words in it for extraction and study, long enough that the reader treats it as a normal text document.",
      via: "pdf-parse",
      primaryError: null,
      pages: null,
    }),
    ocrPost: async () => {
      readPdfHits++;
      return { ok: true as const, json: { pages: [] } };
    },
  });
  assert(textFile.confidence === "high" && readPdfHits === 0,
    "read: a text PDF is read with no scan-reading call at all");

  const scannedFile = await readUploadedFile(Buffer.from("%PDF-fake"), {
    mime: "application/pdf",
    name: "scan.pdf",
    extractPdf: async () => BLANK_PDF_EXTRACT,
    ocrPost: async () => ({
      ok: true as const,
      json: { pages: [{ page: 2, text: "Glucose is stored as starch in plants and animals.", mean_confidence: 0.88 }] },
    }),
  });
  assert(scannedFile.text.includes("Photosynthesis") && scannedFile.text.includes("Glucose is stored"),
    "read: a scanned page is read and joined to the page that already had text");
  assert(scannedFile.notes.toLowerCase().includes("scans"),
    "read: the student is told that some pages were read from page images");
  assert((scannedFile.provenance as { ocr?: { applied: boolean } }).ocr?.applied === true,
    "read: provenance records the scan reading so a later audit can see it");

  const unsupported = await readUploadedFile(Buffer.from("binary"), { mime: "application/zip", name: "archive.zip" });
  assert(unsupported.confidence === "failed" && unsupported.notes.includes("Unsupported file type"),
    "read: an unreadable format is refused in words, unchanged from before");
}
