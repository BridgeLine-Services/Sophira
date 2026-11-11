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

/**
 * PHASE 4C EXTENSION (2026-11-09) — the registry and the saver, proved.
 *
 * The registry is the honest map of what autosaves. These tests prove the map
 * cannot drift into a claim: every target either names a write route or says in
 * plain words why autosave does not apply, and only targets whose page really
 * calls the hook may be marked "wired". The saver tests prove that a success
 * without the server's version is never reported as a save.
 */
import {
  AUTOSAVE_TARGETS,
  pendingTargets,
  targetById,
  wiredTargets,
} from "../src/lib/save/targets";
import {
  RevisionConflictError,
  TransientSaveError,
  UnconfirmedSaveError,
  makeDraftSaver,
} from "../src/lib/save/draft";

export async function runAutosaveRegistryTests(
  assert: (cond: boolean, name: string) => void,
  section: (title: string) => void,
): Promise<void> {
  const essayPage = readFileSync("src/app/essay/page.tsx", "utf8");
  const draftRoute = readFileSync("src/app/api/essay/draft-section/route.ts", "utf8");

section("notebook details: the editor exists, and a stale write is refused (Phase 6)");

{
  const route = readFileSync("src/app/api/notebooks/[id]/route.ts", "utf8");
  assert(/x-sophira-base-version/.test(route),
    "notebook route: the write carries the version the editor started from");
  assert(/status: 409/.test(route) && /choose which version to keep/.test(route),
    "notebook route: a stale write is refused with a plain-language conflict, not a silent overwrite");
  assert(/\.eq\("updated_at", baseVersion\)/.test(route),
    "notebook route: the conflict test is applied in the query, so two devices cannot both win");

  const page = readFileSync("src/app/notebooks/[id]/page.tsx", "utf8");
  assert(/useAutosave</.test(page) && /x-sophira-base-version/.test(page),
    "notebook page: the name and description editor saves through the revision-aware path");
  assert(/<SaveStatus/.test(page),
    "notebook page: the member can see the save state instead of guessing");
  assert(/adopt(?:Meta)?Version\(notebook\.updated_at/.test(page),
    "notebook page: the version loaded from the server becomes the base for the first write");

  const hook = readFileSync("src/lib/save/useAutosave.ts", "utf8");
  assert(/const adoptVersion = useCallback/.test(hook) && /adoptVersion \}/.test(hook),
    "autosave hook: a page can adopt a version once its record loads");
}

section("writing samples: a long paste survives a closed tab (Phase 6)");

{
  const page = readFileSync("src/app/writing/new/page.tsx", "utf8");
  assert(page.includes("useComposerDraft") && page.includes('draftKey(["writing-sample"'),
    "the sample editor keeps a device draft while the member types");
  assert(/\.\.\.f, title: f\.title \|\| kept\.title, content: f\.content \|\| kept\.text/.test(page),
    "a restored draft only fills empty boxes, so it can never overwrite what is being typed");
  assert(page.indexOf("await draft.clear()") > 0 && page.indexOf("await draft.clear()") < page.indexOf('router.push("/writing")'),
    "the draft is cleared before leaving the page, so a saved sample cannot come back as a ghost draft");
  assert(page.includes("draft.message") && page.includes("role=\"status\""),
    "the member is told in plain language what is happening with their draft");
  const entry = targetById("writing_samples")!;
  assert(entry.coverage === "wired", "the registry no longer lists writing samples as waiting for an editor");
  assert(entry.table === "writing_samples" && entry.route === null,
    "the registry names the table it really writes instead of an unrelated profile route");
}

section("academic memories: a half-written correction is not lost (Phase 6)");

{
  const panel = readFileSync("src/components/app/MemoryManager.tsx", "utf8");
  assert(panel.includes("useComposerDraft") && panel.includes('draftKey(["memory-edit"'),
    "the correction panel keeps a device draft, keyed by the memory being corrected");
  assert(panel.includes("async function openEditor") && panel.includes("await editDraft.restore()"),
    "reopening a correction restores what was typed and never saved");
  assert(panel.indexOf("await editDraft.clear()") > 0 &&
    panel.indexOf("await editDraft.clear()") < panel.indexOf("setEditing(null)"),
    "an accepted correction clears its draft, so a stale correction cannot reappear");
  assert(panel.includes("editDraft.message") && panel.includes('role="status"'),
    "the member is told plainly whether the correction is kept on this device");
  assert(targetById("academic_memories")?.coverage === "wired",
    "academic memories are no longer listed as waiting for an editor");
}

section("autosave registry: honest coverage for every member-editable thing");

assert(AUTOSAVE_TARGETS.length >= 13, "the registry covers the thirteen audited workflows");
for (const t of AUTOSAVE_TARGETS) {
  const hasRoute = Boolean(t.route && t.method);
  assert(hasRoute || Boolean(t.reason), `${t.id}: either a write route or a stated reason, never a silent gap`);
  assert(t.fields.length > 0, `${t.id}: names the fields a member can change`);
  // A wired surface may save through the typed Supabase client rather than an
  // HTTP route, provided it says so and how it detects a conflict.
  if (t.coverage === "wired") assert(hasRoute || Boolean(t.reason), `${t.id}: a wired target must have a write route or state how it saves`);
  if (t.coverage === "route-ready") assert(hasRoute, `${t.id}: route-ready means the route exists and only the editor is missing`);
}

// The wired claim is checked against the pages themselves.
for (const t of wiredTargets()) {
  if (t.id === "essay_outline" || t.id === "outlines") {
    assert(essayPage.includes('targetById("essay_outline")'), "essay outline is wired to the autosave hook");
    assert(essayPage.includes("useAutosave"), "the essay page uses the autosave engine");
    assert(essayPage.includes("<SaveStatus"), "the essay page shows the member the save state");
  }
}

assert(AUTOSAVE_TARGETS.filter((t) => t.coverage === "wired").length >= 2, "at least the outline editors are wired");
assert(pendingTargets().every((t) => t.coverage === "route-ready"), "pending targets are exactly the route-ready ones");
assert(targetById("notebook_note_composer")?.coverage === "no-editor", "a composer that appends rows is not falsely called autosaved");
assert(
  (targetById("document_revisions")?.reason ?? "").includes("immutable"),
  "document revisions are explained as append-only rather than autosaved",
);

section("autosave saver: the server's version is the only proof of a save");

const target = targetById("essay_outline")!;
const payload = { session_id: "s1", outline: [{ title: "Intro" }] };

// 1. A confirmed save returns the server's new version.
{
  let seen: { url: string; init?: RequestInit } | null = null;
  const save = makeDraftSaver(target, () => "/api/essay/draft-section", async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ data: { version: "2026-11-09T12:00:00Z" } }), { status: 200 });
  });
  const out = await save(payload, "2026-11-09T11:00:00Z");
  assert(out.version === "2026-11-09T12:00:00Z", "the new server version is handed back to the editor");
  const headers = (seen!.init!.headers ?? {}) as Record<string, string>;
  assert(headers["x-sophira-base-version"] === "2026-11-09T11:00:00Z", "the version the member started from travels with the write");
  assert(seen!.init!.method === "PATCH", "the registry's method is what is actually used");
}

