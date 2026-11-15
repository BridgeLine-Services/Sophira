import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { loadRun } from "@/lib/essay/run-store";
import { isExportFormat, renderExport } from "@/lib/essay/export";

export const runtime = "nodejs";

/**
 * GET /api/essay/autonomous/[id]/export?format=md|txt
 *
 * Delivers the finished document to the student who owns it. Two refusals are deliberate:
 *  - a run that is not complete returns 409 with the state machine's own reason (a half
 *    document must not arrive named like a finished one),
 *  - a run that is not this student's returns 404, because the read is filtered by user_id.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const format = request.nextUrl.searchParams.get("format") ?? "md";
  if (!isExportFormat(format)) {
    return NextResponse.json({ error: "Choose either markdown or plain text." }, { status: 400 });
  }

  const run = await loadRun(supabase, guard.data.user.id, id);
  if (!run) return NextResponse.json({ error: "That assignment run is not in your list." }, { status: 404 });

  const rendered = renderExport(run, format);
  if (!rendered.ok || !rendered.body || !rendered.filename) {
    return NextResponse.json({ error: rendered.reason ?? "This run is not finished yet." }, { status: 409 });
  }

  return new NextResponse(rendered.body, {
    status: 200,
    headers: {
      "content-type": rendered.contentType ?? "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${rendered.filename}"`,
      "cache-control": "no-store",
    },
  });
}
