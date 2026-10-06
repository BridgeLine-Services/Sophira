/**
 * Offline subsystem — at-rest encryption for locally cached academic data.
 *
 * Design (honest security posture — see docs/OFFLINE_ARCHITECTURE.md §security):
 *
 * - Records are encrypted with AES-256-GCM (authenticated): no offline
 *   cache file can be read or tampered with without the key.
 * - Record data is encrypted with a random per-install DEK (AES-256-GCM).
 * - The DEK raw bytes are only ever persisted WRAPPED under a KEK derived
 *   (PBKDF2-SHA-256, 310,000 iterations) from the install secret; the KEK
 *   itself is non-extractable and never stored. This raises the bar over plaintext, but note the HONEST
 *   limitation: browser-local storage is same-origin accessible to
 *   JavaScript, so this protects at-rest data (disk access, synced profiles,
 *   backups), not a fully-compromised same-origin script. Real defense for
 *   that case is the same-origin isolation the platform already provides
 *   (RLS, auth, no cross-user storage on the shared host).
 * - logout(): purgeOffline() deletes key material AND every offline record.
 *   After logout there is nothing recoverable left on the device.
 *
 * Node (tests) and browser share this code through globalThis.crypto.
 */

const SUBTLE = (): SubtleCrypto | null => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.subtle ?? null;
};

export const OFFLINE_KV_PREFIX = "sophira/secure/";

const KEY_ALGO: AesKeyAlgorithm = { name: "AES-GCM", length: 256 };

function bytesToB64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Random 12-byte GCM IV. */
function newIv(): Uint8Array {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  return iv;
}

interface Envelope {
  /** base64 IV */
  iv: string;
  /** base64 ciphertext+tag */
  ct: string;
  /** crypto suite marker for forward migration */
  v: 1;
}

/** Encrypt UTF-8 JSON-able data with a CryptoKey (AES-GCM). */
export async function encryptJson(key: CryptoKey, plaintext: string): Promise<Uint8Array> {
  const subtle = SUBTLE();
  if (!subtle) throw new Error("offline-crypto: WebCrypto unavailable in this runtime");
  const iv = newIv();
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const env: Envelope = { iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)), v: 1 };
  return new TextEncoder().encode(JSON.stringify(env));
}

/** Decrypt data produced by encryptJson. Throws if the key or data is wrong. */
export async function decryptJson(key: CryptoKey, blob: Uint8Array): Promise<string> {
  const subtle = SUBTLE();
  if (!subtle) throw new Error("offline-crypto: WebCrypto unavailable in this runtime");
  const env = JSON.parse(new TextDecoder().decode(blob)) as Envelope;
  if (env.v !== 1) throw new Error("offline-crypto: unknown envelope version");
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(env.iv) }, key, b64ToBytes(env.ct));
  return new TextDecoder().decode(pt);
}

/** Derive a wrapping key from an install secret (PBKDF2, 310k iterations). */
export async function deriveWrappingKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = SUBTLE();
  if (!subtle) throw new Error("offline-crypto: WebCrypto unavailable in this runtime");
  const base = await subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Generate a fresh data key (DEK). Extractable=true is REQUIRED so the raw
 * bytes can be wrapped under the KEK for persistence — the DEK is never
 * stored unwrapped (see OfflineStore.init). */
export async function generateDataKey(): Promise<CryptoKey> {
  const subtle = SUBTLE();
  if (!subtle) throw new Error("offline-crypto: WebCrypto unavailable in this runtime");
  return subtle.generateKey(KEY_ALGO, true, ["encrypt", "decrypt"]);
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function toB64(b: Uint8Array): string {
  return bytesToB64(b);
}
export function fromB64(s: string): Uint8Array {
  return b64ToBytes(s);
}
