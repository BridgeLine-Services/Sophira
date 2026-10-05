import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type MemoryEvidenceInput,
  type MemoryEvidenceRow,
  type StudentMemory,
  type MemoryStatus,
  clampConfidence,
  computeTrend,
  recomputeConfidence,
  statusAfterRecompute,
  studentTransition,
  INITIAL_AI_CONFIDENCE,
} from "./engine";

/**
 * Server-side memory store. ALL operations go through the caller's
 * RLS-scoped Supabase client and are additionally filtered by user_id —
 * a user can only ever touch their own memories (enforced twice: here
 * and by the database). No service-role client is EVER used for student
 * memory data — the owner has no code path to any student's memories.
 */

const RETRIEVAL_COLUMNS = "id, user_id, category, statement, details, subject, subject_tags, confidence, status, improvement_trend, origin, source, first_observed, last_observed, last_used_at, created_at, updated_at";

function tagsFor(subject: string | null | undefined, extra?: string[]): string[] {
  const s = (subject || "").trim().toLowerCase();
  const tags: string[] = [];
  const push = (t: string) => {
    const v = t.trim().toLowerCase();
    if (v && !tags.includes(v)) tags.push(v);
  };
  (extra || []).forEach(push);
  push(s);
  return tags;
}

/** Find a live (non-forgotten) memory that plausibly matches a statement. */
async function findMatchingMemory(
  supabase: SupabaseClient,
  userId: string,
  statement: string,
): Promise<StudentMemory | null> {
  const { data } = await supabase
    .from("student_memories")
    .select(RETRIEVAL_COLUMNS)
    .eq("user_id", userId)
    .neq("status", "forgotten")
    .ilike("statement", `%${statement.slice(0, 60)}%`);
  return (data?.[0] as StudentMemory) ?? null;
}

/**
 * Record one piece of evidence. Creates the memory (AI-inferred →
 * status 'monitoring', NEVER asserted as fact) when none matches, or
 * updates the existing memory's confidence/trend/status otherwise.
 * Returns the memory and whether it was created.
 */
export async function recordMemoryEvidence(
  supabase: SupabaseClient,
  userId: string,
  args: {
    category: StudentMemory["category"];
    statement: string;
    subject?: string | null;
    details?: string;
    evidence: MemoryEvidenceInput;
    source?: string;
  },
): Promise<{ memory: StudentMemory; created: boolean } | { error: string }> {
  const existing = await findMatchingMemory(supabase, userId, args.statement);
  const nowISO = new Date().toISOString();

  let memoryId: string;
  let created = false;
  let previousEvidenceCount = 0;

  if (existing) {
    memoryId = existing.id;
    const { count } = await supabase
      .from("student_memory_evidence")
      .select("id", { count: "exact", head: true })
      .eq("memory_id", memoryId);
    previousEvidenceCount = count ?? 0;
  } else {
    const { data: inserted, error } = await supabase
      .from("student_memories")
      .insert({
        user_id: userId,
        category: args.category,
        statement: args.statement,
        details: args.details ?? "",
        subject: args.subject ?? null,
        subject_tags: tagsFor(args.subject),
        confidence: INITIAL_AI_CONFIDENCE,
        status: "monitoring",
        origin: "ai_inferred",
        source: args.source ?? "",
      })
      .select("id")
      .single();
    if (error || !inserted) return { error: error?.message || "Could not create memory." };
    memoryId = inserted.id;
    created = true;
  }

  const { error: evErr } = await supabase.from("student_memory_evidence").insert({
    user_id: userId,
    memory_id: memoryId,
    evidence_type: args.evidence.evidence_type,
    polarity: args.evidence.polarity,
    summary: args.evidence.summary,
    evidence_ref: args.evidence.evidence_ref ?? {},
    observed_at: args.evidence.observed_at ?? nowISO,
  });
  if (evErr) return { error: evErr.message };

  // Recompute from the full weighted evidence history — recent evidence
  // dominates, so outdated behavior never permanently defines the student.
  const rows = await listEvidence(supabase, userId, memoryId);
  const existingBase = existing ?? {
    status: "monitoring" as MemoryStatus,
    origin: "ai_inferred" as const,
    category: args.category,
  };
  await refreshFromEvidence(supabase, userId, memoryId, rows, existingBase);

  const { data: memory } = await supabase
    .from("student_memories")
    .select(RETRIEVAL_COLUMNS)
    .eq("id", memoryId)
    .single();
  if (!memory) return { error: "Memory disappeared after update." };
  return { memory: memory as StudentMemory, created };
}

