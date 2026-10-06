/**
 * Provider architecture tests — free-first / zero-billing (2026-10-06).
 *
 * These run fully offline: provider SELECTION, request/response conversion,
 * fail-closed behavior, secret hygiene in errors, and the client-bundle
 * secret scan (spawned script). Live Gemini/OpenAI calls are NOT tested
 * here (no keys in CI); they surface in the release gate as BLOCKED until
 * the owner configures them.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  readAiEnv,
  resolveProviders,
  paidAllowed,
  costClassOf,
  geminiBody,
  parseGeminiText,
  serverAiChat,
  AiProviderUnavailableError,
  providerDiagnostics,
  GEMINI_DEFAULT_MODEL,
} from "../src/lib/ai/provider";

type Assert = (condition: boolean, name: string) => void;
type Section = (title: string) => void;

const ENV = (o: Record<string, string>) => readAiEnv(o);

export async function runProviderTests(assert: Assert, section: Section): Promise<void> {
  section("provider: selection + zero-billing fail-closed");
  assert(readAiEnv().AI_PROVIDER === "auto", "default mode is auto");
  assert(readAiEnv().ALLOW_PAID_AI === "false", "ALLOW_PAID_AI defaults to false");
  assert(readAiEnv().MONTHLY_AI_BUDGET_USD === "0", "monthly budget defaults to 0");
  assert(GEMINI_DEFAULT_MODEL === "gemini-2.5-flash", "safe free-tier default model (not a deprecated 1.x)");
  assert(readAiEnv().GEMINI_MODEL === "gemini-2.5-flash", "GEMINI_MODEL defaults to the safe free-tier model");

  // 1. paid key present but zero-billing → REJECTED
  let p = resolveProviders(ENV({ OPENAI_API_KEY: "sk-x" }));
  assert(p.candidates.length === 0, "paid OpenAI key alone is NOT eligible (fail closed)");
  assert((p.reasons.openai || "").includes("IGNORED"), "rejection reason explains the zero-billing policy");

  // 2. gemini free tier eligible
  p = resolveProviders(ENV({ GEMINI_API_KEY: "g" }));
  assert(p.candidates.length === 1 && p.candidates[0] === "gemini", "gemini key alone is eligible");
  assert(costClassOf("gemini") === "free-tier", "gemini classified free-tier");

  // 3. auto: free first, paid only when explicitly allowed
  p = resolveProviders(ENV({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "sk" }));
  assert(p.candidates[0] === "gemini" && p.candidates.length === 1, "auto puts free tier first and excludes un-allowed paid");
  p = resolveProviders(ENV({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "sk", ALLOW_PAID_AI: "true" }));
  assert(
    p.candidates.length === 2 && p.candidates[0] === "gemini" && p.candidates[1] === "openai",
    "explicit ALLOW_PAID_AI=true adds paid as fallback in auto"
  );

  // 4. budget > 0 also enables paid (explicit owner decision)
  assert(paidAllowed(ENV({ ALLOW_PAID_AI: "false", MONTHLY_AI_BUDGET_USD: "10" })), "budget > 0 enables paid");
  assert(!paidAllowed(ENV({ ALLOW_PAID_AI: "false", MONTHLY_AI_BUDGET_USD: "0" })), "budget 0 keeps paid off");

  // 5. explicit modes
  p = resolveProviders(ENV({ AI_PROVIDER: "local" }));
  assert(p.candidates.length === 0, "local mode: server performs no remote AI");
  p = resolveProviders(ENV({ AI_PROVIDER: "gemini" }));
  assert(p.candidates.length === 0 && (p.reasons.gemini || "").includes("unset"), "gemini mode without key fails honestly");
  p = resolveProviders(ENV({ AI_PROVIDER: "openai", OPENAI_API_KEY: "sk", ALLOW_PAID_AI: "true" }));
  assert(p.candidates.length === 1 && p.candidates[0] === "openai", "openai mode with explicit paid allowed works");

  section("provider: gemini request/response conversion (pure)");
  const body = geminiBody(
    [
      { role: "system", content: "SYS1" },
      { role: "system", content: "SYS2" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "solve" },
    ],
    { temperature: 0.1, maxTokens: 100, jsonMode: true, images: ["data:image/png;base64,AAAA"] }
  );
  assert(body.systemInstruction?.parts[0].text === "SYS1\n\nSYS2", "system messages merge into systemInstruction");
  assert(body.contents.length === 3, "non-system messages map 1:1 to contents");
  assert(body.contents[1].role === "model", "assistant maps to model role");
  const last = body.contents[2].parts;
  assert(last[0].text === "solve", "last user text preserved");
  assert(last[1]?.inlineData?.mimeType === "image/png" && last[1]?.inlineData?.data === "AAAA", "image data URL → inlineData");
  assert(body.generationConfig.responseMimeType === "application/json", "jsonMode maps to responseMimeType");
  assert(body.generationConfig.maxOutputTokens === 100, "maxTokens maps to maxOutputTokens");

  const parsed = parseGeminiText({
    candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }],
    usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
  });
  assert(parsed.text === "ab", "parts concatenate");
  assert(parsed.tokensIn === 7 && parsed.tokensOut === 3, "token usage extracted");
  assert(parseGeminiText({}).text === "", "missing candidates parse to empty (honest failure downstream)");

  section("provider: fail-closed dispatch + secret hygiene");
  {
    // no fetch is ever called when no provider is eligible
    let fetchCalls = 0;
    const fetchFn = (() => {
      fetchCalls += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    let threw: unknown = null;
    try {
      await serverAiChat([{ role: "user", content: "hi" }], {}, ENV({ OPENAI_API_KEY: "sk-secret-value" }), { fetchFn });
    } catch (e) {
      threw = e;
    }
    assert(threw instanceof AiProviderUnavailableError, "paid-only config with zero-billing throws honest unavailable error");
    assert(fetchCalls === 0, "zero-billing config makes ZERO network requests (fail closed)");
    const msg = (threw as { message?: string }).message || "";
    assert(msg.includes("GEMINI_API_KEY") || msg.includes("free tier"), "error points to the free path");
    assert(!msg.includes("sk-secret-value"), "error message NEVER contains the secret");
  }

  {
    // gemini dispatch uses the header key, never the URL
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenHeaders = (init?.headers as Record<string, string>) || {};
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "ok-answer" }] } }],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 2 },
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const r = await serverAiChat(
      [{ role: "user", content: "hi" }],
      {},
      ENV({ GEMINI_API_KEY: "gem-secret", GEMINI_MODEL: "gemini-2.5-flash" }),
      { fetchFn }
    );
    assert(r.text === "ok-answer" && r.provider === "gemini", "gemini candidate answers");
    assert(seenUrl.includes("gemini-2.5-flash:generateContent"), "model is in the path");
    assert(!seenUrl.includes("gem-secret") && !seenUrl.includes("key="), "API key NEVER appears in the URL");
    assert(seenHeaders["x-goog-api-key"] === "gem-secret", "API key travels in the x-goog-api-key header");
  }

  {
    // gemini quota failure falls back to the next ALLOWED candidate
    const calls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u.includes("generativelanguage") ? "gemini" : "openai");
      if (u.includes("generativelanguage")) return new Response("{}", { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "fallback-answer" } }] }), { status: 200 });
    }) as typeof fetch;
    const r = await serverAiChat(
      [{ role: "user", content: "hi" }],
      {},
      ENV({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "sk", ALLOW_PAID_AI: "true" }),
      { fetchFn }
    );
    assert(r.provider === "openai" && r.text === "fallback-answer", "gemini quota failure falls back to the next allowed candidate");
    assert(calls.length === 2 && calls[0] === "gemini" && calls[1] === "openai", "candidates tried in free-first order");
  }

  section("provider: diagnostics expose reasons, never secrets");
  const d = providerDiagnostics(ENV({ OPENAI_API_KEY: "sk-secret-diag" }));
  assert(d.activeProvider === null, "no active provider when only an un-allowed paid key exists");
  assert(d.openaiKeyPresent === true && d.paidAllowed === false, "diagnostics report key presence as a boolean");
  assert(!JSON.stringify(d).includes("sk-secret-diag"), "diagnostics NEVER serialize secret values");
  const d2 = providerDiagnostics(ENV({ GEMINI_API_KEY: "g-secret" }));
  assert(d2.activeProvider === "gemini" && d2.classification === "free-tier", "gemini active when configured");
  assert(!JSON.stringify(d2).includes("g-secret"), "gemini secret never serialized");
}

export async function runSecretScanTests(assert: Assert, section: Section): Promise<void> {
  section("security: client-bundle secret scan");
  // 1. script self-test (fixtures: catches a planted leak, no false positive)
  const self = execFileSync("node", ["scripts/secret-scan.mjs", "--self-test"], { encoding: "utf8" });
  assert(self.includes("PASS"), "secret-scan self-test passes");

  // 2. positive control: a planted leak in a client-like chunk MUST fail
  const tmp = join(process.cwd(), ".tmp-scan-fixture");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(
    join(tmp, "chunk-abc123.js"),
    'window.x = process.env.SUPABASE_SERVICE_ROLE_KEY; const s = "SEARCH_API_KEY";'
  );
  let failedAsExpected = false;
  try {
    execFileSync("node", ["scripts/secret-scan.mjs", "--dir", tmp]);
  } catch {
    failedAsExpected = true;
  }
  assert(failedAsExpected, "planted secret names in a client chunk FAIL the scan");

  // 3. negative control: clean code passes
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, "chunk-clean.js"), 'console.log("NEXT_PUBLIC_SUPABASE_ANON_KEY is public by design");');
  execFileSync("node", ["scripts/secret-scan.mjs", "--dir", tmp]); // throws on failure
  assert(true, "clean chunk passes (NEXT_PUBLIC_/anon names are not flagged)");
  rmSync(tmp, { recursive: true, force: true });
}
