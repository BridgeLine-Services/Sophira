/**
 * DURABLE COMPOSER DRAFTS - regression suite (Phase 6, 2026-11-10).
 *
 * The promise to the member is narrow and must be exact:
 *   - text typed into a composer comes back after the page is closed,
 *   - nothing is written to the database to make that happen,
 *   - a broken or foreign draft never crashes the page and never replaces
 *     text the member is currently typing.
 */

import { readFileSync } from "fs";
import { join } from "path";
import {
  MAX_DRAFT_CHARS,
  MemoryDraftStorage,
  draftKey,
  makeComposerDrafts,
} from "../src/lib/save/composer-draft";

type Assert = (condition: boolean, name: string) => void;

export async function runComposerDraftTests(assert: Assert, section: (t: string) => void): Promise<void> {
  section("Phase 6: composer drafts survive a closed tab without touching the database");

  const storage = new MemoryDraftStorage();
  const at = (iso: string) => () => new Date(iso);
  const drafts = makeComposerDrafts(storage, at("2026-11-10T12:00:00.000Z"));
  const key = draftKey(["notebook-source", "nb-123"]);

  // ---- a draft survives a reload ---------------------------------------
    await drafts.save(key, { title: "Thermo notes", text: "Second law: entropy always increases." });
    const reopened = makeComposerDrafts(storage, at("2026-11-10T13:00:00.000Z"));
    const recovered = await reopened.load(key);
    assert(recovered !== null, "draft: text typed into the composer is still there after the page is closed");
    assert(recovered?.text === "Second law: entropy always increases.", "draft: the recovered text is exactly what was typed");
    assert(recovered?.title === "Thermo notes", "draft: the title is recovered too");
    assert(recovered?.savedAt === "2026-11-10T12:00:00.000Z", "draft: the recovery carries the time it was kept, so the page can say when");

  // ---- two notebooks never share a draft -------------------------------
    const other = draftKey(["notebook-source", "nb-999"]);
    await drafts.save(other, { title: "", text: "A different notebook's draft." });
    const mine = await drafts.load(key);
    const theirs = await drafts.load(other);
    assert(mine?.text === "Second law: entropy always increases." && theirs?.text === "A different notebook's draft.",
      "draft: one notebook's composer never shows another notebook's draft");

  // ---- clearing is real ------------------------------------------------
    await drafts.clear(key);
    assert((await drafts.load(key)) === null, "draft: saving the real source clears the draft so it cannot come back");
    assert((await drafts.load(other)) !== null, "draft: clearing one composer leaves other composers alone");
    assert(await drafts.has(key) === false, "draft: the page can ask whether there is anything to restore");

  // ---- empty text is not a draft --------------------------------------
    await drafts.save(key, { title: "   ", text: "\n\n   " });
    assert((await drafts.load(key)) === null, "draft: typing and deleting everything leaves no empty draft behind");

  // ---- a corrupt draft is ignored, not fatal ---------------------------
    const corrupt = new MemoryDraftStorage();
    await corrupt.set(`draft/${key}`, "{ this is not json");
    const fromCorrupt = makeComposerDrafts(corrupt);
    assert((await fromCorrupt.load(key)) === null, "draft: an unreadable draft is ignored instead of breaking the page");

    const foreign = new MemoryDraftStorage();
    await foreign.set(`draft/${key}`, JSON.stringify({ title: "x", text: "y", savedAt: "not-a-date" }));
    assert((await makeComposerDrafts(foreign).load(key)) === null, "draft: a draft with no usable timestamp is not trusted");

  // ---- a failing store never claims success ----------------------------
    const broken = {
      async get(): Promise<string | null> { throw new Error("storage is unavailable"); },
      async set(): Promise<void> { throw new Error("storage is unavailable"); },
      async delete(): Promise<void> { throw new Error("storage is unavailable"); },
    };
    const fromBroken = makeComposerDrafts(broken);
    assert((await fromBroken.load(key)) === null, "draft: an unavailable device store reads as 'no draft', not as a crash");
    await fromBroken.clear(key); // must not throw
    assert(true, "draft: clearing an unavailable store does not throw at the member");

  // ---- size limits are enforced, not silently truncated ----------------
    await drafts.save(key, { title: "big", text: "x".repeat(MAX_DRAFT_CHARS) });
    assert((await drafts.load(key))?.text.length === MAX_DRAFT_CHARS, "draft: a very long paste is still kept up to the limit");
    let refused = false;
    try {
      await drafts.save(key, { title: "bigger", text: "x".repeat(MAX_DRAFT_CHARS + 1) });
    } catch (err) {
      refused = (err as { code?: string }).code === "too-large";
    }
    assert(refused, "draft: text beyond the device limit is refused with a clear reason rather than quietly cut");

  // ---- plain text stays plain text ------------------------------------
    const html = "<img src=x onerror=alert(1)> & <script>alert(2)</script>";
    await drafts.save(key, { title: "html", text: html });
    assert((await drafts.load(key))?.text === html, "draft: pasted markup is kept as written - it is text, never rendered here");

  // ---- windows line endings do not multiply ---------------------------
    await drafts.save(key, { title: "", text: "line one\r\nline two" });
    assert((await drafts.load(key))?.text === "line one\nline two", "draft: carriage returns are normalised once, so restoring twice cannot double them");

  // ---- the composer is actually connected to this ---------------------
    const page = readFileSync(join(__dirname, "..", "..", "src", "app", "notebooks", "[id]", "page.tsx"), "utf8");
    assert(page.includes("useComposerDraft") && page.includes("composer.keep"),
      "draft: the notebook composer keeps a draft as the member types");
    assert(page.includes("await composer.clear()"),
      "draft: adding the real source clears its draft");
    const draftsSource = readFileSync(join(__dirname, "..", "..", "src", "lib", "save", "composer-draft.ts"), "utf8");
  // Strip comments first: the module docstring legitimately NAMES localStorage
  // while saying it is not used. Real usage is what matters.
  const draftsCode = draftsSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "");
  assert(!/localStorage\s*\.|sessionStorage\s*\./i.test(draftsCode),
    "draft: the draft module never falls back to unencrypted browser storage on its own");
}
