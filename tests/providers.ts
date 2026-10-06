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
import {
  capabilityRegistry,
  noUnexpectedCharges,
  startupDiagnostics,
  VERIFIED_FREE_TIER_GEMINI_MODELS,
} from "../src/lib/ai/capabilities";

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

  section("provider: paid MODEL rejected under zero-billing (server-side)");
  {
    // a model NOT on the verified free-tier list is rejected when paid AI is off
    p = resolveProviders(ENV({ GEMINI_API_KEY: "g", GEMINI_MODEL: "gemini-2.5-pro" }));
    assert(p.candidates.length === 0, "unverified (potentially paid) Gemini model is REJECTED when ALLOW_PAID_AI=false");
    assert((p.reasons.gemini || "").includes("REJECTED"), "rejection reason names the model policy");
    assert(
      (p.reasons.gemini || "").includes("verified free-tier"),
      "rejection reason tells the owner how to fix it honestly"
    );
    // explicit paid opt-in allows the same model (owner decision, not silent)
    p = resolveProviders(ENV({ GEMINI_API_KEY: "g", GEMINI_MODEL: "gemini-2.5-pro", ALLOW_PAID_AI: "true" }));
    assert(p.candidates.length === 1 && p.candidates[0] === "gemini", "explicit ALLOW_PAID_AI=true permits owner-chosen models");
    // the default model is on the verified list
    assert(
      VERIFIED_FREE_TIER_GEMINI_MODELS.includes(GEMINI_DEFAULT_MODEL),
      "the default Gemini model is on the verified free-tier list"
    );
  }

  section("provider: missing Gemini key handled gracefully + local fallback");
  {
    let fetchCalls = 0;
    const fetchFn = (() => {
      fetchCalls += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    let err: unknown = null;
    try {
      await serverAiChat([{ role: "user", content: "hi" }], {}, ENV({}), { fetchFn });
    } catch (e) {
      err = e;
    }
    assert(err instanceof AiProviderUnavailableError, "missing Gemini key degrades to an honest unavailable error, never a fake answer");
    const msg = (err as { message?: string }).message || "";
    assert(msg.includes("GEMINI_API_KEY") && msg.includes("free tier"), "graceful error explains the free path");
    assert(msg.toLowerCase().includes("offline") || msg.toLowerCase().includes("local"), "graceful error points to the LOCAL/offline fallback");
    assert(fetchCalls === 0, "no network call is made when no provider is configured");
  }

  section("provider: routing matrix — free-first policy pinned case by case");
  {
    // 1. no keys -> no remote provider (auto)
    let plan = resolveProviders(ENV({ AI_PROVIDER: "auto" }));
    assert(plan.candidates.length === 0, "matrix: no keys -> no remote provider (honest unavailable, never fabricated)");

    // 2. Gemini key + VERIFIED free model -> Gemini selected
    plan = resolveProviders(ENV({ AI_PROVIDER: "auto", GEMINI_API_KEY: "gk" }));
    assert(plan.candidates[0] === "gemini", "matrix: Gemini key + verified free model -> Gemini selected");

    // 3. Gemini key + UNVERIFIED model + paid disabled -> Gemini rejected (fail closed)
    plan = resolveProviders(ENV({ AI_PROVIDER: "auto", GEMINI_API_KEY: "gk", GEMINI_MODEL: "gemini-9-unverified" }));
    assert(!plan.candidates.includes("gemini"), "matrix: Gemini key + unverified model + paid disabled -> Gemini REJECTED before any network call");
    assert((plan.reasons.gemini || "").includes("REJECTED"), "matrix: the rejection reason is stated honestly");

    // 4. OpenAI key + paid disabled -> OpenAI rejected (never silently spend money)
    plan = resolveProviders(ENV({ AI_PROVIDER: "auto", OPENAI_API_KEY: "sk" }));
    assert(!plan.candidates.includes("openai"), "matrix: OpenAI key + paid disabled -> OpenAI IGNORED (zero-billing fail-closed)");
    assert((plan.reasons.openai || "").includes("IGNORED"), "matrix: the OpenAI ignore reason names the zero-billing policy");

    // 5. OpenAI key + paid EXPLICITLY enabled -> OpenAI may be selected
    plan = resolveProviders(ENV({ AI_PROVIDER: "auto", OPENAI_API_KEY: "sk", ALLOW_PAID_AI: "true" }));
    assert(plan.candidates.includes("openai"), "matrix: OpenAI key + paid explicitly enabled -> OpenAI selectable");

    // 6. auto mode prefers Gemini over OpenAI (both configured, paid allowed)
    plan = resolveProviders(ENV({ AI_PROVIDER: "auto", GEMINI_API_KEY: "gk", OPENAI_API_KEY: "sk", ALLOW_PAID_AI: "true" }));
    assert(plan.candidates[0] === "gemini" && plan.candidates.includes("openai"), "matrix: auto mode prefers Gemini (free) over OpenAI (paid)");
  }
section("provider: offline (AI_PROVIDER=local) NEVER contacts remote AI");
  {
    let fetchCalls = 0;
    const fetchFn = (() => {
      fetchCalls += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    let threw: unknown = null;
    try {
      await serverAiChat([{ role: "user", content: "hi" }], {}, ENV({ AI_PROVIDER: "local", GEMINI_API_KEY: "g", OPENAI_API_KEY: "sk" }), { fetchFn });
    } catch (e) {
      threw = e;
    }
    assert(threw instanceof AiProviderUnavailableError, "local mode throws the honest unavailable error server-side");
    assert(fetchCalls === 0, "offline mode performs ZERO remote calls even with keys configured");
  }

  section("provider: capability registry + No Unexpected Charges setting");
  {
    const reg = capabilityRegistry({ GEMINI_MODEL: "gemini-2.5-flash", SOPHIRA_MODEL: "gpt-4o-mini" });
    const requiredFields = [
      "provider", "model", "online_required", "free_tier", "paid_capable",
      "billing_required", "multimodal", "max_context", "research_tools", "local",
    ];
    for (const row of reg) {
      for (const f of requiredFields) {
        assert(f in row, `registry row ${row.provider}/${row.model} defines field ${f}`);
      }
    }
    assert(reg.length >= 4, "registry covers local models + gemini + optional openai");
    const gem = reg.find((r) => r.provider === "gemini")!;
    assert(gem.free_tier === true && gem.online_required === true && gem.billing_required === false, "gemini row: free tier, online, no billing account");
    const oai = reg.find((r) => r.provider === "openai")!;
    assert(oai.paid_capable === true && oai.billing_required === true && oai.free_tier === false, "openai row honestly marked paid/billing-required");
    assert(reg.filter((r) => r.provider === "local").every((r) => r.online_required === false && r.local === true), "local rows: offline + on-device");

    const settingOn = noUnexpectedCharges(false);
    assert(settingOn.enabled === true && settingOn.detail.includes("rejected server-side"), "No Unexpected Charges ON states server-side rejection");
    const settingOff = noUnexpectedCharges(true);
    assert(settingOff.enabled === false && settingOff.detail.includes("explicitly allowed"), "No Unexpected Charges OFF reflects an explicit owner decision");
  }

  section("provider: startup diagnostics return ONLY the five allowed fields, never secrets");
  {
    const d = startupDiagnostics(readAiEnv({ GEMINI_API_KEY: "g-secret-startup", GEMINI_MODEL: "gemini-2.5-flash", OPENAI_API_KEY: "sk-secret-startup" }));
    const keys = Object.keys(d).sort();
    assert(
      JSON.stringify(keys) === JSON.stringify(["configured_model", "configured_provider", "free_tier_mode", "local_model_availability", "paid_ai_allowed"]),
      "startup diagnostic endpoint returns exactly the five allowed fields"
    );
    assert(d.free_tier_mode === true, "free-tier mode true with a verified free model");
    assert(d.paid_ai_allowed === "no", "paid AI allowed reports 'no' under defaults");
    assert(d.local_model_availability.available === true && Array.isArray(d.local_model_availability.model_ids), "local model availability lists registered models");
    assert(d.configured_model === "gemini-2.5-flash", "configured model reported");
    const flat = JSON.stringify(d);
    assert(!flat.includes("g-secret-startup") && !flat.includes("sk-secret-startup"), "startup diagnostics NEVER contain secret values");
    assert(!flat.toLowerCase().includes("key"), "startup diagnostics never even mention key material");
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

  // 4. NO secret in localStorage / IndexedDB: every source file that touches
  //    browser storage must never reference a secret name.
  const SECRET_NAMES = ["OPENAI_API_KEY", "GEMINI_API_KEY", "SEARCH_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const { readdirSync, statSync, readFileSync: rf } = await import("node:fs");
  const walkSrc = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const fp = join(dir, name);
      const st = statSync(fp);
      if (st.isDirectory()) out.push(...walkSrc(fp));
      else if (fp.endsWith(".ts") || fp.endsWith(".tsx")) out.push(fp);
    }
    return out;
  };
  const storageRe = /localStorage\.|sessionStorage\.|indexedDB\.|openDB\(|navigator\.storage\./i;
  let storageFiles = 0;
  for (const fp of walkSrc(join(process.cwd(), "src"))) {
    const src = rf(fp, "utf8");
    if (!storageRe.test(src)) continue;
    storageFiles += 1;
    for (const secret of SECRET_NAMES) {
      assert(
        !src.includes(secret),
        `no secret name in storage-touching file ${fp} (localStorage/IndexedDB must never hold ${secret})`
      );
    }
  }
  assert(storageFiles > 0, "the scan actually inspected storage-touching source files");

  // 5. NO secret reaches CLIENT code: any file containing a secret name must
  //    be server-only — an API route, a server module, or a file without
  //    "use client" under lib.
  let violations = 0;
  for (const fp of walkSrc(join(process.cwd(), "src"))) {
    const src = rf(fp, "utf8");
    const hasSecret = SECRET_NAMES.some((n) => src.includes(n));
    if (!hasSecret) continue;
    const isClient = src.startsWith('"use client"') || src.startsWith("'use client'");
    const inClientTree = /src\/components\//.test(fp) || /src\/app\/(?!api)/.test(fp);
    if (isClient || (inClientTree && !/src\/app\/api\//.test(fp))) violations += 1;
  }
  assert(violations === 0, "no client-side source file references any API secret name");

  // 6. NO secret returned from API endpoints: the diagnostics helpers the
  //    endpoints serialize contain no secret values even when keys are set
  //    (re-checked here at the endpoint-shape level).
  const { startupDiagnostics } = await import("../src/lib/ai/capabilities");
  const { providerDiagnostics: pd, readAiEnv: re } = await import("../src/lib/ai/provider");
  const start = JSON.stringify(startupDiagnostics(re({ GEMINI_API_KEY: "g-ep-secret", OPENAI_API_KEY: "sk-ep-secret" })));
  assert(!start.includes("g-ep-secret") && !start.includes("sk-ep-secret"), "startup endpoint payload carries no secrets");
  const diag = JSON.stringify(pd(re({ GEMINI_API_KEY: "g-ep-secret2", OPENAI_API_KEY: "sk-ep-secret2" })));
  assert(!diag.includes("g-ep-secret2") && !diag.includes("sk-ep-secret2"), "provider-status payload carries no secrets");
}