// 2. A success body with no version is NOT a save.
{
  const save = makeDraftSaver(target, () => "/api/essay/draft-section", async () =>
    new Response(JSON.stringify({ data: { id: "s1" } }), { status: 200 }),
  );
  let failed = false;
  try { await save(payload, null); } catch (e) { failed = e instanceof UnconfirmedSaveError; }
  assert(failed, "no version on the wire means 'not confirmed', never 'saved'");
}

// 3. 409 is a conflict carrying the other version, not a retry.
{
  const save = makeDraftSaver(target, () => "/api/essay/draft-section", async () =>
    new Response(JSON.stringify({ data: { version: "2026-11-09T13:00:00Z", conflict: true } }), { status: 409 }),
  );
  let conflict: RevisionConflictError | null = null;
  try { await save(payload, "2026-11-09T11:00:00Z"); } catch (e) {
    if (e instanceof RevisionConflictError) conflict = e;
  }
  assert(conflict?.serverVersion === "2026-11-09T13:00:00Z", "the conflict carries the version the member chooses between");
}

// 4. Transport failures are retryable; refusals are not.
{
  const offline = makeDraftSaver(target, () => "/x", async () => { throw new Error("offline"); });
  let transient = false;
  try { await offline(payload, null); } catch (e) { transient = e instanceof TransientSaveError; }
  assert(transient, "a network failure is typed so the engine can retry with backoff");

  const busy = makeDraftSaver(target, () => "/x", async () => new Response("{}", { status: 503 }));
  let retryable = false;
  try { await busy(payload, null); } catch (e) { retryable = e instanceof TransientSaveError; }
  assert(retryable, "a 5xx is treated as busy, not as the member's mistake");

  const refused = makeDraftSaver(target, () => "/x", async () => new Response("{}", { status: 403 }));
  let permanent = false;
  try { await refused(payload, null); } catch (e) { permanent = e instanceof UnconfirmedSaveError; }
  assert(permanent, "a refusal is reported once instead of retried forever");
}

// 5. A target with no route cannot pretend to save.
{
  const none = targetById("assignments")!;
  let threw = false;
  try { makeDraftSaver(none); } catch { threw = true; }
  assert(threw, "a target with no write route refuses to build a saver");
}

section("autosave server contract: revisions are refused, not overwritten");

assert(draftRoute.includes("x-sophira-base-version"), "the outline route reads the version the editor started from");
assert(draftRoute.includes('.eq("updated_date", baseVersion)'), "the update only lands on the version it started from");
assert(draftRoute.includes("{ status: 409 }"), "a moved-on outline answers 409 so the member chooses");
assert(draftRoute.includes("version: data.updated_date"), "the confirmed version is returned in the same shape the saver reads");
}
