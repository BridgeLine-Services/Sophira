import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { MEMORY_CATEGORIES } from "@/lib/memory/engine";
import { listMemories, listEvidence } from "@/lib/memory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Long-term student memory API (workflow §28).
 *
 * GET  /api/memory — the signed-in student's memories, with server-side
 *                    search/filter. Every row is additionally scoped by
 *                    user_id AND RLS: no user can ever list another's.
 * POST /api/memory — the student manually adds a memory (origin
 *                    'student_supplied' — clearly distinct from
 *                    AI-inferred observations, which are created by
 *                    the learning system with evidence rows).
 */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const params = request.nextUrl.searchParams;
  const memories = await listMemories(supabase, guard.data.user.id, {
    q: params.get("q")?.slice(0, 120) || undefined,
    category: params.get("category") || undefined,
    status: params.get("status") || undefined,
  });

  // Evidence counts (the inspector loads full rows via /api/memory/[id]).
  const withCounts = await Promise.all(
    memories.map(async (m) => {
      const evidence = await listEvidence(supabase, guard.data.user.id, m.id);
      return { ...m, evidence_count: evidence.length };
    }),
  );
  return NextResponse.json({ data: withCounts });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const category = String(body.category || "");
  const statement = String(body.statement || "").trim();
  const details = String(body.details || "").trim();
  const subject = body.subject ? String(body.subject).trim() : null;
  if (!MEMORY_CATEGORIES.includes(category as never)) {
    return NextResponse.json({ error: "Unknown memory category." }, { status: 400 });
  }
  if (statement.length < 3 || statement.length > 200) {
    return NextResponse.json({ error: "Statement must be 3-200 characters." }, { status: 400 });
  }

  const { data: memory, error } = await supabase
    .from("student_memories")
    .insert({
      user_id: guard.data.user.id,
      category,
      statement,
      details,
      subject,
      subject_tags: subject ? [subject.toLowerCase()] : [],
      confidence: 1, // student-stated facts are trusted at creation
      status: "active",
      origin: "student_supplied",
      source: "manual",
    })
    .select()
    .single();
  if (error || !memory) {
    return NextResponse.json({ error: error?.message || "Could not save the memory." }, { status: 500 });
  }
  return NextResponse.json({ data: memory });
}
