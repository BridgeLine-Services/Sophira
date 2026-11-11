import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/essay/sections — edit a drafted essay section in the member's own words.
 *
 * Sections are drafted by the pipeline and shown with a paced reveal, but until
 * now the text was read-only: an essay is the member's own work, and a sentence
 * they disagree with had no way to be fixed inside Sophira.
 *
 * Three rules, all enforced here rather than in the browser:
 *
 *  1. **Only a drafted section can be edited.** An empty section is not text; it
 *     is a slot waiting for the drafting workflow.
 *  2. **Edits are marked, not disguised.** The section keeps `edited_at`, and the
 *     three audits (citation, rubric, style) were run on the DRAFTED text, so they
 *     are preserved verbatim under `audits_of_drafted_version` and the live audits
 *     are cleared. Otherwise a stale "citation audit passed" would appear to
 *     describe words it never saw. The same applies to the essay's final
 *     verification: editing a section after the verifier ran sets it back to
 *     NEEDS REVIEW, naming the section that changed.
 *  3. **Revision-aware.** `x-sophira-base-version` carries `updated_date`; a tab
 *     that has moved on is refused with 409 and keeps its text.
 *
 * Scoped to the signed-in member by guard, by explicit `.eq("user_id", ...)` and
 * by RLS. The session id and section id are both validated against the row.
 */
const MAX_SECTION = 120000;

interface SectionRow {
  id: string;
  draft: string | null;
  audits?: { citation: string; rubric: string; style: string } | null;
  edited_at?: string | null;
  audits_of_drafted_version?: { citation: string; rubric: string; style: string } | null;
}

export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  let body: { session_id?: unknown; section_id?: unknown; draft?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  const sectionId = typeof body.section_id === "string" ? body.section_id : "";
  if (!sessionId || !sectionId) {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }
  if (typeof body.draft !== "string") {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }
  const text = body.draft.replace(/\r\n/g, "\n");
  if (!text.trim()) {
    return NextResponse.json({ error: "A section cannot be emptied." }, { status: 400 });
  }
  if (text.length > MAX_SECTION) {
    return NextResponse.json({ error: "That section is too long to save." }, { status: 413 });
  }

  const { data: session, error: readError } = await supabase
    .from("essay_sessions")
    .select("id, sections, final_verification, updated_date")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: "Could not open that essay." }, { status: 500 });
  if (!session) return NextResponse.json({ error: "Essay not found." }, { status: 404 });

  const sections: SectionRow[] = Array.isArray(session.sections) ? session.sections : [];
  const index = sections.findIndex((s) => s.id === sectionId);
  if (index === -1) return NextResponse.json({ error: "Section not found." }, { status: 404 });
  const current = sections[index];
  if (!current.draft) {
    return NextResponse.json(
      { error: "This section has not been drafted yet, so there is nothing to edit." },
      { status: 409 },
    );
  }

  // Unchanged text is a no-op: it must not clear audits or reset the verification.
  if (current.draft === text) {
    return NextResponse.json({
      data: { section: current, final_verification: session.final_verification, updated_date: session.updated_date },
    });
  }

  const now = new Date().toISOString();
  const edited: SectionRow = {
    ...current,
    draft: text,
    edited_at: now,
    // Keep the original audits once, under a name that says what they describe.
    audits_of_drafted_version: current.audits_of_drafted_version ?? current.audits ?? null,
    audits: null,
  };
  const nextSections = sections.map((s, i) => (i === index ? edited : s));

  const finalVerification = session.final_verification
    ? {
        status: "NEEDS REVIEW",
        note: `Section "${current.id}" was edited by the member after verification ran, so this essay needs another check.`,
      }
    : session.final_verification;

  const baseVersion = request.headers.get("x-sophira-base-version");
  let write = supabase
    .from("essay_sessions")
    .update({
      sections: nextSections,
      final_verification: finalVerification,
      updated_date: now,
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);
  if (baseVersion) write = write.eq("updated_date", baseVersion);

  const { data, error } = await write.select("id, updated_date, final_verification").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not save your edit." }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      {
        error: "This essay changed somewhere else. Your text is still here - choose which version to keep.",
        conflict: true,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    data: { section: edited, final_verification: data.final_verification, updated_date: data.updated_date },
  });
}
