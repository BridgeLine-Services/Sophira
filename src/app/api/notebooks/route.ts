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
  const { data, error } = await supabase
    .from("notebooks")
    .select("id,title,description,created_at,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load notebooks." }, { status: 500 });
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
