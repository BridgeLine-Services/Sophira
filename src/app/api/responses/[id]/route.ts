import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One draft answer the member is making their own.
 *
 * PATCH /api/responses/[id] — save edited text over an existing answer.
 *
 * Why a member edit is not a silent rewrite: an answer carries a verification
 * record ("verified", the checks that ran, the method used). Once the member
 * changes the words, that record no longer describes what is on the page. So the
 * original verdict is preserved verbatim under `verification.member_edited` and
 * the live status becomes `unverified`, which is the honest reading of text a
 * person has since typed. Nothing is deleted, and nothing claims a check ran on
 * words it never saw.
 *
 * Scoped to the signed-in member three ways: auth guard, explicit
 * `.eq("user_id", ...)`, and RLS. Revision-aware via `x-sophira-base-version`
 * (responses.updated_at, added in migration 0045): a stale editor is refused
 * with 409 instead of overwriting newer text from another device.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  const { id } = await params;

  let body: { content?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }
  const content = body.content.replace(/\r\n/g, "\n");
  if (!content.trim()) {
    return NextResponse.json({ error: "An answer cannot be empty." }, { status: 400 });
  }
  if (content.length > 200000) {
    return NextResponse.json({ error: "That answer is too long to save." }, { status: 413 });
  }

  const { data: existing, error: readError } = await supabase
    .from("responses")
    .select("id, content, verification, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) {
    return NextResponse.json({ error: "Could not open that answer." }, { status: 500 });
  }
  if (!existing) return NextResponse.json({ error: "Answer not found." }, { status: 404 });

  // Unchanged text is a no-op, not a write: it must not mark the answer unverified
  // or bump the version the other tab is holding.
  if (existing.content === content) {
    return NextResponse.json({ data: { id, verification: existing.verification, updated_at: existing.updated_at } });
  }

  const original = (existing.verification ?? {}) as Record<string, unknown>;
  const alreadyEdited = typeof original.member_edited === "object" && original.member_edited !== null;
  const verification = alreadyEdited
    ? original
    : {
        ...original,
        status: "unverified",
        member_edited: {
          at: new Date().toISOString(),
          original_status: original.status ?? "unverified",
          note: "The member edited this answer after it was generated, so the original check no longer describes this text.",
        },
      };

  const now = new Date().toISOString();
  const baseVersion = request.headers.get("x-sophira-base-version");
  let write = supabase
    .from("responses")
    .update({ content, verification, updated_at: now })
    .eq("id", id)
    .eq("user_id", user.id);
  if (baseVersion) write = write.eq("updated_at", baseVersion);

  const { data, error } = await write.select("id, updated_at, verification").maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Could not save your edit." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      {
        error: "This answer changed somewhere else. Your text is still here - choose which version to keep.",
        conflict: true,
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ data });
}
