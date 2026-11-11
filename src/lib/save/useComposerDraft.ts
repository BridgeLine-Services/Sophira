"use client";

/**
 * React binding for durable composer drafts (Phase 6, 2026-11-10).
 *
 * Behaviour the member sees:
 *   - Type, and the text is kept on this device a moment later ("Draft kept").
 *   - Close the tab, come back, and the box is filled again ("Draft restored").
 *   - Save the real record and the draft is cleared, so it never reappears.
 *
 * Behaviour on failure is deliberately quiet: a draft store that is missing or
 * broken reports "Draft not kept on this device" and the member keeps typing.
 * Nothing here ever removes text from the box.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_DRAFT_CHARS,
  makeComposerDrafts,
  type ComposerDraft,
  type ComposerDraftStore,
  type DraftStorage,
} from "./composer-draft";

export type DraftStatus = "idle" | "restored" | "keeping" | "kept" | "unavailable" | "failed";

export interface UseComposerDraft {
  status: DraftStatus;
  savedAt: string | null;
  /** Plain-language line for the UI, or null when there is nothing to say. */
  message: string | null;
  /** Read the stored draft (call once the composer is on screen). */
  restore: () => Promise<ComposerDraft | null>;
  /** Ask for the text to be kept. Debounced by the hook. */
  keep: (value: { title?: string; text: string }) => void;
  /** Forget the draft (after a successful save, or when the member asks). */
  clear: () => Promise<void>;
}

export interface UseComposerDraftOptions {
  /** Where drafts live. Resolved lazily by the caller (browser: encrypted store). */
  storage: () => Promise<DraftStorage | null>;
  key: string | null;
  debounceMs?: number;
}

const MESSAGES: Record<DraftStatus, string | null> = {
  idle: null,
  restored: "Draft restored from this device.",
  keeping: "Keeping your draft…",
  kept: "Draft kept on this device.",
  unavailable: "This device cannot keep a draft. Your text stays until you close the page.",
  failed: "Sophira could not keep the draft just now. Your text is still here.",
};

export function useComposerDraft({ storage, key, debounceMs = 800 }: UseComposerDraftOptions): UseComposerDraft {
  const [status, setStatus] = useState<DraftStatus>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const storeRef = useRef<ComposerDraftStore | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ title?: string; text: string } | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const ensureStore = useCallback(async (): Promise<ComposerDraftStore | null> => {
    if (storeRef.current) return storeRef.current;
    const ready = await storage();
    if (!ready) return null;
    storeRef.current = makeComposerDrafts(ready);
    return storeRef.current;
  }, [storage]);

  const restore = useCallback(async (): Promise<ComposerDraft | null> => {
    if (!key) return null;
    const store = await ensureStore();
    if (!store) {
      if (aliveRef.current) setStatus("unavailable");
      return null;
    }
    const draft = await store.load(key);
    if (!aliveRef.current) return draft;
    if (draft) {
      setSavedAt(draft.savedAt);
      setStatus("restored");
    }
    return draft;
  }, [ensureStore, key]);

  const flush = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending || !key) return;
    pendingRef.current = null;
    const store = await ensureStore();
    if (!store) {
      if (aliveRef.current) setStatus("unavailable");
      return;
    }
    try {
      const saved = await store.save(key, {
        title: pending.title,
        text: pending.text.slice(0, MAX_DRAFT_CHARS),
      });
      if (!aliveRef.current) return;
      setSavedAt(saved.savedAt);
      setStatus("kept");
    } catch {
      if (aliveRef.current) setStatus("failed");
    }
  }, [ensureStore, key]);

  const keep = useCallback(
    (value: { title?: string; text: string }) => {
      if (!key) return;
      pendingRef.current = value;
      if (aliveRef.current) setStatus("keeping");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flush();
      }, debounceMs);
    },
    [debounceMs, flush, key],
  );

  const clear = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = null;
    if (!key) return;
    const store = await ensureStore();
    if (!store) return;
    await store.clear(key);
    if (!aliveRef.current) return;
    setSavedAt(null);
    setStatus("idle");
  }, [ensureStore, key]);

  const message = useMemo(() => MESSAGES[status], [status]);

  return { status, savedAt, message, restore, keep, clear };
}
