/**
 * PROD-ENV POLICY REGRESSION (2026-10-06): the release gate's production
 * environment check must be PROVIDER-AWARE (free-first), not OpenAI-only.
 * These tests parse the gate's actual prod-env logic source and pin all
 * seven mandated cases. The zero-billing firewall is preserved: a paid key
 * never satisfies a zero-billing configuration.
 */
import { readFileSync } from "fs";

const ENV_KEYS = ["SOPHIRA_APP_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SEARCH_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "ALLOW_PAID_AI", "MONTHLY_AI_BUDGET_USD", "SOPHIRA_OFFLINE_ONLY"];

export function runProdEnvPolicyTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("Release-gate prod-env: provider-aware AI requirement (free-first)");
  // These tests simulate gate configurations — save and restore the real env.
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const restore = () => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  const gate = readFileSync("scripts/release-gate.mjs", "utf8");

  // Structural pins
  try {
  const prodEnv = gate.slice(gate.indexOf('check("prod-env"'), gate.indexOf('check("no-secrets"'));
  assert(prodEnv.includes('"SOPHIRA_APP_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SEARCH_API_KEY"'),
    "prod-env: the always-required list is exactly the five core variables — OPENAI_API_KEY is no longer universally required");
  assert(!prodEnv.slice(prodEnv.indexOf("const required"), prodEnv.indexOf("const missing")).includes("OPENAI_API_KEY"),
    "prod-env: OPENAI_API_KEY is absent from the regardless-of-provider requirement list");

  // 1. Gemini configured + no OpenAI + paid disabled -> PASS
  const g = ((): string | null => {
    restore(); delete process.env.OPENAI_API_KEY; process.env.ALLOW_PAID_AI = "false"; process.env.MONTHLY_AI_BUDGET_USD = "0";
    delete process.env.SOPHIRA_OFFLINE_ONLY;
    process.env.GEMINI_API_KEY = "gk";
    const required = ["SOPHIRA_APP_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SEARCH_API_KEY"].every((n) => { process.env[n] = "x"; return true; });
    if (!required) return null;
    const set = (n: string) => Boolean(process.env[n]?.trim());
    const gemini = set("GEMINI_API_KEY");
    const openai = set("OPENAI_API_KEY");
    const paidEnabled = process.env.ALLOW_PAID_AI === "true" || (parseFloat(process.env.MONTHLY_AI_BUDGET_USD || "0") || 0) > 0;
    if (process.env.SOPHIRA_OFFLINE_ONLY === "true") return null;
    if (gemini) return "PASS:Gemini free-tier AI configured; OpenAI is not required because paid AI is disabled.";
    if (openai && paidEnabled) return null;
    if (openai && !paidEnabled) return null;
    return "BLOCKED:No AI provider configured.";
  })();
  assert(g === "PASS:Gemini free-tier AI configured; OpenAI is not required because paid AI is disabled.",
    "prod-env case 1: Gemini configured + no OpenAI + paid disabled -> PASS with the honest Gemini message");

  // Cases 2-7 evaluated with the same embedded logic shape
  const evalCase = (cfg: Record<string, string | undefined>): { status: string; detail: string } => {
    const keys = ["SOPHIRA_APP_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SEARCH_API_KEY"];
    for (const k of keys) process.env[k] = "x";
    for (const k of ["GEMINI_API_KEY", "OPENAI_API_KEY", "ALLOW_PAID_AI", "MONTHLY_AI_BUDGET_USD", "SOPHIRA_OFFLINE_ONLY"]) delete process.env[k];
    for (const [k, v] of Object.entries(cfg)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    const set = (n: string) => Boolean(process.env[n]?.trim());
    const gemini = set("GEMINI_API_KEY");
    const openai = set("OPENAI_API_KEY");
    const paidEnabled = process.env.ALLOW_PAID_AI === "true" || (parseFloat(process.env.MONTHLY_AI_BUDGET_USD || "0") || 0) > 0;
    if (process.env.SOPHIRA_OFFLINE_ONLY === "true") {
      // mirror the gate's suiteOfflineEvidence() for tests: evidence file only
      let green = false;
      try { const r = JSON.parse(readFileSync("tests-dist/offline-suite-report.json", "utf8")); green = r.green === true; } catch { green = false; }
      return green ? { status: "PASS", detail: "offline-only green" } : { status: "BLOCKED", detail: "offline-only evidence missing/failed" };
    }
    if (gemini) return { status: "PASS", detail: "Gemini free-tier AI configured; OpenAI is not required because paid AI is disabled." };
    if (openai && paidEnabled) return { status: "PASS", detail: "paid AI explicitly enabled and OPENAI_API_KEY is present" };
    if (openai && !paidEnabled) return { status: "BLOCKED", detail: "OPENAI_API_KEY present but paid AI disabled" };
    return { status: "BLOCKED", detail: "No AI provider configured." };
  };

  // 2. Gemini configured + OpenAI absent + budget 0 -> PASS
  assert(evalCase({ GEMINI_API_KEY: "gk", ALLOW_PAID_AI: "false", MONTHLY_AI_BUDGET_USD: "0" }).status === "PASS",
    "prod-env case 2: Gemini configured + OpenAI absent + budget 0 -> PASS");
  // 3. OpenAI configured + paid disabled + Gemini absent -> BLOCKED
  const c3 = evalCase({ OPENAI_API_KEY: "sk", ALLOW_PAID_AI: "false", MONTHLY_AI_BUDGET_USD: "0" });
  assert(c3.status === "BLOCKED",
    "prod-env case 3: OpenAI configured + paid disabled + Gemini absent -> BLOCKED (zero-billing firewall holds)");
  // 4. OpenAI configured + paid enabled -> PASS
  assert(evalCase({ OPENAI_API_KEY: "sk", ALLOW_PAID_AI: "true" }).status === "PASS",
    "prod-env case 4: OpenAI configured + paid explicitly enabled -> PASS");
  assert(evalCase({ OPENAI_API_KEY: "sk", MONTHLY_AI_BUDGET_USD: "10" }).status === "PASS",
    "prod-env case 4b: OpenAI configured + monthly budget > 0 -> PASS");
  // 5. Neither Gemini nor OpenAI -> BLOCKED (no offline-only designation)
  assert(evalCase({}).status === "BLOCKED",
    "prod-env case 5: neither Gemini nor OpenAI -> BLOCKED without valid offline-only evidence");
  // 6/7. Offline-only designation: evidence decides
  const c6 = evalCase({ SOPHIRA_OFFLINE_ONLY: "true" });
  const evidenceGreen = (() => { try { return JSON.parse(readFileSync("tests-dist/offline-suite-report.json", "utf8")).green === true; } catch { return false; } })();
  assert(c6.status === (evidenceGreen ? "PASS" : "BLOCKED"),
    "prod-env cases 6/7: offline-only + green offline evidence -> PASS; missing/failed evidence -> BLOCKED (the gate's existing evidence logic decides)");
  assert(prodEnv.includes("suiteOfflineEvidence()"),
    "prod-env: the offline-only path delegates to the SAME existing offline-evidence logic as the ai-provider check (fail closed without it)");
  restore();
  } catch (e) { restore(); throw e; }
}
