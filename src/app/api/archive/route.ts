import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * WORKSPACE ARCHIVE LIFECYCLE (2026-10-13, migration 0037).
 *
 *   GET  /api/archive            — the authenticated user's archived records
 *   POST /api/archive            — { kind, id, action: "archive" | "restore" }
 *
 * Every mutation is owner-scoped server-side: the user comes from the
 * session, never from the request body, and the update targets
 * user_id = session user AND id = record id. Nothing cascades: archiving a
 * notebook touches ONLY the notebook row — its sources, notes, questions,
 * evidence, and artifacts keep their own lifecycle (restore rules below).
 *
 * Parent policy (documented + test-pinned): a child record whose parent
 * notebook is archived is NOT re-parented or duplicated on restore — it
 * keeps its original notebook_id and original identity; it simply remains
 * inside the archived notebook until that notebook is restored. Restoring
 * a child whose parent is still archived succeeds and is reported with an
 * honest note so the user can restore the parent deliberately.
 */

const KINDS = {
  notebook: { table: "notebooks", label: "Notebook" },
  source: { table: "notebook_sources", label: "Source" },
  note: { table: "notebook_notes", label: "Note" },
  question: { table: "notebook_questions", label: "Question" },
  evidence: { table: "notebook_evidence", label: "Evidence" },
  artifact: { table: "notebook_artifacts", label: "Artifact" },
  teacher: { table: "teachers", label: "Teacher" },
  material: { table: "study_materials", label: "Library item" },
} as const;
type Kind = keyof typeof KINDS;

function snippet(row: Record<string, unknown>): string {
  return String(row.title ?? row.name ?? row.question ?? row.content ?? row.source_id ?? row.id ?? "record");
}

export async function GET() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  const items: Array<Record<string, unknown>> = [];
  for (const kind of Object.keys(KINDS) as Kind[]) {
    const { table, label } = KINDS[kind];
    const { data } = await supabase
      .from(table)
      .select("*")
      .eq("user_id", user.id)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(200);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      items.push({
        kind, kind_label: label, id: row.id,
        notebook_id: row.notebook_id ?? null,
        title: snippet(row), archived_at: row.archived_at,
      });
    }
  }
  items.sort((a, b) => String(b.archived_at).localeCompare(String(a.archived_at)));
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  let body: { kind?: string; id?: string; action?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const kind = body.kind as Kind;
  const spec = KINDS[kind];
  const id = (body.id || "").trim();
  const action = body.action;
  if (!spec || !id || (action !== "archive" && action !== "restore")) {
    return NextResponse.json({ error: "Invalid archive request." }, { status: 400 });
  }

  // Owner-scoped transition. Repeated archive is idempotent (archived_at
  // already set -> still one row); repeated restore sets NULL again.
  const { data: row, error } = await supabase
    .from(spec.table)
    .update({ archived_at: action === "archive" ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, notebook_id, archived_at")
    .maybeSingle();
  if (error || !row) {
    return NextResponse.json({ error: "That record could not be updated. It may not exist or you may not have access." }, { status: 404 });
  }

  // Parent policy: report an archived parent honestly instead of
  // silently re-parenting or duplicating the child.
  let note: string | null = null;
  if (action === "restore" && row.notebook_id) {
    const { data: parent } = await supabase
      .from("notebooks")
      .select("id, archived_at")
      .eq("id", row.notebook_id as string)
      .eq("user_id", user.id)
      .maybeSingle();
    if (parent?.archived_at) {
      note = "Restored into its notebook, but that notebook is still archived — restore the notebook from the Archive to see it in your workspace.";
    }
  }
  return NextResponse.json({ ok: true, kind, id: row.id, archived_at: row.archived_at, note });
}
