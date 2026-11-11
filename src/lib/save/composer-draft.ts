/**
 * DURABLE COMPOSER DRAFTS (Phase 6, 2026-11-10).
 *
 * A composer is the box where a member types something that is not yet a saved
 * record: a pasted source, a note, a question. Before this, closing the tab lost
 * it. The requirement is to keep it recoverable WITHOUT writing a database row
 * every few seconds, and without keeping the only copy in memory.
 *
 * Design:
 *   - One draft per composer key (e.g. `notebook-source:<notebookId>`), so two
 *     notebooks never overwrite each other and two tabs on the SAME notebook
 *     share one draft (last write wins for the draft only - the saved record
 *     still goes through the normal server path with its own conflict rules).
 *   - The storage adapter is injected. In the browser it is the encrypted
 *     offline store (IndexedDB + AES-GCM); in tests it is memory. This module
 *     never touches localStorage directly and never decides encryption.
 *   - Reading is total: a missing, corrupt, truncated or foreign draft returns
 *     null. A draft that cannot be parsed is not a crash and not a silent
 *     overwrite of the member's current text.
 *   - Text is stored as plain text and returned as plain text. Nothing here
 *     renders markup, so pasted document content stays inert.
 */

/** Where a draft actually lives. Implementations must encrypt at rest. */
export interface DraftStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ComposerDraft {
  title: string;
  text: string;
  /** ISO timestamp of the last device write, so the UI can say "kept just now". */
  savedAt: string;
}

/** A pasted source can be long; beyond this it is a document upload, not a draft. */
export const MAX_DRAFT_CHARS = 200_000;
/** Titles are short labels; a huge one is a bug, not a note. */
export const MAX_DRAFT_TITLE_CHARS = 300;

const KEY_PREFIX = "draft/";

export class DraftTooLargeError extends Error {
  readonly name = "DraftTooLargeError";
  readonly code = "too-large";
  constructor(readonly chars: number) {
    super(`The draft is ${chars} characters, which is too long to keep on this device.`);
  }
}

export function draftKey(parts: readonly string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(":");
}

function normalize(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

/** Parse defensively: anything unexpected means "no usable draft". */
function parseDraft(raw: string | null): ComposerDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.title !== "string" || typeof rec.text !== "string") return null;
  if (typeof rec.savedAt !== "string" || Number.isNaN(Date.parse(rec.savedAt))) return null;
  return {
    title: rec.title.slice(0, MAX_DRAFT_TITLE_CHARS),
    text: rec.text.slice(0, MAX_DRAFT_CHARS),
    savedAt: rec.savedAt,
  };
}

export interface ComposerDraftStore {
  /** The last draft for this key, or null when there is nothing usable. */
  load(key: string): Promise<ComposerDraft | null>;
  /** Store the current text. Empty drafts are deleted rather than kept as noise. */
  save(key: string, draft: { title?: string; text: string }): Promise<ComposerDraft>;
  /** Forget the draft (called after the real record is saved, or on request). */
  clear(key: string): Promise<void>;
  /** True when a usable draft exists - used to decide whether to offer a restore. */
  has(key: string): Promise<boolean>;
}

export function makeComposerDrafts(
  storage: DraftStorage,
  now: () => Date = () => new Date(),
): ComposerDraftStore {
  const storageKey = (key: string) => `${KEY_PREFIX}${key}`;

  return {
    async load(key) {
      if (!key) return null;
      try {
        return parseDraft(await storage.get(storageKey(key)));
      } catch {
        // A backend that cannot be read is not a lost draft we can prove;
        // report "nothing usable" and let the member keep typing.
        return null;
      }
    },

    async save(key, draft) {
      if (!key) throw new Error("A draft needs a key so it can be found again.");
      const text = normalize(draft.text ?? "");
      const title = (draft.title ?? "").slice(0, MAX_DRAFT_TITLE_CHARS);
      if (text.length > MAX_DRAFT_CHARS) throw new DraftTooLargeError(text.length);
      const record: ComposerDraft = {
        title,
        text,
        savedAt: now().toISOString(),
      };
      if (text.trim().length === 0 && title.trim().length === 0) {
        await storage.delete(storageKey(key));
        return record;
      }
      await storage.set(storageKey(key), JSON.stringify(record));
      return record;
    },

    async clear(key) {
      if (!key) return;
      try {
        await storage.delete(storageKey(key));
      } catch {
        // Nothing to do: a draft that cannot be deleted is still never shown as
        // the member's current text, because the composer only restores into
        // empty fields.
      }
    },

    async has(key) {
      return (await this.load(key)) !== null;
    },
  };
}

/** In-memory storage: used by tests and by runtimes with no device storage. */
export class MemoryDraftStorage implements DraftStorage {
  private readonly map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}
