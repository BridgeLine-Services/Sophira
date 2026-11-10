/**
 * REVISION-AWARE DRAFT SAVING (Phase 4C extension, 2026-11-09).
 *
 * Bridges the autosave hook and a real HTTP route:
 *
 *   - The version the member started from travels with every write
 *     (`x-sophira-base-version`), so the server can refuse to overwrite a newer
 *     accepted write instead of silently winning the race.
 *   - A 409 means somebody else's newer version is in the database: that is a
 *     conflict, not a retry, and the member decides.
 *   - A success response MUST carry the server's new version. If it does not,
 *     the save is treated as unconfirmed and the member keeps seeing "not
 *     saved", because claiming success without the server's word would be a lie.
 */

import type { AutosaveTarget } from "./targets";

/** Thrown when the server holds a newer accepted write than the one we started from. */
export class RevisionConflictError extends Error {
  readonly name = "RevisionConflictError";
  constructor(readonly serverVersion: string | null) {
    super("The server already holds a newer version.");
  }
}

/** Thrown for transport-level problems so the hook can retry with backoff. */
export class TransientSaveError extends Error {
  readonly name = "TransientSaveError";
  readonly code = "network";
}

/** Thrown when the response arrived but carried no version, so nothing is confirmed. */
export class UnconfirmedSaveError extends Error {
  readonly name = "UnconfirmedSaveError";
}

export interface DraftSaveResult {
  version: string | null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function pickVersion(body: unknown, path: string): string | null {
  const parts = path.split(".");
  let cursor: unknown = body;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
}

/**
 * Builds the `save()` the autosave hook expects for one target.
 *
 * `resolvePath` exists for routes that carry an id ([id] in the registry), so a
 * page supplies its own id rather than the registry guessing one.
 */
export function makeDraftSaver<T extends Record<string, unknown>>(
  target: AutosaveTarget,
  resolvePath: (payload: T) => string = () => target.route ?? "",
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): (payload: T, baseVersion: string | null) => Promise<DraftSaveResult> {
  if (!target.route || !target.method) {
    throw new Error(`Autosave target "${target.id}" has no write route.`);
  }

  return async (payload: T, baseVersion: string | null) => {
    const url = resolvePath(payload);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (baseVersion) headers["x-sophira-base-version"] = baseVersion;

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: target.method as string,
        headers,
        body: JSON.stringify(payload),
        cache: "no-store",
      });
    } catch {
      throw new TransientSaveError("Could not reach Sophira.");
    }

    if (res.status === 409) {
      let serverVersion: string | null = null;
      try {
        const body = (await res.json()) as { data?: { version?: string } };
        serverVersion = body?.data?.version ?? null;
      } catch {
        /* a conflict body we cannot read is still a conflict */
      }
      throw new RevisionConflictError(serverVersion);
    }

    if (res.status >= 500) throw new TransientSaveError("Sophira is busy.");
    if (!res.ok) {
      // 4xx other than 409 is a refusal (validation, permission). Retrying it
      // would only produce the same refusal, so it is reported as permanent.
      throw new UnconfirmedSaveError("Sophira did not accept that change.");
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      throw new UnconfirmedSaveError("The server's reply could not be read.");
    }

    const version = target.versionFrom ? pickVersion(body, target.versionFrom) : null;
    // No version on the wire means the write may have landed, but Sophira has
    // not confirmed it: the member must not be told it saved.
    if (target.versionFrom && !version) {
      throw new UnconfirmedSaveError("The server did not confirm the save.");
    }

    return { version };
  };
}
