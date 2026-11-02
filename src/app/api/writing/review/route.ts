import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { runWritingReview, reviewSummary, type CitationEvidenceInput, type WritingGoal } from "@/lib/writing/review";
import type { OriginalitySource } from "@/lib/writing/originality";
import type { RubricItem } from "@/lib/writing/quality-checks";
import type { CitationStatus } from "@/lib/research/citation-invariant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hard ceiling: a huge paste must not lock up a request. ~200k chars. */
const MAX_DRAFT_CHARS = 200_000;
const MAX_SOURCES = 20;

const VALID_STATUSES: CitationStatus[] = ["VERIFIED", "UNVERIFIED", "UNAVAILABLE", "STALE"];

/**
 * POST /api/writing/review — reviews the signed-in student's OWN draft.
 *
 * Reads nothing but what the caller sends plus their own saved sources, and
 * writes NOTHING: there is no persistence of the draft or of the findings. The
 * student's text stays exactly where it was until they confirm a revision in
 * the workspace, and that confirmation happens on their device.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  // Full authorization chain: authenticated -> ACTIVE access -> own data.
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const userId = guard.data.user.id;

  let body: {
    draft?: unknown;
    goals?: unknown;
    rubric?: unknown;
    source_ids?: unknown;
    sources?: unknown;
    citations?: unknown;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "That request could not be read. Try again — nothing was changed." },
      { status: 400 }
    );
  }

  const draft = typeof body.draft === "string" ? body.draft : "";
  if (draft.length > MAX_DRAFT_CHARS) {
    return NextResponse.json(
      {
        ok: false,
        error: `That draft is very long (${Math.round(draft.length / 1000)}k characters). Sophira reviews up to ${MAX_DRAFT_CHARS / 1000}k characters at a time — try one section at a time.`,
      },
      { status: 413 }
    );
  }

  const goals: WritingGoal[] = Array.isArray(body.goals)
    ? (body.goals.filter((g): g is WritingGoal => typeof g === "string") as WritingGoal[])
    : [];

  const rubric: RubricItem[] = Array.isArray(body.rubric)
    ? body.rubric
        .filter((r): r is { text: string; keywords?: string[] } => Boolean(r) && typeof (r as { text?: unknown }).text === "string")
        .slice(0, 30)
        .map((r) => ({
          text: String(r.text).slice(0, 500),
          keywords: Array.isArray(r.keywords)
            ? r.keywords.filter((k): k is string => typeof k === "string").slice(0, 10)
            : undefined,
        }))
    : [];

  // --- sources: pasted in this request, plus the student's own saved sources by id
  const sources: OriginalitySource[] = [];

  if (Array.isArray(body.sources)) {
    for (const raw of body.sources.slice(0, MAX_SOURCES)) {
      const s = raw as { id?: unknown; title?: unknown; content?: unknown; url?: unknown };
      const content = typeof s.content === "string" ? s.content : "";
      if (content.trim().length === 0) continue;
      sources.push({
        id: typeof s.id === "string" ? s.id : `pasted-${sources.length + 1}`,
        title: typeof s.title === "string" && s.title.trim() ? s.title.trim().slice(0, 200) : "A source you supplied",
        content: content.slice(0, MAX_DRAFT_CHARS),
        url: typeof s.url === "string" ? s.url : null,
      });
    }
  }

  const sourceIds = Array.isArray(body.source_ids)
    ? body.source_ids.filter((x): x is string => typeof x === "string").slice(0, MAX_SOURCES)
    : [];
  if (sourceIds.length > 0) {
    // RLS on academic_sources guarantees these are THIS user's rows; the explicit
    // user_id filter is belt-and-braces, not the only protection.
    const { data: rows } = await supabase
      .from("academic_sources")
      .select("id, title, content, url")
      .eq("user_id", userId)
      .in("id", sourceIds);
    for (const r of rows ?? []) {
      const content = typeof r.content === "string" ? r.content : "";
      if (content.trim().length === 0) continue;
      sources.push({
        id: String(r.id),
        title: (r.title as string | null) ?? "A saved source",
        content: content.slice(0, MAX_DRAFT_CHARS),
        url: (r.url as string | null) ?? null,
      });
    }
  }

  // --- citation outcomes: accepted only from a known status vocabulary
  const citations: CitationEvidenceInput[] = Array.isArray(body.citations)
    ? body.citations
        .slice(0, 100)
        .filter((c): c is { claim: string; status: CitationStatus } => Boolean(c) &&
          typeof (c as { claim?: unknown }).claim === "string" &&
          VALID_STATUSES.includes((c as { status?: CitationStatus }).status as CitationStatus))
        .map((c) => ({
          claim: String(c.claim).slice(0, 500),
          status: c.status,
          sourceTitle: (c as { sourceTitle?: string }).sourceTitle ?? null,
          url: (c as { url?: string }).url ?? null,
          passage: (c as { passage?: string }).passage ?? null,
        }))
    : [];

  const result = runWritingReview({ draft, sources, rubric, goals, citations });

  return NextResponse.json({
    ok: true,
    summary: reviewSummary(result),
    notes: result.notes,
    counts: result.counts,
    findings: result.findings,
    empty: result.empty,
    // Stated in the payload itself so no client can present this as a score.
    scope: {
      compared: sources.length,
      internetSearch: false,
      detectorUsed: false,
      similarityPercent: null,
    },
  });
}
