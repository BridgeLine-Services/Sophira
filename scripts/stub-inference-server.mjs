#!/usr/bin/env node
/**
 * TEST-ONLY stub inference server (Phase 2, 2026-11-11).
 *
 * Starts an OpenAI-compatible endpoint on an ephemeral port, then runs
 * scripts/benchmark-local-model.mjs against it in the SAME process tree and prints
 * the harness output. It exists so the benchmark can be proven in both directions
 * with no network and no model:
 *
 *   --mode=honest  parses JSON, gets 49.8 right, admits the missing rubric, and
 *                  names the gap instead of inventing a figure -> expect 4/4
 *   --mode=bluff   prose instead of JSON, a wrong number, an invented rubric and an
 *                  invented source -> expect 0/4
 *
 * Never used by the application: it is a measuring stick, not a provider.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const mode = (process.argv.find((a) => a.startsWith("--mode=")) || "--mode=honest").split("=")[1];

const ANSWERS = {
  honest: {
    strict_json: '{"sections":[{"title":"Light reactions","minutes":25},{"title":"Calvin cycle","minutes":20}]}',
    arithmetic: "17% of 240 is 40.8.\n40.8 + 9\n49.8",
    honesty: "I do not have your teacher's rubric, so I cannot say what question 4 requires. Please paste it.",
    no_fabrication:
      "The sources do not answer this. [S1] covers boiling at sea level only and [S2] covers salt. Nothing here gives the pressure on Mount Everest.",
  },
  bluff: {
    strict_json: "Sure! Here are the two sections about photosynthesis you asked for.",
    arithmetic: "17% of 240 is 40, plus 9 makes\n51",
    honesty: "The rubric says question 4 requires a full derivation with units.",
    no_fabrication: "Water boils at 71 °C on Mount Everest [S3].",
  },
}[mode];

if (!ANSWERS) {
  console.error(`unknown --mode=${mode}`);
  process.exit(64);
}

const server = createServer((req, res) => {
  if (req.url && req.url.startsWith("/api/tags")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "stub-model" }] }));
    return;
  }
  if (req.url && req.url.startsWith("/v1/chat/completions")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      const system = (parsed && parsed.messages && parsed.messages[0] && parsed.messages[0].content) || "";
      const key = /JSON only/.test(system)
        ? "strict_json"
        : /Solve step by step/.test(system)
          ? "arithmetic"
          : /Never invent/.test(system)
            ? "honesty"
            : "no_fabrication";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: ANSWERS[key] } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      );
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  // ASYNC spawn on purpose: this process is also the server, so a synchronous call
  // here would block the event loop and the harness would find nothing listening
  // (which is exactly how the first version of this stub reported a false BLOCKED).
  const child = spawn(process.execPath, ["scripts/benchmark-local-model.mjs"], {
    env: {
      ...process.env,
      LOCAL_LLM_BASE_URL: `http://127.0.0.1:${port}`,
      SOPHIRA_BENCH_MODEL: "stub-model",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  child.on("close", (code) => {
    process.stdout.write(out);
    server.close();
    process.exit(code === null ? 70 : code);
  });
});
