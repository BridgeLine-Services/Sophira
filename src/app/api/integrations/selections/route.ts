import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { validateSelectionInput } from "@/lib/integrations/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * WORKLOAD SELECTIONS (2026-10-12) — the personal-AI-workload boundary.
 * A selection records which provider document the SIGNED-IN user chose and
 * their EXPLICIT scope (section / questions / deliverables). The user_id is
 * ALWAYS taken from the authenticated session, never from the request body;
 * RLS enforces owner-only access as defense in depth.
 */
export async function GET() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { data, error } = await supabase
    .from("workload_selections")
    .select("id, provider, provider_document_id, document_title, document_url, access_state, scope_description, status, created_at, updated_at")
    .eq("user_id", guard.data.user.id)
    .eq("status", "active")
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: "Your selections could not be loaded." }, { status: 500 });
  return NextResponse.json({ ok: true, selections: data });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 }); }
  const checked = validateSelectionInput((body ?? {}) as Record<string, unknown>);
  if (!checked.ok) return NextResponse.json({ ok: false, error: checked.error }, { status: 400 });
  const { data, error } = await supabase
    .from("workload_selections")
    .upsert(
      { user_id: guard.data.user.id, ...checked.value, status: "active" },
      { onConflict: "user_id,provider,provider_document_id" },
    )
    .select("id, provider, provider_document_id, document_title, document_url, access_state, scope_description, status, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ ok: false, error: "The selection could not be saved." }, { status: 500 });
  return NextResponse.json({ ok: true, selection: data });
}
