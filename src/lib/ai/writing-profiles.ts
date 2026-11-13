/**
 * ONE PLACE THAT READS AND WRITES WRITING PROFILES (2026-11-13, directive Part 5).
 *
 * Before this, six call sites each did their own
 * `.from("writing_profiles").order("created_at").limit(1)` and took whatever row was
 * newest, regardless of which kind of writing it described. With three contexts that
 * would hand an academic essay the casual profile, so every read now goes through here
 * and names the context it wants.
 *
 * BACKWARD COMPATIBLE BY CONSTRUCTION: if the context column is missing (an older
 * database, or a self-hosted copy that has not run migration 0058), the read falls back
 * to the pre-0058 query and reports the context as academic. Nothing 500s.
 *
 * What this module deliberately does NOT do: apply anything. It reads profiles and
 * creates a DRAFT row so a preference has somewhere to live. Guidance only reaches an AI
 * prompt when a student has approved it, which is unchanged from before.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  closenessDirective,
  DEFAULT_CLOSENESS,
  DEFAULT_WRITING_CONTEXT,
  normalizeCloseness,
  parseWritingContext,
  WRITING_CONTEXTS,
  type ClosenessDecision,
  type WritingContext,
} from "./writing-contexts";

export interface WritingProfileRow {
  id: string;
  profile_context: WritingContext;
  style_closeness: number;
  guidance: string;
  status: string;
  version: number;
  updated_at: string | null;
  created_at: string | null;
}

export interface ContextProfile {
  context: WritingContext;
  /** Newest profile row for this context, whatever its status, or null. */
  profile: WritingProfileRow | null;
  /** Newest APPROVED row for this context, or null. Only this one reaches a prompt. */
  approved: WritingProfileRow | null;
  /** The student's closeness setting for this context (default 70 when no row). */
  closeness: number;
}

const BASE_COLUMNS = "id, guidance, status, version, updated_at, created_at";

function toRow(raw: Record<string, unknown>, fallbackContext: WritingContext): WritingProfileRow {
  return {
    id: String(raw.id ?? ""),
    profile_context: parseWritingContext(raw.profile_context, fallbackContext),
    style_closeness: normalizeCloseness(raw.style_closeness),
    guidance: typeof raw.guidance === "string" ? raw.guidance : "",
    status: typeof raw.status === "string" ? raw.status : "draft",
    version: typeof raw.version === "number" ? raw.version : 1,
    updated_at: (raw.updated_at as string | null) ?? null,
    created_at: (raw.created_at as string | null) ?? null,
  };
}

/**
 * Is the context column available in this database?
 * Asked once per read attempt via a tiny probe, so the fallback costs one cheap query
 * on a legacy database and nothing on a current one.
 */
async function contextColumnAvailable(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const probe = await supabase
    .from("writing_profiles")
    .select("profile_context")
    .eq("user_id", userId)
    .limit(1);
  return !probe.error;
}

/**
 * Every context, its newest profile, and the closeness setting - one read, used by the
 * writing screen and by GET /api/writing/profile so the screen and the AI can never
 * disagree about what the student chose.
 */
export async function loadContextProfiles(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ contexts: ContextProfile[]; degraded: string[] }> {
  const degraded: string[] = [];
  const hasContext = await contextColumnAvailable(supabase, userId);

  const columns = hasContext ? `${BASE_COLUMNS}, profile_context, style_closeness` : BASE_COLUMNS;
  const { data, error } = await supabase
    .from("writing_profiles")
    .select(columns)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) {
    degraded.push("your writing profiles could not be read just now");
    return {
      contexts: WRITING_CONTEXTS.map((context) => ({ context, profile: null, approved: null, closeness: DEFAULT_CLOSENESS })),
      degraded,
    };
  }

  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => toRow(r, DEFAULT_WRITING_CONTEXT));
  // A legacy database has one undifferentiated profile; it is the academic one, exactly
  // as migration 0058 backfilled it.
  if (!hasContext) degraded.push("this database predates separate writing contexts, so every profile is academic");

  const contexts: ContextProfile[] = WRITING_CONTEXTS.map((context) => {
    const forContext = rows.filter((r) => (hasContext ? r.profile_context === context : context === DEFAULT_WRITING_CONTEXT));
    const profile = forContext[0] ?? null;
    const approved = forContext.find((r) => r.status === "approved") ?? null;
    return {
      context,
      profile,
      approved,
      // The dial belongs to the newest row for the context, so what the student last set
      // is what applies - approved or not.
      closeness: profile ? profile.style_closeness : DEFAULT_CLOSENESS,
    };
  });

  return { contexts, degraded };
}

