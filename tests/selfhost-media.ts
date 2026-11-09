/**
 * PHASE 3b — self-hosted OCR + Whisper transcription contract (2026-11-09).
 *
 * These tests drive the REAL client code against a local stub HTTP server, so
 * the contract is exercised end to end without needing Tesseract or Whisper
 * installed on this machine. They prove: honest confidence bands, honest
 * failures, preserved timestamps, optional speaker labels, bounded timeouts,
 * endpoint validation, and that tokens never leak into results.
 */
import { createServer, type Server } from "http";
import { ocrImage } from "../src/lib/extract/ocr";
import { normalizeTranscription, transcribeMedia } from "../src/lib/media/transcribe";
import { probeSelfHosted, readSelfHostedConfig } from "../src/lib/media/selfhost";
import { readFileSync } from "fs";

type Handler = (body: string) => { status: number; json: unknown };

function startServer(handler: Handler): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const out = handler(body);
        res.writeHead(out.status, { "content-type": "application/json" });
        res.end(JSON.stringify(out.json));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

const SECRET = "test-token-should-never-leak";

export async function runSelfHostedMediaTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, name: string) => {
    if (cond) {
      passed++;
      console.log("  ✓ " + name);
    } else {
      failed++;
      console.log("  ✗ " + name);
    }
  };
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // ---------- configuration & validation ----------
  const unset = readSelfHostedConfig("ocr", {});
  assert(!unset.configured && unset.problem === "not configured", "3b: no OCR URL configured is reported plainly (no silent assumption)");

  const envbag = process.env as Record<string, string | undefined>;
  const prevNodeEnv = envbag.NODE_ENV;
  envbag.NODE_ENV = "production";
  const plain = readSelfHostedConfig("ocr", { SOPHIRA_OCR_URL: "http://example.com/ocr" });
  envbag.NODE_ENV = prevNodeEnv;
  assert(!plain.configured && !!plain.problem, "3b: a public, non-TLS OCR endpoint is rejected in production by the shared endpoint rule");

  const priv = readSelfHostedConfig("ocr", {
    SOPHIRA_OCR_URL: "http://127.0.0.1:8100",
    LOCAL_LLM_ALLOW_PRIVATE: "true",
  });
  assert(priv.configured, "3b: a private/loopback host is accepted with the existing explicit opt-in flag");

  const probeMissing = await probeSelfHosted("asr", { env: {} });
  assert(!probeMissing.configured && !probeMissing.healthy, "3b: probing an unconfigured ASR service reports unhealthy, never 'assumed working'");

  // ---------- health probe ----------
  const ping = await startServer(() => ({ status: 200, json: {} }));
  const probeOk = await probeSelfHosted("ocr", {
    env: { SOPHIRA_OCR_URL: ping.url, LOCAL_LLM_ALLOW_PRIVATE: "true" },
  });
  assert(probeOk.configured && probeOk.healthy, "3b: a running self-hosted service passes its health probe");
  ping.server.close();

  // ---------- OCR: confident reading ----------
  const ocrHigh = await startServer(() => ({ status: 200, json: { text: "Chapter 3: Photosynthesis", confidence: 0.94 } }));
  const rHigh = await ocrImage(bytes, "image/png", {
    env: { SOPHIRA_OCR_URL: ocrHigh.url, LOCAL_LLM_ALLOW_PRIVATE: "true" },
  });
  assert(rHigh.ok && rHigh.confidence === "high" && rHigh.engine === "tesseract-selfhost", "3b: OCR success reports the engine and a high-confidence band");
  assert(rHigh.text === "Chapter 3: Photosynthesis", "3b: OCR returns the transcript verbatim (no rewriting)");
  ocrHigh.server.close();

  // ---------- OCR: 0-100 scale + medium band ----------
  const ocrMid = await startServer(() => ({ status: 200, json: { text: "x^2 + 3x = 10", mean_confidence: 70 } }));
  const rMid = await ocrImage(bytes, "image/png", {
    env: { SOPHIRA_OCR_URL: ocrMid.url, LOCAL_LLM_ALLOW_PRIVATE: "true" },
  });
  assert(rMid.ok && rMid.confidence === "medium", "3b: a 0-100 confidence is normalized and mapped to 'medium'");
  assert(rMid.notes.toLowerCase().includes("uncertain"), "3b: an uncertain reading is described as uncertain, not sold as certain");
  ocrMid.server.close();

  // ---------- OCR: empty text is a failure, never a success ----------
  const ocrEmpty = await startServer(() => ({ status: 200, json: { text: "   ", confidence: 99 } }));
  const rEmpty = await ocrImage(bytes, "image/png", {
    env: { SOPHIRA_OCR_URL: ocrEmpty.url, LOCAL_LLM_ALLOW_PRIVATE: "true" },
  });
  assert(!rEmpty.ok && rEmpty.text === "" && rEmpty.confidence === "failed", "3b: no readable text is a FAILED result, not an empty success");
  assert(rEmpty.notes.includes("original file was kept"), "3b: an unreadable image tells the member the original is kept");
  ocrEmpty.server.close();

  // ---------- OCR: server error + token safety ----------
  const ocrErr = await startServer(() => ({ status: 500, json: { error: "boom" } }));
  const rErr = await ocrImage(bytes, "image/png", {
    env: { SOPHIRA_OCR_URL: ocrErr.url, SOPHIRA_OCR_TOKEN: SECRET, LOCAL_LLM_ALLOW_PRIVATE: "true" },
  });
  assert(!rErr.ok && rErr.confidence === "failed", "3b: a service error degrades to an honest failure");
  assert(!JSON.stringify(rErr).includes(SECRET), "3b: the OCR token never appears in any result");
  ocrErr.server.close();

  // ---------- OCR: timeout is bounded ----------
  const slow = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200);
      res.end("{}");
      return;
    }
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ text: "late", confidence: 1 }));
    }, 2000);
  });
  await new Promise<void>((r) => slow.listen(0, "127.0.0.1", () => r()));
  const slowAddr = slow.address();
  const slowUrl = `http://127.0.0.1:${typeof slowAddr === "object" && slowAddr ? slowAddr.port : 0}`;
  const rSlow = await ocrImage(bytes, "image/png", {
    timeoutMs: 150,
    env: { SOPHIRA_OCR_URL: slowUrl, LOCAL_LLM_ALLOW_PRIVATE: "true" },
  });
  assert(!rSlow.ok && rSlow.notes.toLowerCase().includes("too long"), "3b: a slow OCR service times out instead of hanging or guessing");
  slow.close();

  // ---------- Transcription: timestamps and speakers ----------
  const asrSegments = {
    text: "Welcome. Today we cover mitosis. Ask questions at the end.",
    language: "en",
    duration: 90,
    model: "whisper-small",
    segments: [
      { start: 34.5, end: 41.2, text: "Today we cover mitosis.", speaker: "SPEAKER_00" },
      { start: 0, end: 6.4, text: "Welcome.", speaker: "SPEAKER_00" },
      { start: 80, end: 88, text: "Ask questions at the end.", speaker: "SPEAKER_01" },
    ],
  };
  const asr = await startServer(() => ({ status: 200, json: asrSegments }));
  const t = await transcribeMedia(new Uint8Array(64), "lecture.mp4", "video/mp4", {
    env: { SOPHIRA_ASR_URL: asr.url, LOCAL_LLM_ALLOW_PRIVATE: "true" },
  });
  assert(t.ok && t.segments.length === 3, "3b: a transcript returns every segment the engine reported");
  assert(t.segments[0].startSec === 0 && t.segments[1].startSec === 34.5, "3b: segments are ordered by real timestamps");
  assert(t.segments.every((s) => s.endSec >= s.startSec), "3b: end times are never before start times");
  assert(t.speakers.length === 2 && t.segments[0].speaker === "SPEAKER_00", "3b: speaker labels are preserved when the engine provides them");
  assert(t.language === "en" && t.durationSec === 90 && t.model === "whisper-small", "3b: language, duration and model provenance are recorded");
  // 21.1s of speech in a 90s recording = ~23% coverage => 'medium', honestly.
  assert(t.confidence === "medium", "3b: transcript confidence reflects actual speech coverage (23% => medium, not high)");
  assert(!JSON.stringify(t).includes(SECRET), "3b: the ASR token never appears in any result");
  asr.server.close();

  // ---------- Transcription: no speaker data => no claim ----------
  const asrNoSpk = await startServer(() => ({
    status: 200,
    json: { text: "one two three", duration: 3, segments: [{ start: 0, end: 3, text: "one two three" }] },
  }));
  const tNo = await transcribeMedia(new Uint8Array(8), "a.webm", "audio/webm", {
    env: { SOPHIRA_ASR_URL: asrNoSpk.url, LOCAL_LLM_ALLOW_PRIVATE: "true" },
  });
  assert(tNo.ok && tNo.speakers.length === 0 && tNo.notes.includes("does not claim"), "3b: with no diarization data Sophira says it does not know who spoke");
  asrNoSpk.server.close();

  // ---------- Transcription: empty result is a failure ----------
  const asrEmpty = await startServer(() => ({ status: 200, json: { text: "", segments: [] } }));
  const tEmpty = await transcribeMedia(new Uint8Array(8), "silent.mp4", "video/mp4", {
    env: { SOPHIRA_ASR_URL: asrEmpty.url, LOCAL_LLM_ALLOW_PRIVATE: "true" },
  });
  assert(!tEmpty.ok && tEmpty.segments.length === 0 && tEmpty.confidence === "failed", "3b: silence is a failure, never a fabricated summary");
  asrEmpty.server.close();

  // ---------- Transcription: untimed segments are dropped, not invented ----------
  const normalized = normalizeTranscription({
    text: "fallback text",
    duration: 12,
    segments: [{ text: "no timing here" }, { start: 2, end: 5, text: "timed" }],
  });
  assert(normalized.segments.length === 1 && normalized.segments[0].text === "timed", "3b: a segment without timings is dropped rather than given invented ones");
  assert(normalizeTranscription({}).segments.length === 0, "3b: an empty payload yields zero segments (no fabrication)");

  // ---------- Wiring pins ----------
  const route = readFileSync("src/app/api/extract/route.ts", "utf8");
  assert(route.includes("ocrImage") && route.indexOf("ocrImage") < route.indexOf("aiConfigured()"),
    "3b: the extract route tries the free self-hosted OCR BEFORE any cloud vision call");
  assert(route.includes('engine === "tesseract-selfhost"') && route.includes("confidence: \"failed\""),
    "3b: a configured-but-unreadable scan is reported honestly instead of escalated to a guess");
  const manifest = readFileSync("src/config/env.manifest.json", "utf8");
  assert(manifest.includes("SOPHIRA_OCR_URL") && manifest.includes("SOPHIRA_ASR_URL"),
    "3b: the OCR/ASR endpoints are declared in the single env manifest (one source of truth)");

  return { passed, failed };
}
