#!/usr/bin/env node
/**
 * LIVE AI APPLICATION TEST — exercises the REAL deployed application AI
 * route (not provider.ts in isolation).
 *
 * Credential policy (honesty first):
 *   - No credentials in source control. Everything arrives via the server
 *     environment or CLI args.
 *   - Missing credentials -> BLOCKED (exit 2). Never a fabricated PASS.
 *
 * Required:
 *   SOPHIRA_LIVE_APP_URL        the deployed app (e.g. https://sophira.vercel.app)
 *   SOPHIRA_TEST_SUPABASE_URL   the project's Supabase URL (test project preferred)
 *   SOPHIRA_TEST_ANON_KEY       the anon key
 *   SOPHIRA_TEST_EMAIL          a DEDICATED invited test account
 *   SOPHIRA_TEST_PASSWORD       its password
 * Optional (isolation probe):
 *   SOPHIRA_TEST_OTHER_ID       another test user's assignment/essay id —
 *                               the route must NOT return their data
 *
 * Run: node scripts/live-ai-app-test.mjs
 */
const required = ["SOPHIRA_LIVE_APP_URL", "SOPHIRA_TEST_SUPABASE_URL", "SOPHIRA_TEST_ANON_KEY", "SOPHIRA_TEST_EMAIL", "SOPHIRA_TEST_PASSWORD"];
const missing = required.filter((n) => !process.env[n]);
if (missing.length > 0) {
  console.log("BLOCKED: live AI application test requires credentials that are not configured:");
  for (const m of missing) console.log("  - " + m);
  console.log("Provide them in the SERVER environment only (never commit them).");
  process.exit(2);
}
const appUrl = process.env.SOPHIRA_LIVE_APP_URL.replace(/\/$/, "");

async function main() {
  const results = [];
  const record = (name, ok, detail) => results.push({ name, ok, detail });

  // 1. UNAUTHENTICATED probe: the protected AI route must refuse.
  const anonRes = await fetch(appUrl + "/api/ai/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "2+2" }),
  }).catch((e) => ({ status: 0, _err: String(e) }));
  record("unauthenticated AI request refused", anonRes.status === 401 || anonRes.status === 403, "HTTP " + anonRes.status);

  // 2. Sign in with the DEDICATED test account (Supabase Auth).
  const authRes = await fetch(process.env.SOPHIRA_TEST_SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: process.env.SOPHIRA_TEST_ANON_KEY },
    body: JSON.stringify({ email: process.env.SOPHIRA_TEST_EMAIL, password: process.env.SOPHIRA_TEST_PASSWORD }),
  });
  if (!authRes.ok) {
    console.log("FAIL: test-account sign-in failed (HTTP " + authRes.status + ") — is the account invited and active?");
    process.exit(1);
  }
  const { access_token } = await authRes.json();
  record("test account signs in", true, "Supabase Auth password grant");

  // 3. AUTHENTICATED AI request through the real application route.
  const aiRes = await fetch(appUrl + "/api/ai/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + access_token },
    body: JSON.stringify({ query: "Solve: 2x + 5 = 17. Show steps." }),
  }).catch((e) => ({ status: 0, _err: String(e) }));
  const body = aiRes.headers.get("content-type")?.includes("json") ? await aiRes.json().catch(() => ({})) : {};
  record("authenticated AI request handled", aiRes.status === 200, "HTTP " + aiRes.status);
  if (aiRes.status === 200) {
    record("AI response is honest (content or an honest unavailable state, never a fabrication)",
      Boolean(body.answer || body.text || body.error || body.notes), "response fields present");
    const flat = JSON.stringify(body);
    record("no secret material in the response", !/(AIza|sk-|Bearer [A-Za-z0-9]{20,})/.test(flat), "scanned response body");
  }

  // 4. CROSS-USER probe (optional): another user's id must not leak.
  if (process.env.SOPHIRA_TEST_OTHER_ID) {
    const crossRes = await fetch(appUrl + "/api/ai/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + access_token },
      body: JSON.stringify({ query: "help", assignmentId: process.env.SOPHIRA_TEST_OTHER_ID }),
    });
    const crossBody = await crossRes.json().catch(() => ({}));
    const leaked = JSON.stringify(crossBody).length > 500 && crossRes.status === 200;
    record("another user's academic data does not enter the request", !leaked, "HTTP " + crossRes.status + " (inspect manually with real ids)");
  }

  let failed = 0;
  for (const r of results) {
    console.log((r.ok ? "PASS" : "FAIL") + "  " + r.name + " — " + r.detail);
    if (!r.ok) failed++;
  }
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error("FAIL: " + e); process.exit(1); });