/** The profile that may reach a prompt for this context: newest APPROVED, else null. */
export async function loadApprovedProfile(
  supabase: SupabaseClient,
  userId: string,
  contextInput: unknown,
): Promise<{ context: WritingContext; profile: WritingProfileRow | null; decision: ClosenessDecision; degraded: string[] }> {
  const context = parseWritingContext(contextInput);
  const degraded: string[] = [];
  const hasContext = await contextColumnAvailable(supabase, userId);

  // The context is filtered HERE rather than only in the query, so a row that predates the
  // column is still recognised as academic instead of silently disappearing from the read.
  const { data, error } = await supabase
    .from("writing_profiles")
    .select(hasContext ? `${BASE_COLUMNS}, profile_context, style_closeness` : BASE_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    degraded.push("the approved writing profile was unavailable");
    return { context, profile: null, decision: closenessDirective(DEFAULT_CLOSENESS), degraded };
  }
  const candidates = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => toRow(r, context));
  // On a database without the column there is exactly one undifferentiated profile, and it is
  // the academic one (what 0058 backfilled). A casual or professional task must NOT borrow it.
  const profile = candidates.find((r) => (hasContext ? r.profile_context === context : context === DEFAULT_WRITING_CONTEXT)) ?? null;
  return {
    context,
    profile,
    decision: closenessDirective(profile ? profile.style_closeness : DEFAULT_CLOSENESS),
    degraded,
  };
}

/**
 * The profile row a new proposal should attach to: the newest row for this context, or a
 * new DRAFT row for it. A draft is not applied to anything - it is where a student's
 * pending suggestions are collected, which is exactly how the pre-0058 code behaved.
 */
export async function ensureProfileForContext(
  supabase: SupabaseClient,
  userId: string,
  contextInput: unknown,
): Promise<{ profileId: string | null; context: WritingContext; created: boolean; error?: string }> {
  const context = parseWritingContext(contextInput);
  const hasContext = await contextColumnAvailable(supabase, userId);

  let query = supabase.from("writing_profiles").select("id").eq("user_id", userId);
  if (hasContext) query = query.eq("profile_context", context);
  const { data: existing } = await query.order("created_at", { ascending: false }).limit(1);
  const existingId = (existing?.[0] as { id?: string } | undefined)?.id;
  if (existingId) return { profileId: existingId, context, created: false };

  const insert: Record<string, unknown> = { user_id: userId, summary: {}, guidance: "", status: "draft", version: 1 };
  if (hasContext) {
    insert.profile_context = context;
    insert.style_closeness = DEFAULT_CLOSENESS;
  }
  const { data: created, error } = await supabase.from("writing_profiles").insert(insert).select("id").single();
  if (error || !created) return { profileId: null, context, created: false, error: "could not prepare the writing profile" };
  return { profileId: String((created as { id: string }).id), context, created: true };
}

/**
 * Set the student's closeness dial for one context. This is a PREFERENCE, so it is
 * written directly by the student (never proposed by the AI and never requiring
 * approval). If no row exists for the context, a draft row is created to hold it.
 *
 * Returns the value actually stored, so a screen never has to assume the write landed.
 */
export async function setCloseness(
  supabase: SupabaseClient,
  userId: string,
  contextInput: unknown,
  closenessInput: unknown,
): Promise<{ ok: boolean; context: WritingContext; closeness: number; created: boolean; error?: string }> {
  const context = parseWritingContext(contextInput);
  const closeness = normalizeCloseness(closenessInput);
  const ensured = await ensureProfileForContext(supabase, userId, context);
  if (!ensured.profileId) return { ok: false, context, closeness, created: false, error: ensured.error };

  const { data, error } = await supabase
    .from("writing_profiles")
    .update({ style_closeness: closeness, updated_at: new Date().toISOString() })
    .eq("id", ensured.profileId)
    .eq("user_id", userId)
    .select("style_closeness")
    .single();

  if (error) {
    // A legacy database has no column to store this in. Say so instead of pretending.
    return { ok: false, context, closeness, created: ensured.created, error: "this database cannot store a closeness setting yet" };
  }
  return {
    ok: true,
    context,
    closeness: normalizeCloseness((data as { style_closeness?: unknown } | null)?.style_closeness ?? closeness),
    created: ensured.created,
  };
}

/**
 * What a prompt gets for one writing task: the approved guidance (only when the dial
 * allows it) plus the register rules for the context. Never a raw dump of the profile.
 */
export async function writingPromptFor(
  supabase: SupabaseClient,
  userId: string,
  contextInput: unknown,
  maxChars = 600,
): Promise<{ section: string | null; context: WritingContext; closeness: number; degraded: string[] }> {
  const { context, profile, decision, degraded } = await loadApprovedProfile(supabase, userId, contextInput);
  if (!profile || !decision.applyGuidance) {
    return { section: null, context, closeness: decision.closeness, degraded };
  }
  const guidance = profile.guidance.trim();
  if (!guidance) return { section: null, context, closeness: decision.closeness, degraded };
  const clipped = guidance.length > maxChars ? `${guidance.slice(0, maxChars - 1).trimEnd()}…` : guidance;
  return {
    section: `Approved ${context} writing preferences: ${clipped}`,
    context,
    closeness: decision.closeness,
    degraded,
  };
}
