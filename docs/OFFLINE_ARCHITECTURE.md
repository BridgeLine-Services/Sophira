# Offline Architecture (Sophira)

This document answers the offline spec point by point: what is cached
locally, how it is encrypted, which academic data is available offline,
the exact interfaces used, what can and cannot run offline, and the
lifecycle guarantees. The implementation lives in `src/lib/offline/` and
is tested end-to-end in `tests/offline.ts` (1193 checks green, including
a REAL on-device model run).

## STEP 1 — What is cached locally, and the encryption scheme

| Data | Cached offline? | Storage | Encryption |
|---|---|---|---|
| Assignment descriptions & instructions | yes | encrypted local mirror (IndexedDB) | AES-256-GCM, per-record |
| Uploaded course materials / documents | yes (the extracted text mirror; original binary files stay server-side) | encrypted local mirror | AES-256-GCM |
| Writing drafts & documents | yes | encrypted local mirror + durable queue | AES-256-GCM |
| Academic memory records | yes | encrypted local mirror | AES-256-GCM |
| Teacher / learning patterns | yes | encrypted local mirror | AES-256-GCM |
| AI response history | NOT cached by the service worker; AI answers shown in-session only unless the user saved them as a document | — | — |
| Account credentials / session | NO — auth tokens live in the platform's own storage, never in our offline store | — | — |
| Local AI model weights | yes (only after explicit consent download) | transformers.js browser cache | integrity-checked against the HF CDN manifest |
| Pending sync operations | yes | encrypted durable queue, same AES-GCM | AES-256-GCM |

**Encryption scheme (implemented in `src/lib/offline/crypto.ts`):**
- Records are encrypted with AES-256-GCM using a random 96-bit IV per
  write and an AAD binding (record path + version) so ciphertexts cannot
  be moved between records.
- The data-encryption key (DEK) is itself wrapped (encrypted) with a
  key-encryption key (KEK) derived from an install secret via PBKDF2
  (210,000 iterations). The wrapped DEK is the only key material stored.
- The install secret is a random 256-bit value held in `localStorage`
  (browser) — see §security tradeoffs.
- Tamper or wrong-key access fails closed: AES-GCM authentication
  failure throws; nothing is served decrypted.

### Security tradeoffs (honest)

- A random secret in `localStorage` protects offline data **at rest**
  (someone reading the disk/profile gets ciphertext, not academic work).
  It does **not** protect against a compromised same-origin script — no
  browser-local scheme can; the decryption key is reachable from the
  page, as it must be for the app to read its own cache.
- Native builds (Capacitor/Tauri, already scaffolded in this repo) can
  later source the install secret from Keystore/Keychain by replacing
  the `installSecret()` provider in `client.ts`. The crypto layer is
  unchanged when that swap happens.

## STEP 2 — Exact interfaces for offline storage, sync, conflict resolution

All interfaces live in `src/lib/offline/`. Summary:

- **`OfflineBackend`** (`backend.ts`): raw encrypted blob KV
  (`get/put/delete/keys`), pluggable. Implementations: `IndexedDBBackend`
  (browser), `MemoryBackend` (tests/Node).
- **`OfflineStore`** (`store.ts`): typed table CRUD over the encrypted
  backend. Records carry `version`, `origin`, `sync_status`
  (`local|synced|conflict`), `server_updated_at`, tombstone `deleted`.
- **`SyncQueue`** (`queue.ts`): durable append-only op log
  (`enqueue/list/markDone/markDead/count`) — create/update/delete ops
  with base-version metadata for reconciliation; total order by
  `(created_at, op_id)`.
- **`conflicts.ts`**: pure decision function
  `resolveOpAgainstRemote(op, localRecord, serverRow)` → `apply | drop |
  conflict`; `makeConflictRecord` preserves BOTH sides verbatim.
  Resolution API: `SyncEngine.resolveConflict(id, "keep-local" |
  "keep-remote")`.
- **`RemoteAdapter`** (`sync.ts` / `remote-supabase.ts`): `getRow`,
  `fetchChanged(since)`, `applyOp` (optimistic concurrency on
  `updated_at`), `isAuthorized`. Supabase implements it; the test suite
  implements it with an in-memory fake.
- **`SyncEngine.run()`** report: `{uploaded, pulled, conflicts, failures,
  revoked, complete, detail[]}` — one honest status object the UI shows.
- **`OfflineApi`** (`api.ts`): the app-facing CRUD that transparently
  reads the mirror when offline and the server when online.

