import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/integrations/selections/[id] — revise the scope of one of the
 * SIGNED-IN user's own selections (the user can always narrow or restate
 * their workload before processing). DELETE — remove it. Ownership is
 * enforced by the user id from the session AND row-level security; another
 * user's id can never be touched no matter what id is supplied.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  let body: { scope_description?: unknown; status?: unknown } = {};
  try { body = (await request.json()) as typeof body; } catch { /* empty body -> no-op update */ }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.scope_description === "string") patch.scope_description = body.scope_description.trim().slice(0, 2000) || null;
  if (body.status === "active" || body.status === "archived") patch.status = body.status;
  const { data, error } = await supabase
    .from("workload_selections")
    .update(patch)
    .eq("id", id)
    .eq("user_id", guard.data.user.id)
    .select("id, scope_description, status, updated_at")
    .single();
  if (error) return NextResponse.json({ ok: false, error: "That selection was not found for your user." }, { status: 404 });
  return NextResponse.json({ ok: true, selection: data });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const { error } = await supabase
    .from("workload_selections")
    .delete()
    .eq("id", id)
    .eq("user_id", guard.data.user.id);
  if (error) return NextResponse.json({ ok: false, error: "That selection was not found for your user." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
