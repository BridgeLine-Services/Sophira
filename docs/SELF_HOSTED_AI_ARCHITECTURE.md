# Sophira self-hosted AI architecture (2026-10-06)

Sophira is architected so that **no paid AI API is required**. A fresh
clone runs the complete academic assistant with AI from a self-hosted,
open-source inference server you control, or fully on-device — and if no
AI runtime is reachable, Sophira says so honestly instead of silently
calling a paid cloud provider.

```
Student
  ↓  HTTPS
Sophira frontend (Next.js — Vercel or local dev server)
  ↓  server-side API routes only (src/app/api/*)
Provider abstraction (src/lib/ai/provider.ts)
  ↓  ordered dispatch, honest per-provider reasons
1. SELF-HOSTED inference server (default path)   ← LOCAL_LLM_BASE_URL
     Ollama / llama.cpp / vLLM / LM Studio (OpenAI-compatible /v1)
2. Gemini free tier (optional, only if a key is set)
3. OpenAI (optional, PAID — inert until explicitly allowed)
   plus ON-DEVICE mode (browser model, no server at all)
```

## 1. How the local LLM works

`AI_PROVIDER=selfhost` (or `auto`, which tries self-hosted FIRST) sends
standard OpenAI-compatible requests to your own inference server:

- `LOCAL_LLM_BASE_URL` — e.g. `http://127.0.0.1:11434` (Ollama) in
  development; in production, your own server over HTTPS or a private
  network. **Nothing is hardcoded**; the endpoint is fully configurable.
- `LOCAL_LLM_MODEL` — e.g. `llama3.1:8b` (default; `ollama pull llama3.1:8b`).
- `LOCAL_LLM_API_KEY` — optional; only if your server requires a bearer
  token. Local servers normally need no key at all.

Implementation: `selfhostChat()` in `src/lib/ai/provider.ts` (POST
`{base}/v1/chat/completions`; images supported for vision models). The
runtime detector recognizes Ollama (`/api/tags`) and any OpenAI-compatible
server (`/v1/models`).

## 2. Frontend → backend

The browser only ever talks to Sophira's own API routes
(`src/app/api/ai`, `/api/math`, `/api/extract`, `/api/research`, …).
`/api/ai/health` exposes a status indicator:
`{ available, provider, model, runtime, reason }` — never a key, URL of a
private endpoint, or any other secret.

## 3. Backend → local AI server

Server-to-server, inside your infrastructure. In development the Next.js
server calls your machine's runtime; in production (e.g. Vercel) it calls
YOUR inference server — a Vercel function never runs a large model
itself (it only relays the request). Communication is standard HTTP(S).

## 4. How math works (LLM does NOT do the arithmetic)

`src/lib/math/pipeline.ts` implements the mandated flow: problem
understanding → **deterministic math engine** (`solve.ts`, mathjs-based:
arithmetic, algebra, symbolic expressions, derivatives, integrals,
matrices, systems of equations) → verification (`mathverify.ts`) → and
only THEN the local LLM explains the verified result at the student's
level. Numerical results are computed, not generated; where a problem
type is unsupported the system says so instead of pretending.

## 5. How OCR / homework images work

`/api/extract` accepts homework photos and runs them through the same
provider abstraction. With a self-hosted **vision model** (e.g.
`qwen2.5-vl` via Ollama) the image is processed by YOUR server — student
homework is never sent to an external AI provider. Images fall back
along the same ordered providers; with none configured the route says so
honestly and asks for typed/pasted text.

## 6. How embeddings / RAG work

There is no paid embedding API and no hosted vector database. Sophira's
document retrieval runs over its own Postgres (Supabase) with
deterministic chunking and keyword/BM25-style ranking, and the OFFLINE
on-device path (`docs/OFFLINE_ARCHITECTURE.md`) keeps local indexes in
the browser. No component requires OpenAI embeddings or a paid vector
service.

## 7. Document processing

PDF/DOCX/PPTX/XLSX/CSV/TXT/Markdown are parsed in-process with
open-source libraries (`/api/extract`) — no paid document-processing API.

## 8. Open-source / self-hosted components

| Capability | Component | Self-hosted? |
|---|---|---|
| LLM inference | Ollama / llama.cpp / vLLM / LM Studio (open-weight models) | yes — default path |
| Math engine | mathjs (MIT) + custom pipeline | yes (in-app) |
| Math verification | mathverify layer | yes (in-app) |
| Vision/OCR | any OpenAI-compatible vision model (e.g. qwen2.5-vl, llava) | yes |
| On-device AI | Transformers.js + open-weight ONNX models | yes (browser) |
| Documents | pdf-parse, mammoth, xlsx & co. (in-process) | yes (in-app) |
| Database/vectors | Postgres (Supabase) — your own project | yes (your DB) |
| Web search (optional) | Brave/Tavily keys OR `SEARCH_PROVIDER=local` (no external calls) | optional |

## 9. Required environment variables (normal operation — all optional)

```
LOCAL_LLM_BASE_URL=http://127.0.0.1:11434   # your inference server
LOCAL_LLM_MODEL=llama3.1:8b                 # model you pulled
```
That's the complete list for AI. No OpenAI/Anthropic/Gemini/Groq/
Together/OpenRouter/Replicate/Perplexity/Wolfram key is required.
Supabase credentials are needed for accounts/data (as before); the
on-device Offline mode needs NOTHING.

## 10. Run the complete system locally (exact commands)

```bash
git clone https://github.com/BridgeLine-Services/Sophira.git
cd Sophira
npm run setup                    # deps + .env.local + validation

# self-hosted inference server (pick one):
ollama serve                     # Ollama (installed from ollama.com)
ollama pull llama3.1:8b          # text model
ollama pull qwen2.5-vl           # optional: homework images

# configure Sophira:
npm run setup:ai -- --mode selfhost
#   then in .env.local set:
#   LOCAL_LLM_BASE_URL=http://127.0.0.1:11434
#   LOCAL_LLM_MODEL=llama3.1:8b

npm run dev                      # → http://localhost:3000
curl localhost:3000/api/ai/health   # {"available":true,"provider":"selfhost",...}
```

Tests: `npm run verify` (deps, env, AI/Supabase/search coherence, secret
scan, production build). Math solving, document processing and image
extraction are exercised by `npm test` (2,200+ contract tests).

## Privacy

Local processing first; no unnecessary external transmission; no student
documents to third-party AI providers when the self-hosted path is used;
no AI credentials in the browser or the mobile shell; the inference
endpoint is configurable per environment; Vercel functions only relay.
