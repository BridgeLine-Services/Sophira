// Canvas LMS client + pure synchronization helpers (2026-11-02).
//
// Security notes that must not be relaxed:
//  * Access tokens are only ever used server-side. Nothing here is imported by a
//    client component; the status route exposes booleans and labels only.
//  * Canvas content (descriptions, rubrics, attachment names) is UNTRUSTED. It is
//    stored as data and never interpreted as instructions. See
//    docs/CANVAS_INTEGRATION.md for the boundary rules.
//  * Every request is scoped to the signed-in student's own token. A course id
//    supplied by the client is never treated as proof of access: the campus-side
//    list is fetched from Canvas with that student's token.

import { createHash } from "crypto";

export const CANVAS_MAX_PAGES = 10;
export const CANVAS_PAGE_SIZE = 100;
export const CANVAS_MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const CANVAS_MAX_DESCRIPTION_CHARS = 200_000;

/** Least-privilege delegated scopes: read the student's own courses + assignments. */
export const CANVAS_SCOPES = [
  "url:GET|/api/v1/courses",
  "url:GET|/api/v1/courses/:course_id/assignments",
  "url:GET|/api/v1/courses/:course_id/assignments/:id",
  "url:GET|/api/v1/users/:user_id/profile",
];

export const CANVAS_AUTHORIZE_PATH = "/login/oauth2/auth";
export const CANVAS_TOKEN_PATH = "/login/oauth2/token";

export function canvasConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const id = env.CANVAS_CLIENT_ID?.trim();
  const secret = env.CANVAS_CLIENT_SECRET?.trim();
  const base = env.CANVAS_BASE_URL?.trim();
  return Boolean(id && secret && base);
}

