import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { buildGroundedAnswer, extractRelevantProposals } from "@/lib/notebook/grounding";
import { aiChat, aiConfigured, AiNotConfiguredError } from "@/lib/ai/client";
import { parseJsonLoose } from "@/lib/ai/client";
import type { NotebookSource, InlineCitation } from "@/lib/notebook/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Notebook chat (2026-10-06) — SOURCE-GROUNDED:
 *   POST /api/notebooks/:id/chat { question, allow_web_research? }
 *
 * Grounded ONLY in the notebook's INCLUDED sources (pinned first) unless
 * the user EXPLICITLY enables web research for this question — in which
 * case web findings come only through the honest pipeline (already
 * verified + stored as notebook sources). Every answer statement is
 * labeled SOURCE-SUPPORTED / INFERENCE / NOT VERIFIED by the
 * DETERMINISTIC grounding engine; a statement claiming support that
 * cannot be located verbatim is downgraded to NOT VERIFIED, never faked.
 */

async function loadSources(supabase: Awaited<ReturnType<typeof createClient>>, notebookId: string, userId: string): Promise<NotebookSource[]> {
  const { data, error } = await supabase
    .from("notebook_sources")
    .select("*")
    .eq("notebook_id", notebookId)
    .eq("user_id", userId)
    .eq("included", true)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    title: row.title,
    sourceType: row.source_type,
    originalUrl: row.original_url ?? "",
    canonicalUrl: row.canonical_url ?? "",
    contentHash: row.content_hash ?? "",
    uploadedAt: row.created_at,
    retrievedAt: row.retrieved_at ?? null,
    extractedText: row.extracted_text ?? "",
    pageMetadata: row.page_metadata ?? [],
    sectionMetadata: row.section_metadata ?? [],
    processingStatus: row.processing_status,
    verificationStatus: row.verification_status,
    included: row.included,
    pinned: row.pinned,
    authority: row.authority ?? {},
    whySelected: row.why_selected ?? {},
  }));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  const { data: notebook } = await supabase.from("notebooks").select("id,title").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!notebook) return NextResponse.json({ error: "Notebook not found." }, { status: 404 });

  let body: { question?: string; allow_web_research?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const question = (body.question || "").trim();
  if (question.length < 3) return NextResponse.json({ error: "Ask a question." }, { status: 400 });

  const sources = await loadSources(supabase, id, user.id);
  if (sources.length === 0) {
    return NextResponse.json(
      {
        error:
          "This notebook has no included sources. Add sources first (upload, paste instructions, or run Research this topic). Chat is grounded ONLY in your sources.",
      },
      { status: 422 }
    );
  }

  let proposals: ReturnType<typeof extractRelevantProposals> | undefined;
  let modelNote = "answered by deterministic passage extraction (no model configured)";
  if (aiConfigured()) {
    // The model may PROPOSE statements, but every SOURCE-SUPPORTED label is
    // earned only if the claimed quote is verbatim-locatable in a source.
    const context = sources
      .map((s) => {
        const excerpt = s.extractedText.slice(0, 6000);
        return `### ${s.sourceId} (${s.sourceType}${s.sourceType === "web_url" ? `, ${s.canonicalUrl || s.originalUrl}, retrieved ${s.retrievedAt ?? "unknown"}` : ""}) — ${s.title}\n${excerpt}`;
      })
      .join("\n\n");
    const sys = [
      "You answer questions ONLY from the provided notebook sources.",
      "Return JSON: {\"statements\":[{\"text\":\"...\",\"quote\":\"<exact passage copied from a source>\",\"sourceId\":\"S1\",\"label\":\"SOURCE-SUPPORTED\"|\"INFERENCE\"}]}.",
      "Rules: copy quotes VERBATIM from the sources; use quote+sourceId only when the statement is directly supported; if you infer, set label INFERENCE and cite the sourceId you reasoned from with no quote; never invent sources, URLs, or citations; if the sources do not answer, return statements with label NOT VERIFIED is impossible — instead return empty statements and say so in a field \"note\".",
      body.allow_web_research
        ? "The user enabled web research for this question, but no web content is provided in this context — answer from the notebook sources only and set note accordingly."
        : "Web research is OFF: answer strictly from the notebook sources.",
    ].join(" ");
    try {
      const raw = await aiChat(
        [
          { role: "system", content: sys },
          { role: "user", content: `Notebook sources:\n\n${context}\n\nQuestion: ${question}` },
        ],
        { temperature: 0.1, maxTokens: 1200, jsonMode: true }
      );
      const parsed = parseJsonLoose<{ statements?: { text: string; quote?: string; sourceId?: string; label?: string }[] }>(raw);
      if (parsed?.statements && Array.isArray(parsed.statements)) {
        proposals = parsed.statements
          .filter((st) => typeof st?.text === "string" && st.text.trim())
          .map((st) => ({
            text: st.text.trim(),
            quote: st.quote,
            sourceId: st.sourceId,
            claimed: st.label as "SOURCE-SUPPORTED" | "INFERENCE" | "NOT VERIFIED" | undefined,
          }));
        modelNote = "model proposals were verified statement-by-statement by the deterministic grounding engine";
      }
    } catch (e) {
      if (e instanceof AiNotConfiguredError) {
        modelNote = "model unavailable — fell back to deterministic passage extraction";
      } else {
        modelNote = `model failed (${(e as Error).message.slice(0, 120)}) — fell back to deterministic passage extraction`;
      }
    }
  }

  const answer = buildGroundedAnswer({
    question,
    sources,
    proposals,
    allowWebResearch: body.allow_web_research === true,
  });
  answer.notes.unshift(modelNote);

  // persist the question + grounded answer; persist SOURCE-SUPPORTED evidence
  const { data: qRow, error: qErr } = await supabase
    .from("notebook_questions")
    .insert({
      notebook_id: id,
      user_id: user.id,
      question,
      answer,
      allow_web_research: body.allow_web_research === true,
      status: "answered",
    })
    .select("id")
    .single();
  const questionId = qRow?.id ?? null;
  if (!qErr && questionId) {
    const evidenceRows = answer.statements
      .filter((st) => st.citations.length > 0)
      .flatMap((st) =>
        st.citations.map((c: InlineCitation) => ({
          notebook_id: id,
          user_id: user.id,
          source_id: c.sourceId,
          question_id: questionId,
          quote: c.quote ?? st.text.slice(0, 2000),
          chars_start: c.locator.charsStart ?? null,
          chars_end: c.locator.charsEnd ?? null,
          page: c.locator.page ?? null,
          section: c.locator.section ?? null,
          paragraph: c.locator.paragraph ?? null,
          label: st.label,
        }))
      );
    if (evidenceRows.length > 0) {
      await supabase.from("notebook_evidence").insert(evidenceRows);
    }
  }
  return NextResponse.json({ answer, questionId });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { data, error } = await supabase
    .from("notebook_questions")
    .select("*")
    .eq("notebook_id", id)
    .eq("user_id", guard.data.user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: "Could not load questions." }, { status: 500 });
  return NextResponse.json({ questions: data ?? [] });
}