/** Apply evidence-weighted confidence/trend/status to one memory row. */
async function refreshFromEvidence(
  supabase: SupabaseClient,
  userId: string,
  memoryId: string,
  rows: MemoryEvidenceRow[],
  base: { status: MemoryStatus; origin: StudentMemory["origin"]; category: StudentMemory["category"] },
): Promise<StudentMemory | null> {
  const nowISO = new Date().toISOString();
  const confidence = rows.length ? recomputeConfidence(rows, nowISO) : clampConfidence(0.3);
  const trend = computeTrend({ category: base.category }, rows, nowISO);
  const nextStatus = statusAfterRecompute(
    { status: base.status, origin: base.origin, category: base.category },
    confidence,
    trend,
  );
  const lastObserved = rows.length
    ? rows.map((r) => r.observed_at).sort().at(-1)!
    : nowISO;
  await supabase
    .from("student_memories")
    .update({
      confidence,
      improvement_trend: trend,
      status: nextStatus,
      last_observed: lastObserved,
      updated_at: nowISO,
    })
    .eq("id", memoryId)
    .eq("user_id", userId);
  const { data } = await supabase
    .from("student_memories")
    .select(RETRIEVAL_COLUMNS)
    .eq("id", memoryId)
    .single();
  return (data as StudentMemory) ?? null;
}

export async function listEvidence(
  supabase: SupabaseClient,
  userId: string,
  memoryId: string,
): Promise<MemoryEvidenceRow[]> {
  const { data } = await supabase
    .from("student_memory_evidence")
    .select("id, memory_id, evidence_type, polarity, summary, evidence_ref, observed_at")
    .eq("user_id", userId)
    .eq("memory_id", memoryId)
    .order("observed_at", { ascending: true });
  return (data ?? []) as MemoryEvidenceRow[];
}

/** Student manual transition (disable/restore/archive/forget/...). */
export async function studentMemoryAction(
  supabase: SupabaseClient,
  userId: string,
  memoryId: string,
  action: "archive" | "disable" | "restore" | "enable" | "forget" | "mark_improving" | "mark_contradicted",
): Promise<{ ok: true } | { error: string }> {
  const { data: memory } = await supabase
    .from("student_memories")
    .select("id, status")
    .eq("id", memoryId)
    .eq("user_id", userId)
    .single();
  if (!memory) return { error: "Memory not found." };

  let to: MemoryStatus;
  switch (action) {
    case "archive": to = "archived"; break;
    case "disable": to = "disabled"; break;
    case "restore":
    case "enable": to = "active"; break;
    case "forget": to = "forgotten"; break;
    case "mark_improving": to = "improving"; break;
    case "mark_contradicted": to = "contradicted"; break;
  }
  const { allowed, reason } = studentTransition(memory.status as MemoryStatus, to);
  if (!allowed) {
    return { error: reason || `Cannot move a ${memory.status} memory to ${to}.` };
  }
  const { error } = await supabase
    .from("student_memories")
    .update({ status: to, updated_at: new Date().toISOString() })
    .eq("id", memoryId)
    .eq("user_id", userId);
  if (error) return { error: error.message };
  return { ok: true };
}

/** List memories for the student (search/filter applied server-side). */
export async function listMemories(
  supabase: SupabaseClient,
  userId: string,
  filters: { q?: string; category?: string; status?: string } = {},
): Promise<StudentMemory[]> {
  let query = supabase
    .from("student_memories")
    .select(RETRIEVAL_COLUMNS)
    .eq("user_id", userId)
    .neq("status", "forgotten");
  if (filters.q) query = query.or(`statement.ilike.%${filters.q}%,details.ilike.%${filters.q}%`);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.status) query = query.eq("status", filters.status);
  const { data } = await query.order("last_observed", { ascending: false });
  return (data ?? []) as StudentMemory[];
}
