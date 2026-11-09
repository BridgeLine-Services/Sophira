/**
 * PHASE 4C — universal autosave contract (2026-11-09).
 *
 * Pure state-machine tests plus source pins. These prove the INVARIANTS,
 * not a UI rendering: "Saved" only after server confirmation, bounded
 * retries, conflicts never resolved silently, no localStorage-only saves,
 * and the Settings surface is actually wired to the engine.
 */
import { readFileSync } from "fs";
import {
  BACKOFF_CAP_MS,
  DEFAULT_DEBOUNCE_MS,
  MAX_SAVE_ATTEMPTS,
  backoffMs,
  canRetry,
  initialSaveSnapshot,
  isRevisionConflict,
  nextSaveDelayMs,
  reduceSaveSnapshot,
  saveLabel,
  type SaveSnapshot,
} from "../src/lib/save/state";

export function runAutosaveTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, name: string) => {
    if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name); }
  };
  const step = (s: SaveSnapshot, e: Parameters<typeof reduceSaveSnapshot>[1]) => reduceSaveSnapshot(s, e);

  // ---- 1. "Saved" is ONLY reachable through server confirmation ----------
  assert(saveLabel(initialSaveSnapshot) === "", "4C: idle shows no save label");
  assert(saveLabel(step(initialSaveSnapshot, { type: "server-confirmed", at: 1 })) === "Saved",
    "4C: 'Saved' is the server-confirmed state");
  assert(step(initialSaveSnapshot, { type: "save-start" }).phase === "saving",
    "4C: a write in flight is 'saving', never 'saved'");
  assert(step(step(initialSaveSnapshot, { type: "save-start" }), { type: "save-failed", failure: "network" }).phase !== "saved",
    "4C: a FAILED save can never report saved");

  // ---- 2. Edits, retries and bounded failure ----------------------------
  let s = step(initialSaveSnapshot, { type: "edit" });
  assert(s.phase === "dirty" && saveLabel(s) === "Changes waiting to save…", "4C: edits show 'Changes waiting to save…'");
  s = step(s, { type: "save-start" });
  s = step(s, { type: "save-failed", failure: "network" });
  assert(s.phase === "retrying" && saveLabel(s).startsWith("Save failed, retrying"), "4C: first failure retries with a plain label");
  let guard = 0;
  while (s.phase === "retrying" && guard++ < 20) {
    s = step(s, { type: "save-start" });
    s = step(s, { type: "save-failed", failure: "network" });
  }
  assert(s.phase === "error" && s.attempts >= MAX_SAVE_ATTEMPTS, "4C: retries are BOUNDED (error after the max attempts, never infinite)");
  assert(saveLabel(s).includes("Your text is still here"), "4C: the error state reassures without claiming data loss");
  assert(!canRetry(s), "4C: an exhausted retry loop offers an explicit 'Try again', not automatic retries");
  assert(step(s, { type: "retry-now" }).phase === "dirty", "4C: 'Try again' restarts a fresh bounded cycle");

  // ---- 3. Backoff is monotone and capped --------------------------------
  assert(backoffMs(1) === 1000 && backoffMs(2) === 2000 && backoffMs(3) === 4000, "4C: exponential backoff 1s/2s/4s");
  assert(backoffMs(50) === BACKOFF_CAP_MS, "4C: backoff is capped (never unbounded)");

  // ---- 4. Debounce: not every keystroke --------------------------------
  assert(nextSaveDelayMs(0, 0) === DEFAULT_DEBOUNCE_MS, "4C: an edit schedules a debounced save (no write per keystroke)");
  assert(nextSaveDelayMs(DEFAULT_DEBOUNCE_MS, 100) === 0, "4C: quiet typing reaches the debounce deadline → save now");
  assert(nextSaveDelayMs(0, 10_000) === 0, "4C: the max-wait guard forces a save during long continuous typing");

  // ---- 5. Conflicts: never silent --------------------------------------
  const conflicted = step(step(step(initialSaveSnapshot, { type: "edit" }), { type: "save-start" }), { type: "conflict" });
  assert(conflicted.phase === "conflict" && saveLabel(conflicted) === "This was changed somewhere else.",
    "4C: a revision conflict has its own honest state");
  assert(step(conflicted, { type: "resolve-with-theirs", at: 5 }).phase === "saved",
    "4C: choosing the other version is recorded, not written blindly");
  assert(step(conflicted, { type: "resolve-keep-mine" }).phase === "dirty",
    "4C: keeping your own version starts a NEW save cycle (nothing overwritten silently)");
  assert(isRevisionConflict("v1", "v2") && !isRevisionConflict("v1", "v1") && !isRevisionConflict(null, "v2"),
    "4C: revision comparison flags only real server-side changes");

  // ---- 6. Source pins: the engine is real, and the surface is wired -----
  const hook = readFileSync("src/lib/save/useAutosave.ts", "utf8");
  assert(hook.includes("beforeunload") && hook.includes("visibilitychange"), "4C: save-on-navigation safeguards exist");
  assert(!/localStorage\.|sessionStorage\.|localStorage\[|setItem\(/.test(hook),
    "4C: autosave never treats browser storage as the copy of record");
  assert(hook.includes("backoffMs(") && hook.includes("reduceSaveSnapshot"), "4C: the hook uses the tested core (no parallel logic)");

  const status = readFileSync("src/components/ui/SaveStatus.tsx", "utf8");
  assert(status.includes('role="status"') && status.includes("aria-live"), "4C: the save indicator is announced to assistive tech");
  assert(status.includes("saveLabel("), "4C: the indicator renders ONLY via the tested labels");

  const settings = readFileSync("src/app/settings/page.tsx", "utf8");
  assert(settings.includes("useAutosave") && settings.includes("SaveStatus "), "4C: Settings profile form is wired to the autosave engine");
  assert(settings.includes('select("updated_at")') && settings.includes('eq("updated_at"'),
    "4C: Settings saves are revision-aware (no silent overwrites, no new schema)");
  assert(settings.includes("written.length === 0"), "4C: a lost update (0 rows) surfaces as a conflict, never as success");

  // ---- 7. Docs promise only what is true -------------------------------
  const docs = readFileSync("docs/AUTOSAVE.md", "utf8");
  assert(/not yet/i.test(docs) && docs.includes("Settings"), "4C: the autosave doc states coverage honestly (no universal claim)");

  return { passed, failed };
}