**Conflict policy (deterministic, never silent):** last-writer-wins ONLY
when the local edit is based on the current server version; otherwise an
explicit conflict record is created (both versions preserved) and the
record is marked `conflict` for the user to resolve. Deletes race against
newer edits the same way — no side is silently discarded. Simultaneous
non-conflicting edits from two devices sync independently; the loser of a
same-record race is exactly the explicit-conflict case.

**Revocation:** if `isAuthorized()` returns false during sync, the queue
is sealed (ops marked `dead` — never retried, never uploaded), the run
reports `revoked`, and local data is purged. Nothing from a revoked
account ever reaches the server.

**Logout:** `purgeOfflineOnLogout()` destroys records, queue,
conflicts, and keys. Unsynced pending work is destroyed too — the UI
warns with an exact count before signing out. Deleting the account
(settings page) runs the same purge after the server confirms deletion.

## STEP 3 — Local model(s): sizes, capabilities, constraints

Registry: `src/lib/offline/model-registry.ts`.

| Model | Params | ~Download | Min RAM | Realistic use |
|---|---|---|---|---|
| SmolLM2 135M Instruct (q8 ONNX) | 135M | ~120 MB | ~800 MB | short writing help, rewrites, brief explanations |
| Qwen2.5 0.5B Instruct (ONNX) | 0.5B | ~400 MB | ~2.2 GB | better-quality writing help, longer context |

Honest constraints:
- Downloads are **consent-gated**: the exact approximate size and RAM
  estimate is disclosed and confirmed before anything downloads
  (`ModelManager.download` refuses `confirmed: false`).
- Integrity: the model repo manifest (file sizes + LFS sha256 oids) is
  fetched from the HF CDN and checked before a model is reported ready;
  a failed check rolls back to the previous state — never a fake
  "ready". Full local hashing of every blob is a documented non-goal
  (CDN-manifest + functional inference check instead).
- These are small models. They are real (a live on-device run is part of
  the test suite under `RUN_LIVE_MODEL=1`), but their answers are
  shallower than the online model, and every offline answer is stamped
  `LOCAL MODEL · <repo>` in the UI so nobody mistakes provenance.
- Storage: models live in transformers.js's own browser cache; the sync
  store is separate and unaffected by model updates/rollbacks.
- Library loading (`src/lib/offline/load-transformers.ts`): the inference
  library is NOT bundled into the app (onnxruntime's wasm assets defeat
  webpack's static analysis, and a lean bundle matters on mobile). The
  browser loads the pinned transformers.js ESM build from jsdelivr via a
  native dynamic import on first use. Honest consequence: the FIRST use of
  offline AI in a fresh browser session needs the network once to fetch
  the library (~ a few MB); after that, inference runs entirely
  on-device, and the consented model weights are cached. With no network
  at all in a fresh session, offline AI reports that honestly instead of
  failing silently. Node (tests, native runtimes) uses the pinned npm
  package directly.

## STEP 4 — What works offline, what does not

**Works offline (implemented + tested):**
- reading assignments, materials, documents, memories, patterns
- creating/editing documents and assignments (queued + reconciled)
- writing assistance / rewriting / basic generation (local model)
- math problem solving (deterministic mathjs engine — no model needed)
- machine verification (pure-TS checker, `mathverify.ts`)
- teacher-rule application (learning-pattern engine over local mirror)
- academic memory recall (encrypted local mirror)
- every response carries a provenance stamp (local vs remote + model)

**Online-only (surfaced in the UI, never faked):**
- live web research / new citations (search provider + fetching)
- extraction of newly uploaded PDF/DOCX (server-side parsing)
- cross-checking against fresh sources
- full-quality long-form AI work (the online model)

## STEP 5 — What still requires the server

Everything in "online-only" above, plus: authentication, the initial
mirror hydration (you must sync once while online before offline mode
has data), and multi-device propagation (a change only appears on the
other device after both sync).

## Install / run

- `npm install` (dependency `@huggingface/transformers` is pinned in
  package.json; it is imported lazily so the app bundle only pays for it
  when a local model is actually used).
- `npm test` — full suite including the 17-step offline lifecycle.
- `RUN_LIVE_MODEL=1 npm test` — additionally downloads a real SmolLM2
  model (~120 MB) and executes genuine on-device inference.

## Deployment checklist

- No new server environment variables are required for the offline
  subsystem (it reuses the existing Supabase browser client).
- `/offline` is an authenticated page behind the existing middleware.
- The service worker policy is unchanged: it still never caches HTML or
  API responses — offline data comes from the encrypted store, not the
  SW cache.
- Vercel/Node: no server-side changes; all offline code runs in the
  browser (or in Node for tests via the pluggable backend).
