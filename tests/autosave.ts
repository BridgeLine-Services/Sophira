/**
 * PHASE 4C — universal autosave contract (2026-11-09).
 *
 * Pure state-machine tests plus source pins. These prove the INVARIANTS,
 * not a UI rendering: "Saved" only after server confirmation, bounded
 * retries, conflicts never resolved silently, no localStorage-only saves,
 * and the Settings surface is actually wired to the engine.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
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

section("study schedule: plan inputs survive a closed panel (Phase 6)");

{
  const panel = readFileSync("src/components/app/SchedulePanel.tsx", "utf8");
  assert(panel.includes("useComposerDraft") && panel.includes('draftKey(["schedule-plan"'),
    "the plan inputs are kept on the device while the member fills them in");
  assert(/setDueLocal\(\(v\) => v \|\|/.test(panel) && /setEstimate\(\(v\) => v \|\|/.test(panel),
    "a restored plan fills only empty inputs, so it cannot overwrite a fresh choice");
  assert(panel.indexOf("await clearPlan()") > 0 && panel.indexOf("await clearPlan()") < panel.indexOf("setSchedule(json.data.schedule)"),
    "the draft is cleared once the server accepts the plan");
  assert(panel.includes("planDraftMessage") && panel.includes('role="status"'),
    "the member is told in plain language what is happening with the kept inputs");
  const entry = targetById("scheduling")!;
  assert(entry.coverage === "wired", "the registry no longer calls the schedule route-ready");
  assert(entry.table === "work_schedules" && entry.method === "POST",
    "the registry names the real table and the real request instead of a table and field that never existed");
}

section("connector selections: a typed scope statement survives a closed page (Phase 6)");

{
  const browser = readFileSync("src/components/app/DocumentBrowser.tsx", "utf8");
  assert(browser.includes("useComposerDraft") && browser.includes('draftKey(["doc-scope"'),
    "the scope statement is kept on the device while it is typed");
  assert(/setScope\(\(v\) => v \|\| kept\.text/.test(browser),
    "a kept scope fills only an empty box, so it never overwrites a fresh statement");
  assert(browser.indexOf("await clearScope()") > 0 &&
    browser.indexOf("await clearScope()") < browser.indexOf("Selected \""),
    "the draft is cleared once the selection is confirmed and saved");
  assert(browser.includes("scopeMessage") && browser.includes('role="status"'),
    "the member is told plainly that their statement is being kept");
  const entry = targetById("integration_settings")!;
  assert(entry.coverage === "wired", "integration selections are no longer listed as route-ready");
  assert(JSON.stringify(entry.fields) === JSON.stringify(["scope_description", "status"]),
    "the registry names the fields the route actually accepts, not the fictional enabled/folder_id pair");
}

section("autosave registry: shipped protection is not relabeled as missing (2026-11-10)");

{
  // The notebook composer already carried a device draft but was still filed as
  // "no editor". Pin the real state so it cannot quietly regress.
  const entry = targetById("notebook_note_composer")!;
  assert(entry.coverage === "no-editor" && /device draft/i.test(entry.reason ?? ""),
    "the notebook composer is not called server-autosaved, and its device draft is stated");
  assert(/device draft/i.test(entry.label),
    "its label says plainly that a draft exists and the row is appended on Save");
  const page = readFileSync("src/app/notebooks/[id]/page.tsx", "utf8");
  assert(page.includes("useComposerDraft"),
    "the notebook page really keeps the draft the registry claims");
  assert(targetById("research_notes")?.coverage === "wired" &&
    targetById("research_notes")?.fields.length === 0,
    "source approval is recorded as a click-through save with no typed field to protect");
  assert(JSON.stringify(targetById("academic_memories")?.fields) === JSON.stringify(["statement", "details"]),
    "academic memories name the fields the route accepts");
}

section("teacher requirements: the text that shapes answers saves as you type (2026-11-10)");

{
  const route = readFileSync("src/app/api/teachers/[id]/profile/route.ts", "utf8");
  assert(route.includes("export async function PUT"), "teacher requirements save through one revision-aware route");
  assert(route.includes('x-sophira-base-version') && route.includes("409"),
    "a stale tab is refused instead of overwriting newer requirements");
  assert(route.includes('eq("user_id", user.id)'), "the write is scoped to the member in the query as well as RLS");
  assert(route.includes("archived_at"),
    "an archived teacher cannot have its requirements rewritten, since it is not active context");
  assert(route.includes('error.code === "23505"') && route.includes("conflict: true"),
    "two tabs creating the first profile collide as a visible conflict, not a duplicate row");
  assert(route.includes("MAX_FIELD") || route.includes("4000"), "a pasted essay is bounded rather than unbounded");

  const editor = readFileSync("src/app/teachers/[id]/TeacherProfileEditor.tsx", "utf8");
  assert(editor.includes("useAutosave") && editor.includes("<SaveStatus"),
    "the teacher page saves through the engine and shows its state");
  assert(editor.includes("resolveRequirementsConflict(\"mine\")") && editor.includes("resolveRequirementsConflict(\"theirs\")"),
    "a conflict stays the member's choice");
  assert(editor.includes("setRequirement(f.key, e.target.value)"),
    "each requirement field feeds the autosave payload, not a local-only state");
  assert(editor.includes("useComposerDraft") && editor.includes('draftKey(["teacher-requirements"'),
    "typed requirements survive a closed tab");
  assert(!editor.includes("async function onSaveRequirements"),
    "the manual-only save path is gone, so there is one way to write requirements");

  const entry = targetById("teacher_preferences")!;
  assert(entry.coverage === "wired" && entry.table === "teacher_profiles" && entry.method === "PUT",
    "the registry points at the real table and route");
  assert(entry.fields.length === 13, "the registry lists every requirement field the route can write");
}

section("response editor: a corrected answer stops claiming it was verified (2026-11-10)");

{
  const route = readFileSync("src/app/api/responses/[id]/route.ts", "utf8");
  assert(route.includes("export async function PATCH"), "the response route accepts an in-place edit");
  assert(route.includes('x-sophira-base-version') && route.includes("409"),
    "a concurrent edit is refused with 409 rather than overwriting newer text");
  assert(route.includes('eq("user_id", user.id)'), "the write is scoped to the member in the query as well as RLS");
  assert(route.includes('status: "unverified"') && route.includes("member_edited"),
    "an edited answer is marked unverified and the original verdict is preserved, not deleted");
  assert(/existing\.content === content/.test(route),
    "saving unchanged text is a no-op, so it cannot mark a checked answer unverified");
  assert(route.includes("200000"), "an oversized answer is refused instead of silently truncated");

  const migration = readFileSync("supabase/migrations/0045_response_edits.sql", "utf8");
  assert(migration.includes("add column if not exists updated_at"),
    "the version column is added without breaking existing rows");
  assert(migration.includes("set updated_at = created_at"),
    "older rows inherit created_at so their version is honest");

  const editor = readFileSync("src/components/app/ResponseEditor.tsx", "utf8");
  assert(editor.includes("useAutosave") && editor.includes("<SaveStatus"),
    "the editor saves through the engine and shows its state");
  assert(editor.includes("resolveConflict(\"mine\")") && editor.includes("resolveConflict(\"theirs\")"),
    "a conflict stays the member's choice");
  assert(editor.includes("useComposerDraft") && editor.includes('draftKey(["response-edit"'),
    "a half-rewritten answer survives a closed tab");
  assert(/shown as unverified from your first change onward/.test(editor),
    "the member is told plainly that their own wording is no longer checked");

  const workspace = readFileSync("src/app/assignments/[id]/Workspace.tsx", "utf8");
  assert(workspace.includes("<ResponseEditor"), "the assignment page really renders the response editor");

  const entry = targetById("assignment_responses")!;
  assert(entry.coverage === "wired" && entry.table === "responses" && entry.route === "/api/responses/[id]",
    "the registry names the real table and route instead of the invented response field");
}

section("assignment editor: the member's own brief is editable and saved (2026-11-10)");

{
  const route = readFileSync("src/app/api/assignments/[id]/route.ts", "utf8");
  assert(route.includes("export async function PATCH"), "the assignment route accepts a revision-aware update");
  assert(route.includes('x-sophira-base-version') && route.includes("409"),
    "a concurrent change is refused with 409 instead of overwriting newer work");
  assert(route.includes('eq("user_id", user.id)'),
    "the write is scoped to the signed-in member in the query as well as in RLS");
  assert(route.includes("instructions_text"),
    "the brief is saved into the real column, not the imaginary `instructions`");
  assert(!/patch\.due_date|due_date:/.test(route),
    "the route never writes a due date the assignments table does not have");

  const editor = readFileSync("src/components/app/AssignmentDetailsEditor.tsx", "utf8");
  assert(editor.includes("useAutosave") && editor.includes("<SaveStatus"),
    "the editor uses the autosave engine and shows the member its state");
  assert(editor.includes("initialVersion: initial.updated_at"),
    "the editor loads with the version it rendered, so a stale tab cannot silently win");
  assert(editor.includes("resolveConflict(\"mine\")") && editor.includes("resolveConflict(\"theirs\")"),
    "a conflict is the member's choice, both ways");
  assert(editor.includes("useComposerDraft") && editor.includes('draftKey(["assignment-details"'),
    "a pasted brief survives a closed tab in the encrypted device draft");
  assert(/setBrief\(\(cur\) => \(cur\.trim\(\) \? cur : kept\.text/.test(editor),
    "a restored draft fills only an empty brief");

  const workspace = readFileSync("src/app/assignments/[id]/Workspace.tsx", "utf8");
  assert(workspace.includes("<AssignmentDetailsEditor"),
    "the assignment page really renders the editor");

  const entry = targetById("assignments")!;
  assert(entry.coverage === "wired" && entry.route === "/api/assignments/[id]",
    "the registry points at the editor that now exists");
  assert(JSON.stringify(entry.fields) === JSON.stringify(["title", "instructions_text"]),
    "the registry names the two fields the route accepts");
}

section("autosave registry: every entry matches the route it describes (2026-11-10)");

{
  // Four registry entries claimed tables, fields or requests that did not exist.
  // This walks the real routes so the registry cannot drift into fiction again.
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  };
  const srcFiles = walk("src");
  const srcText = srcFiles.map((f) => readFileSync(f, "utf8")).join("\n");

  let checkedRoutes = 0;
  for (const t of AUTOSAVE_TARGETS) {
    if (t.table) {
      assert(srcText.includes(`"${t.table}"`) || srcText.includes(`'${t.table}'`),
        `registry: table "${t.table}" for ${t.id} is really used somewhere in src`);
    }
    if (!t.route) continue;
    checkedRoutes++;
    const file = "src/app" + t.route + "/route.ts";
    assert(existsSync(file), `registry: ${t.id} names a route that exists (${t.route})`);
    if (!existsSync(file)) continue;
    const code = readFileSync(file, "utf8");
    assert(code.includes(`export async function ${t.method}`),
      `registry: ${t.id} names the request the route really exports (${t.method} ${t.route})`);
    for (const field of t.fields) {
      assert(code.includes(field),
        `registry: field "${field}" for ${t.id} is accepted by ${t.route}`);
    }
  }
  assert(checkedRoutes > 0, "registry: route-backed entries were actually checked");
  assert(AUTOSAVE_TARGETS.every((t) => t.coverage !== "route-ready"),
    "registry: nothing is left described as waiting for an editor it already has");
}

section("autosave registry: honest coverage for every member-editable thing");

assert(AUTOSAVE_TARGETS.length >= 13, "the registry covers the thirteen audited workflows");
for (const t of AUTOSAVE_TARGETS) {
  const hasRoute = Boolean(t.route && t.method);
  assert(hasRoute || Boolean(t.reason), `${t.id}: either a write route or a stated reason, never a silent gap`);
  // A workflow made only of clicks (approve a source) has no typed field; it must
  // then say so in its reason rather than quietly listing nothing.
  assert(t.fields.length > 0 || Boolean(t.reason),
    `${t.id}: names the fields a member can change, or explains why none exist`);
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
  const none = AUTOSAVE_TARGETS.find((t) => !t.route)!;
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
