#!/usr/bin/env node
import { readFileSync } from "fs";

console.log("Sophira live model check\n");
console.log("This performs a network reachability check of the smallest local model's");
console.log("download source (a HEAD request — NOT the full weight download).");
console.log("Model weights are downloaded inside Sophira (Offline page), on your device.\n");

if (!process.argv.includes("--yes")) {
  console.log("No network call made. Re-run with --yes to allow the reachability check:");
  console.log("  npm run local:test:model -- --yes\n");
  process.exit(0);
}

const reg = readFileSync("src/lib/offline/model-registry.ts", "utf8");
const m = reg.match(/id:\s*"smollm2-135m-instruct"([\s\S]*?)\n    },/);
const urlMatch = m && m[1].match(/"(https?:\/\/[^"]+)"/);
const url = urlMatch ? urlMatch[1] : null;
if (!url) { console.log("FAIL: no download URL recorded for the smallest model"); process.exit(1); }
console.log("Smallest model: smollm2-135m-instruct (TIER 1: PHONE/LIGHTWEIGHT)");
console.log("Download source: " + url);
try {
  const res = await fetch(url, { method: "HEAD" });
  const size = res.headers.get("content-length");
  console.log("Reachability: HTTP " + res.status + (size ? " (size: " + Math.round(Number(size) / 1024 / 1024) + " MB)" : ""));
  console.log("\nRESULT: " + (res.ok ? "PASS — the model source is reachable; complete the download inside Sophira's Offline page." : "FAIL — the source is not reachable"));
  process.exit(res.ok ? 0 : 1);
} catch (e) {
  console.log("RESULT: FAIL — " + e.message);
  process.exit(1);
}
