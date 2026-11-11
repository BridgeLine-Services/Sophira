"use client";

/**
 * Composer drafts kept in the member's ENCRYPTED offline store (Phase 6, 2026-11-10).
 *
 * The encrypted store already owns the key material and the AES-GCM envelope
 * (see src/lib/offline/store.ts). This adapter only maps "a string under a key"
 * onto the store's raw backend so drafts inherit that protection instead of
 * inventing a second scheme or falling back to plain localStorage.
 */

import type { DraftStorage } from "./composer-draft";
import { offlineStack } from "@/lib/offline/client";

/** The slice of the encrypted store this adapter needs. */
export interface EncryptedBackendLike {
  backendGet(key: string): Promise<Uint8Array | null>;
  backendSet(key: string, value: Uint8Array): Promise<void>;
  backendDelete(key: string): Promise<void>;
}

export function encryptedDraftStorage(store: EncryptedBackendLike): DraftStorage {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
    async get(key) {
      const bytes = await store.backendGet(key);
      return bytes ? decoder.decode(bytes) : null;
    },
    async set(key, value) {
      await store.backendSet(key, encoder.encode(value));
    },
    async delete(key) {
      await store.backendDelete(key);
    },
  };
}

/**
 * The browser's draft storage, or null when the device cannot provide one.
 * Callers treat null as "no drafts available on this device" and keep working -
 * an unavailable draft store must never block someone from writing.
 */
export async function browserDraftStorage(): Promise<DraftStorage | null> {
  try {
    const stack = offlineStack();
    await stack.ensure();
    return encryptedDraftStorage(stack.store);
  } catch {
    return null;
  }
}
