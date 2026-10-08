/**
 * DOCTOR (2026-10-07): the one-command plain-English setup checklist.
 * npm run doctor must: print exactly six checks, give every ❌/⚠️ an
 * exact next step, never print secret values, honor the zero-billing
 * policy, and exit non-zero while anything required is unconfirmed.
 */
import { spawn, spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { createServer, type Server } from "http";

const SENTINEL = "sk-supersecret-doctor-sentinel-1234567890";
const BARE_ENV = { PATH: process.env.PATH } as NodeJS.ProcessEnv;

function doctor(args: string[], env: NodeJS.ProcessEnv = BARE_ENV) {
  return spawnSync("node", ["scripts/doctor.mjs", ...args], { encoding: "utf8", env });
}

// Non-blocking spawn: keeps THIS process's event loop alive so mock servers
// created here can answer the doctor child process's HTTP requests.
function doctorAsync(args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", ["scripts/doctor.mjs", ...args], { env });
    let out = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.on("close", (status: number | null) => resolve({ status, stdout: out }));
  });
}

export async function runDoctorTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): Promise<void> {
  section("Doctor: one-command setup checklist");

  // The npm script exists and points at the real script
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(pkg.scripts.doctor === "node scripts/doctor.mjs", "doctor: npm run doctor is wired to scripts/doctor.mjs");

  // Self-test passes (offline contract, no network)
  const self = doctor(["--self-test"]);
  assert(self.status === 0 && self.stdout.includes("PASS"), "doctor: --self-test passes");

  // Empty environment → every required check fails WITH a next step, exit 1
  const empty = doctor([]);
  assert(empty.status === 1, "doctor: an unconfigured environment exits 1");
  for (const check of [
    "Supabase connected", "Migrations applied", "Owner account exists",
    "AI provider working", "Search provider configured (optional)", "Production URL set",
  ]) {
    assert(empty.stdout.includes(check), `doctor: the checklist prints "${check}"`);
  }
  const nextSteps = empty.stdout.split("Next step:").length - 1;
  assert(nextSteps >= 5, "doctor: every failing check names an exact next step");
  assert(empty.stdout.includes("✅") || empty.stdout.includes("❌"), "doctor: output uses plain ✅/❌ marks");

  // Fully configured offline env: Supabase / AI / Production URL are ✅; the
  // service-role key's value (the sentinel) is NEVER printed.
  writeFileSync("/tmp/doctor-env-test",
    `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co\n` +
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-not-a-secret\n` +
    `SUPABASE_SERVICE_ROLE_KEY=${SENTINEL}\n` +
    `GEMINI_API_KEY=${SENTINEL}\n` +
    `NEXT_PUBLIC_SITE_URL=https://sophira.vercel.app\n`);
  const full = doctor(["--env-file", "/tmp/doctor-env-test"]);
  assert(full.stdout.includes("✅ Supabase connected"), "doctor: configured Supabase env shows ✅");
  assert(full.stdout.includes("✅ AI provider working"), "doctor: GEMINI_API_KEY shows a working AI provider");
  assert(full.stdout.includes("✅ Production URL set"), "doctor: NEXT_PUBLIC_SITE_URL shows the production URL set");
  assert(!full.stdout.includes(SENTINEL), "doctor: no secret value is ever echoed back");

  // Zero-billing: a paid key WITHOUT ALLOW_PAID_AI is ignored, not "working"
  writeFileSync("/tmp/doctor-env-test",
    `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co\n` +
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=anon\n` +
    `OPENAI_API_KEY=${SENTINEL}\n`);
  const paid = doctor(["--env-file", "/tmp/doctor-env-test"]);
  assert(paid.stdout.includes("❌ AI provider working"), "doctor: a paid key is IGNORED unless paid use is explicitly allowed (zero-billing, fail closed)");
  assert(paid.stdout.includes("ALLOW_PAID_AI"), "doctor: the next step explains the paid opt-in switch");
  assert(!paid.stdout.includes(SENTINEL), "doctor: the ignored paid key's VALUE never appears");

  // Unreachable URL falls back to offline checks without crashing
  const down = doctor(["--url", "http://127.0.0.1:1"]);
  assert(down.status !== 0 && down.stdout.includes("Sophira doctor"), "doctor: an unreachable URL degrades to offline checks, never a crash");

  // Live mode against local mock deployments (no external network)
  const mock = createServer((req, res) => {
    if (req.url?.startsWith("/api/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, name: "sophira", configuration: { supabase: true, supabase_service_role: true, ai: true, search: true } }));
    } else if (req.url?.startsWith("/api/setup-status")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, probe: { migrationsPresent: true, ownerAccount: "active" }, checklist: { migrationsCurrent: true } }));
    } else { res.writeHead(404); res.end(); }
  });
  const mock2 = createServer((req, res) => {
    if (req.url?.startsWith("/api/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, name: "sophira", configuration: { supabase: true, ai: true, search: false } }));
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, probe: { migrationsPresent: false, ownerAccount: "unknown" }, checklist: { migrationsCurrent: false } }));
    }
  });

  const withServer = (server: Server): Promise<number> =>
    server.listening
      ? Promise.resolve((server.address() as { port: number }).port)
      : new Promise((resolve) => server.listen(0, () => resolve((server.address() as { port: number }).port)));

  const port = await withServer(mock);
  const live = await doctorAsync(["--url", `http://127.0.0.1:${port}`],
    { ...BARE_ENV, NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}` });
  assert(live.status === 0, "doctor: a fully healthy live deployment exits 0");
  assert(live.stdout.includes("✅ Migrations applied") && live.stdout.includes("✅ Owner account exists"),
    "doctor: live mode reads /api/setup-status for migration + owner truth");
  assert(live.stdout.includes("ready to use"), "doctor: success message is plain English");
  mock.close();

  const port2 = await withServer(mock2);
  const broken = await doctorAsync(["--url", `http://127.0.0.1:${port2}`],
    { ...BARE_ENV, NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port2}` });
  assert(broken.status === 1, "doctor: an uninitialized live database exits 1");
  assert(broken.stdout.includes("❌ Migrations applied") && broken.stdout.includes("Set Up Sophira"),
    "doctor: missing migrations point to the exact fix (/setup → Set Up Sophira)");
  assert(broken.stdout.includes("❌ Owner account exists") || broken.stdout.includes("Finish"),
    "doctor: the owner check names the real next action");
  mock2.close();
}
