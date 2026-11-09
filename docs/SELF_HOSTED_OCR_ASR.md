# Self-hosted OCR and transcription (Tesseract + Whisper)

**Phase 3b, 2026-11-09.** Plain English. No paid vendors, no recurring
subscription. Everything here runs on hardware you already own.

---

## 1. The honest infrastructure limit first

**Vercel cannot run Tesseract or Whisper.** Both are native programs that need
their own CPU (or GPU), their own disk, and minutes of uninterrupted time.
A Vercel serverless function is a short-lived sandbox with a size and time
limit — it cannot host them, and pretending otherwise would produce a
"feature" that fails in production.

So Sophira does what it already does for the local AI model: it **talks over
HTTPS to a small service running on your own machine**. Two optional addresses:

| Purpose | Variable | What it points at |
|---|---|---|
| Read images / scans | `SOPHIRA_OCR_URL` | a Tesseract service you run |
| Transcribe audio / video | `SOPHIRA_ASR_URL` | a Whisper server you run |

Optional bearer tokens: `SOPHIRA_OCR_TOKEN`, `SOPHIRA_ASR_TOKEN`.

**Cost: £0 / $0 additional.** The only thing it uses is the machine you
already run the local LLM on. If that machine is off, Sophira says the service
is unreachable — it never guesses.

---

## 2. What hardware you actually need

| Workload | Minimum | Comfortable |
|---|---|---|
| OCR (Tesseract, CPU only) | 1 core, 2 GB RAM | 2 cores, 4 GB RAM |
| Transcription, `whisper.cpp` base model, CPU | 4 cores, 4 GB RAM | 8 cores, 8 GB RAM |
| Transcription, `small` model, CPU | 8 cores, 8 GB RAM | 12+ cores |
| Transcription, `medium`/`large` | needs a GPU (6–10 GB VRAM) | 12 GB+ VRAM |

A one-hour lecture on a 4-core CPU with the `base` model takes roughly
15–40 minutes to transcribe. That is why video processing is designed as a
**background job**, not a request that must finish while someone waits.

If your machine is a laptop that sleeps, transcription will be interrupted.
That is a real limitation, not a bug: the job resumes from the last completed
chunk rather than starting over.

---

## 3. The two service contracts

### OCR service (Tesseract)

```
GET  /health               -> 200 {"status":"ok"}
POST /ocr                  multipart: file, language=eng
     -> 200 {"text":"...", "confidence": 0.93}      (0..1 or 0..100 both accepted)
```

### Transcription service (Whisper-compatible)

Any server implementing the OpenAI-compatible endpoint works —
`whisper.cpp`'s `server` binary and `faster-whisper-server` both do:

```
GET  /health               -> 200
POST /v1/audio/transcriptions
     multipart: file, model=whisper-1, response_format=verbose_json,
                timestamp_granularities[]=segment, diarize=true (optional)
     -> 200 {"text":"...", "language":"en", "duration":90,
             "segments":[{"start":0,"end":6.4,"text":"Welcome.","speaker":"SPEAKER_00"}]}
```

Both are open source. No account, no key, no invoice.

---

## 4. What Sophira does with the results (honesty rules)

- **Text is returned verbatim.** Sophira does not "tidy" a transcript.
- **Confidence is a band, not a promise.** `high` means the engine was sure
  about the *transcription*. It says nothing about whether the document's
  contents are true.
- **Low confidence is shown as low.** Numbers, symbols and names carry an
  explicit "check this" note.
- **Nothing readable is a failure, not an empty success.** A blank result, a
  silent recording, a timeout, or an unreachable service all end in
  "could not read this" — never in invented text.
- **Timestamps are preserved as reported**, sorted, and never invented. A
  segment without timing is dropped rather than given a made-up one.
- **Speakers are only claimed when the engine supplies them.** Otherwise the
  member is told plainly that speaker separation is unavailable.
- **The original file is always kept** in private storage.
- **Tokens never appear** in results, messages or logs.
- **Public endpoints must use HTTPS.** Media is member data; a plain-http
  public address is refused. Loopback/private addresses may stay http (that is
  how a home server is reached) and still require the existing
  `LOCAL_LLM_ALLOW_PRIVATE=true` opt-in.

---

## 5. What is built today, and what is not

**Built and tested (32 assertions, real HTTP round-trips against a stub service):**
`src/lib/media/selfhost.ts` (config + health probe), `src/lib/extract/ocr.ts`
(Tesseract client), `src/lib/media/transcribe.ts` (Whisper client with segment
normalisation). OCR is wired into the image path of `/api/extract`, ahead of any
cloud vision call.

**Not built yet (next, in order):**

1. **Video upload → audio extraction.** Needs `ffmpeg`, which has the same
   serverless problem: it must run on your machine inside the same service.
2. **Frame sampling + vision** (slides, diagrams) with per-frame timestamps.
3. **Permanent storage** of transcripts, segments and frames — a new
   migration (`media_assets`, `media_transcript_segments`, `media_frames`)
   with strict own-row RLS, plus backup-inventory coverage. Not yet created.
4. **Background job queue** so a two-hour lecture does not block a request.
5. **Study notes / Q&A over a transcript**, wired to the existing tutor paths.

Until 1–5 exist, Sophira does **not** claim video is supported. The image/OCR
half is genuinely working.

---

## 6. Turning it on (owner steps, no code)

1. On the machine that already runs your local AI model, install Tesseract and
   a Whisper server (open source; instructions in the service contract above).
2. Make both reachable from the internet over HTTPS (a tunnel such as
   Cloudflare Tunnel or Tailscale Funnel keeps it free and does not require
   opening router ports), or keep them on a private network and set
   `LOCAL_LLM_ALLOW_PRIVATE=true`.
3. In Vercel → your project → Settings → Environment Variables, add
   `SOPHIRA_OCR_URL` and/or `SOPHIRA_ASR_URL` (and tokens if you set them).
4. Redeploy, then open `/setup` → Advanced diagnostics: the new lines report
   whether each service answered its health check.
5. Try it: upload a photo of printed text. If the service is working you get
   text plus a confidence band; if it is off you get the honest "could not
   read this" message and your file is kept.
