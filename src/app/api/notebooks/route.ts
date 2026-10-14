import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";

/**
 * Notebook workspace (2026-10-06):
 *   GET  /api/notebooks        — list the user's notebooks
 *   POST /api/notebooks        — create a notebook
 */

export async function GET() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  // TRANSITION-SAFE LIST (2026-10-14): the archived_at filter comes from
  // migration 0037. If the live schema has not received 0037 yet, the
  // filtered query fails on the missing column and the whole list breaks
  // (the reported "notebooks could not be loaded" + apparent vanishings).
  // Safe fallback: while archived_at does not exist, NO notebook can be
  // archived (the column is how archiving works), so an unfiltered retry is
  // exactly equivalent — still owner-scoped by user_id + RLS. Once 0037
  // applies, the filtered path is used and archive hiding activates.
  const query = supabase
    .from("notebooks")
    .select("id,title,description,created_at,updated_at")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });
  const { data, error } = await query;
  if (error) {
    const legacy = await supabase
      .from("notebooks")
      .select("id,title,description,created_at,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (legacy.error) return NextResponse.json({ error: "Could not load notebooks." }, { status: 500 });
    return NextResponse.json({ notebooks: legacy.data ?? [] });
  }
  return NextResponse.json({ notebooks: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  let body: { title?: string; description?: string; assignment_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const title = (body.title || "").trim();
  if (title.length < 2) return NextResponse.json({ error: "Give the notebook a title." }, { status: 400 });
  const { data, error } = await supabase
    .from("notebooks")
    .insert({ user_id: user.id, title, description: (body.description || "").trim(), assignment_id: body.assignment_id ?? null })
    .select("id,title,description,created_at,updated_at")
    .single();
  if (error) return NextResponse.json({ error: "Could not create the notebook." }, { status: 500 });
  return NextResponse.json({ notebook: data });
}