/** Normalizes an instance origin; returns null for anything that isn't https. */
export function normalizeInstanceUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:") return null;
    if (/^(localhost|127\.|0\.0\.0\.0)/i.test(u.hostname)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function canvasAuthorizeUrl(
  baseUrl: string,
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const origin = normalizeInstanceUrl(baseUrl);
  if (!origin) throw new Error("Canvas instance URL must be a valid https origin");
  const u = new URL(CANVAS_AUTHORIZE_PATH, origin);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  // Canvas requires the scope list space-separated, unlike Google's style.
  u.searchParams.set("scope", CANVAS_SCOPES.join(" "));
  return u.toString();
}

export interface CanvasTokens {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

/** Canvas tokens: exchanged with form-encoded POST, refreshed the same way. */
export async function exchangeCode(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<CanvasTokens> {
  const origin = normalizeInstanceUrl(baseUrl);
  if (!origin) throw new Error("Canvas instance URL must be a valid https origin");
  const res = await fetch(`${origin}${CANVAS_TOKEN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // Deliberately coarse: never echo provider bodies to the client.
    throw new Error(`Canvas rejected the authorization code (${res.status})`);
  }
  const j = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!j.access_token) throw new Error("Canvas returned no access token");
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? null,
    expires_at:
      typeof j.expires_in === "number"
        ? new Date(Date.now() + j.expires_in * 1000).toISOString()
        : null,
  };
}

export async function refreshAccessToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<CanvasTokens> {
  const origin = normalizeInstanceUrl(baseUrl);
  if (!origin) throw new Error("Canvas instance URL must be a valid https origin");
  const res = await fetch(`${origin}${CANVAS_TOKEN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Canvas refused the refresh (${res.status})`);
  const j = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!j.access_token) throw new Error("Canvas returned no access token");
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? refreshToken,
    expires_at:
      typeof j.expires_in === "number"
        ? new Date(Date.now() + j.expires_in * 1000).toISOString()
        : null,
  };
}

export interface CanvasProfile {
  ok: boolean;
  label: string | null;
  userId: string | null;
}

/** Real provider call: proves the token works AND which account it belongs to. */
export async function verifyProfile(baseUrl: string, accessToken: string): Promise<CanvasProfile> {
  const origin = normalizeInstanceUrl(baseUrl);
  if (!origin) return { ok: false, label: null, userId: null };
  try {
    const res = await fetch(`${origin}/api/v1/users/self/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { ok: false, label: null, userId: null };
    const j = (await res.json()) as { id?: number | string; name?: string; short_name?: string };
    return {
      ok: true,
      label: j.name ?? j.short_name ?? null,
      userId: j.id !== undefined ? String(j.id) : null,
    };
  } catch {
    return { ok: false, label: null, userId: null };
  }
}

async function canvasGet<T>(url: string, accessToken: string): Promise<{ ok: boolean; data: T[]; error: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, data: [], error: `Canvas returned ${res.status}` };
    const j = (await res.json()) as T[] | { courses?: T[] } | unknown;
    const data = Array.isArray(j) ? j : [];
    return { ok: true, data, error: null };
  } catch {
    return { ok: false, data: [], error: "Canvas could not be reached" };
  }
}

export interface CanvasCourse {
  /** Canvas returns numeric ids; both forms are accepted and normalized on use. */
  id: string | number;
  name: string;
  course_code?: string;
  workflow_state?: string;
  term?: { name?: string };
  teachers?: { display_name?: string }[];
}

/** Courses the student may access, per Canvas's own authorization. */
export async function listCourses(
  baseUrl: string,
  accessToken: string
): Promise<{ ok: boolean; courses: CanvasCourse[]; error: string | null }> {
  const origin = normalizeInstanceUrl(baseUrl);
  if (!origin) return { ok: false, courses: [], error: "Canvas instance is not configured" };
  const all: CanvasCourse[] = [];
  for (let page = 1; page <= CANVAS_MAX_PAGES; page++) {
    const u = new URL("/api/v1/courses", origin);
    u.searchParams.set("per_page", String(CANVAS_PAGE_SIZE));
    u.searchParams.set("page", String(page));
    u.searchParams.set("enrollment_type", "student");
    u.searchParams.set("include[]", "teachers");
    u.searchParams.set("include[]", "term");
    const r = await canvasGet<CanvasCourse>(u.toString(), accessToken);
    if (!r.ok) return { ok: false, courses: all, error: r.error };
    all.push(...r.data.filter((c) => c && c.id !== undefined));
    if (r.data.length < CANVAS_PAGE_SIZE) break;
  }
  return { ok: true, courses: all, error: null };
}

export interface CanvasAssignment {
  /** Canvas returns numeric ids; both forms are accepted and normalized on use. */
  id: string | number;
  course_id?: string | number;
  name?: string;
  description?: string | null;
  due_at?: string | null;
  points_possible?: number | null;
  submission_types?: string[];
  html_url?: string;
  published?: boolean;
  updated_at?: string | null;
  rubric?: unknown;
  rubric_settings?: unknown;
  attachments?: { id?: number; display_name?: string; url?: string; size?: number; content_type?: string }[];
}

export async function listCourseAssignments(
  baseUrl: string,
  accessToken: string,
  courseId: string
): Promise<{ ok: boolean; assignments: CanvasAssignment[]; error: string | null }> {
  const origin = normalizeInstanceUrl(baseUrl);
  if (!origin) return { ok: false, assignments: [], error: "Canvas instance is not configured" };
  if (!/^\d{1,20}$/.test(String(courseId))) {
    return { ok: false, assignments: [], error: "That course id does not look valid" };
  }
  const all: CanvasAssignment[] = [];
  for (let page = 1; page <= CANVAS_MAX_PAGES; page++) {
    const u = new URL(`/api/v1/courses/${courseId}/assignments`, origin);
    u.searchParams.set("per_page", String(CANVAS_PAGE_SIZE));
    u.searchParams.set("page", String(page));
    u.searchParams.set("include[]", "submission");
    const r = await canvasGet<CanvasAssignment>(u.toString(), accessToken);
    if (!r.ok) return { ok: false, assignments: all, error: r.error };
    all.push(...r.data.filter((a) => a && a.id !== undefined));
    if (r.data.length < CANVAS_PAGE_SIZE) break;
  }
  return { ok: true, assignments: all, error: null };
}

/* ---------------------------------- pure ---------------------------------- */

export interface NormalizedAssignment {
  canvasId: string;
  courseId: string;
  title: string;
  description: string;
  dueAt: string | null;
  pointsPossible: number | null;
  submissionTypes: string[];
  htmlUrl: string | null;
  published: boolean;
  rubric: unknown;
  attachments: { name: string; url: string | null; size: number | null }[];
  fingerprint: string;
}

/** Truncates untrusted Canvas text so one huge description can't bloat a row. */
export function clampText(text: string | null | undefined, max = CANVAS_MAX_DESCRIPTION_CHARS): string {
  const s = (text ?? "").replace(/\r\n/g, "\n");
  return s.length > max ? `${s.slice(0, max)}\n[truncated]` : s;
}

/** Canvas sends ISO timestamps or null; anything unparseable becomes null (honest). */
export function normalizeDueAt(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Canonical fingerprint of everything that, if changed, means the student's
 * workspace may need updating. Key-sorted so the same content always hashes the
 * same, and no timestamps of our own are mixed in.
 */
export function assignmentFingerprint(a: Omit<NormalizedAssignment, "fingerprint">): string {
  const canonical = {
    title: a.title,
    description: a.description,
    dueAt: a.dueAt,
    points: a.pointsPossible,
    submissionTypes: [...a.submissionTypes].sort(),
    published: a.published,
    rubric: a.rubric ?? null,
    attachments: a.attachments.map((x) => x.name).sort(),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
}

export function normalizeAssignment(raw: CanvasAssignment): NormalizedAssignment | null {
  if (raw?.id === undefined || raw?.id === null) return null;
  const canvasId = String(raw.id);
  if (!/^\d{1,20}$/.test(canvasId)) return null;
  const attachments = (raw.attachments ?? [])
    .filter((x) => x && typeof x.display_name === "string")
    .map((x) => ({
      name: clampText(x.display_name, 200),
      url: typeof x.url === "string" ? x.url : null,
      size: typeof x.size === "number" ? x.size : null,
    }));
  const base: Omit<NormalizedAssignment, "fingerprint"> = {
    canvasId,
    courseId: raw.course_id !== undefined ? String(raw.course_id) : "",
    title: clampText(raw.name, 400) || "Untitled assignment",
    description: clampText(raw.description),
    dueAt: normalizeDueAt(raw.due_at),
    pointsPossible: typeof raw.points_possible === "number" ? raw.points_possible : null,
    submissionTypes: Array.isArray(raw.submission_types) ? raw.submission_types.map(String) : [],
    htmlUrl: typeof raw.html_url === "string" ? raw.html_url : null,
    published: raw.published !== false,
    rubric: raw.rubric ?? raw.rubric_settings ?? null,
    attachments,
  };
  return { ...base, fingerprint: assignmentFingerprint(base) };
}

export interface PreviousAssignmentState {
  canvasId: string;
  fingerprint: string | null;
  syncState: "active" | "missing";
}

export interface SyncPlan {
  toCreate: NormalizedAssignment[];
  toUpdate: NormalizedAssignment[];
  toMarkMissing: string[];
  /** Assignments Canvas reports again after being missing: full payloads, so a
   *  restore also refreshes content rather than assuming it is unchanged. */
  toRestore: NormalizedAssignment[];
  unchanged: number;
}

/**
 * Idempotent reconciliation between what Canvas reports now and what Sophira
 * stored last time. Pure, so duplicate-prevention and change detection are
 * tested rather than hoped for. Ordering is stable for repeatable output.
 */
export function planAssignmentSync(
  previous: PreviousAssignmentState[],
  incoming: NormalizedAssignment[]
): SyncPlan {
  const byId = new Map<string, PreviousAssignmentState>(
    previous.map((p) => [p.canvasId, p] as [string, PreviousAssignmentState])
  );
  const seen = new Set<string>();
  const plan: SyncPlan = { toCreate: [], toUpdate: [], toMarkMissing: [], toRestore: [], unchanged: 0 };
  for (const a of [...incoming].sort((x, y) => x.canvasId.localeCompare(y.canvasId))) {
    if (seen.has(a.canvasId)) continue; // Canvas paging can repeat a row
    seen.add(a.canvasId);
    const prev = byId.get(a.canvasId);
    if (!prev) plan.toCreate.push(a);
    else if (prev.syncState === "missing") plan.toRestore.push(a);
    else if (prev.fingerprint !== a.fingerprint) plan.toUpdate.push(a);
    else plan.unchanged++;
  }
  for (const p of [...previous].sort((x, y) => x.canvasId.localeCompare(y.canvasId))) {
    if (p.syncState === "active" && !seen.has(p.canvasId)) plan.toMarkMissing.push(p.canvasId);
  }
  return plan;
}

/** Attachments are untrusted links; only https, only reasonable size. */
export function attachmentAllowed(
  url: string | null,
  size: number | null
): { ok: boolean; reason: string | null } {
  if (!url) return { ok: false, reason: "No download link was provided" };
  if (!/^https:\/\//i.test(url)) return { ok: false, reason: "Only secure links are downloaded" };
  if (size !== null && size > CANVAS_MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: "That file is too large to copy into Sophira" };
  }
  return { ok: true, reason: null };
}

export interface SyncCounts {
  created: number;
  updated: number;
  missing: number;
  restored: number;
}

/** Plain-language summary built from applied counts (post-write truth). */
export function describeSyncCounts(c: SyncCounts): string {
  const parts: string[] = [];
  if (c.created) parts.push(`${c.created} new assignment${c.created === 1 ? "" : "s"} found`);
  if (c.updated) parts.push(`${c.updated} updated`);
  if (c.missing) parts.push(`${c.missing} no longer on Canvas`);
  if (c.restored) parts.push(`${c.restored} available again`);
  return parts.length ? `${parts.join(", ")}.` : "Everything is up to date.";
}

/** Plain-language summary for the student; never a raw API error. */
export function describePlan(plan: SyncPlan): string {
  const parts: string[] = [];
  if (plan.toCreate.length) parts.push(`${plan.toCreate.length} new assignment${plan.toCreate.length === 1 ? "" : "s"} found`);
  if (plan.toUpdate.length) parts.push(`${plan.toUpdate.length} updated`);
  if (plan.toMarkMissing.length) parts.push(`${plan.toMarkMissing.length} no longer on Canvas`);
  if (plan.toRestore.length) parts.push(`${plan.toRestore.length} available again`);
  if (!parts.length) return "Everything is up to date.";
  return `${parts.join(", ")}.`;
}
