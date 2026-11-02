import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { deleteConnection } from "@/lib/integrations/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/canvas/disconnect — deletes this student's Canvas
 * tokens immediately.
 *
 * Deliberately KEEPS already-discovered assignments and courses: they are the
 * student's own work, and silently deleting them when someone disconnects would
 * destroy data they never asked to lose. The response says exactly that.
 */
export async function POST() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  try {
    await deleteConnection(guard.data.user.id, "canvas");
  } catch {
    return NextResponse.json(
      { ok: false, error: "Sophira could not remove the Canvas connection just now. Please try again." },
      { status: 500 }
    );
  }

  await supabase.from("canvas_sync_events").insert({
    user_id: guard.data.user.id,
    kind: "disconnected",
    detail: { kept: "assignments and courses" },
  });

  return NextResponse.json({
    ok: true,
    message:
      "Canvas is disconnected. Sophira can no longer reach your Canvas account. Assignments already found are still in your workspace, and you can reconnect any time.",
  });
}
